import type { AgentRegistry } from "./agent-registry.ts";
import { getInternalExecutionAdapter, runBoundedInternalOperation } from "./internal-execution-adapters.ts";
import type {
  ApprovalRecord,
  BoundedExecutionResult,
  BoundedOperation,
  ExecutionAttemptRequest,
  ExecutionAttemptResult,
  PermissionDecision,
  PersistedPermissionDecision,
  TaskRecord,
} from "./types.ts";

export { runBoundedInternalOperation } from "./internal-execution-adapters.ts";

export class ExecutionAttemptService {
  private readonly registry: AgentRegistry;
  private readonly getTask: (taskId: string) => TaskRecord | undefined;
  private readonly getPermissionDecision: (actionId: string) => PersistedPermissionDecision | undefined;
  private readonly evaluatePermission: (action: PersistedPermissionDecision["action"]) => PermissionDecision;
  private readonly getApproval: (approvalId: string) => ApprovalRecord | undefined;
  private readonly onAuthorized: (details: { task: TaskRecord; permission: PermissionDecision; approvalId?: string; operation: BoundedOperation }) => void;

  constructor(
    registry: AgentRegistry,
    getTask: (taskId: string) => TaskRecord | undefined,
    getPermissionDecision: (actionId: string) => PersistedPermissionDecision | undefined,
    evaluatePermission: (action: PersistedPermissionDecision["action"]) => PermissionDecision,
    getApproval: (approvalId: string) => ApprovalRecord | undefined,
    onAuthorized: (details: { task: TaskRecord; permission: PermissionDecision; approvalId?: string; operation: BoundedOperation }) => void,
  ) {
    this.registry = registry;
    this.getTask = getTask;
    this.getPermissionDecision = getPermissionDecision;
    this.evaluatePermission = evaluatePermission;
    this.getApproval = getApproval;
    this.onAuthorized = onAuthorized;
  }

  attempt(request: ExecutionAttemptRequest): ExecutionAttemptResult {
    const taskId = String(request.taskId ?? "").trim();
    const reject = (reason: string, permissionDecision?: PermissionDecision, approvalId?: string): ExecutionAttemptResult => ({
      status: "rejected", taskId, reason, permissionDecision, approvalId,
    });

    if (!taskId) {
      return reject("Execution attempt requires a non-empty taskId.");
    }
    const task = this.getTask(taskId);
    if (!task) {
      return reject("Task was not found.");
    }
    if (task.status !== "claimed") {
      return reject(`Task is ${task.status} and is not eligible for execution attempt.`);
    }
    if (!task.handoff || !task.claim || task.execution || task.startedAt || task.completedAt || task.result !== undefined || task.error !== undefined) {
      return reject("Task does not have a valid claimed readiness state.");
    }

    const persistedPermission = this.getPermissionDecision(task.handoff.actionId);
    if (!persistedPermission || persistedPermission.action.actionId !== task.handoff.actionId || persistedPermission.action.capability !== task.handoff.requiredCapability) {
      return reject("Task does not have valid persisted authorization evidence.");
    }
    const eligibleClaimants = this.registry.findEligibleCandidates({ requiredCapability: task.claim.requiredCapability });
    if (!eligibleClaimants.some((agent) => agent.id === task.claim?.claimingAgentId)) {
      return reject("Claiming agent is no longer eligible for the task capability.");
    }

    const freshPermission = this.evaluatePermission(persistedPermission.action);
    if (freshPermission.status !== "allowed" && freshPermission.status !== "approval-required") {
      return reject(`Final permission evaluation is ${freshPermission.status}.`, freshPermission);
    }

    let approvalId: string | undefined;
    if (freshPermission.status === "approval-required") {
      approvalId = task.handoff.approvalId;
      if (!approvalId) {
        return reject("Task requires approval but has no approval reference.", freshPermission);
      }
      const approval = this.getApproval(approvalId);
      if (!approval) {
        return reject("Task requires an approval record that no longer exists.", freshPermission, approvalId);
      }
      if (approval.actionId !== task.handoff.actionId) {
        return reject("Task approval record belongs to a different action.", freshPermission, approvalId);
      }
      if (approval.status !== "approved") {
        return reject(`Task approval record is ${approval.status}, not approved.`, freshPermission, approvalId);
      }
    }

    const operation = persistedPermission.action.operation;
    if (!operation) {
      return reject("Task action does not declare a bounded internal operation.", freshPermission, approvalId);
    }
    const adapter = getInternalExecutionAdapter(operation);
    if (!adapter) {
      return reject(`Task action declares unsupported bounded operation: ${operation}.`, freshPermission, approvalId);
    }
    const allowedCapabilities = [adapter.requiredCapability, ...(adapter.compatibleCapabilities ?? [])];
    if (!allowedCapabilities.includes(task.handoff.requiredCapability)) {
      return reject(`Operation ${operation} requires capability ${adapter.requiredCapability}, not ${task.handoff.requiredCapability}.`, freshPermission, approvalId);
    }

    const attemptedAt = new Date().toISOString();
    const metadata = {
      attemptedAt,
      executorId: "bounded-internal-v1" as const,
      operation,
      authorizationResult: freshPermission.status,
      approvalId,
    };
    this.onAuthorized({ task, permission: freshPermission, approvalId, operation });
    try {
      const result = runBoundedInternalOperation(operation, persistedPermission.action.operationInput);
      const completedAt = new Date().toISOString();
      return {
        status: "completed",
        taskId,
        reason: "Bounded internal operation completed successfully.",
        permissionDecision: freshPermission,
        approvalId,
        task: {
          ...task,
          status: "completed",
          result,
          completedAt,
          updatedAt: completedAt,
          execution: { ...metadata, completedAt },
        },
      };
    } catch (error) {
      const failedAt = new Date().toISOString();
      return {
        status: "failed",
        taskId,
        reason: (error as Error).message,
        permissionDecision: freshPermission,
        approvalId,
        task: {
          ...task,
          status: "failed",
          error: (error as Error).message,
          updatedAt: failedAt,
          execution: { ...metadata, failedAt },
        },
      };
    }
  }
}