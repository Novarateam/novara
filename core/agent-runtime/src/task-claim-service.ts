import type { AgentRegistry } from "./agent-registry.ts";
import type {
  ApprovalRecord,
  PermissionDecision,
  PersistedPermissionDecision,
  TaskClaimRequest,
  TaskClaimResult,
  TaskRecord,
} from "./types.ts";

export class TaskClaimService {
  private readonly registry: AgentRegistry;
  private readonly getTask: (taskId: string) => TaskRecord | undefined;
  private readonly getPermissionDecision: (actionId: string) => PersistedPermissionDecision | undefined;
  private readonly evaluatePermission: (action: PersistedPermissionDecision["action"]) => PermissionDecision;
  private readonly getApproval: (approvalId: string) => ApprovalRecord | undefined;

  constructor(
    registry: AgentRegistry,
    getTask: (taskId: string) => TaskRecord | undefined,
    getPermissionDecision: (actionId: string) => PersistedPermissionDecision | undefined,
    evaluatePermission: (action: PersistedPermissionDecision["action"]) => PermissionDecision,
    getApproval: (approvalId: string) => ApprovalRecord | undefined,
  ) {
    this.registry = registry;
    this.getTask = getTask;
    this.getPermissionDecision = getPermissionDecision;
    this.evaluatePermission = evaluatePermission;
    this.getApproval = getApproval;
  }

  claim(request: TaskClaimRequest): TaskClaimResult {
    const taskId = String(request.taskId ?? "").trim();
    const claimingAgentId = String(request.claimingAgentId ?? "").trim();
    const reject = (reason: string, permissionDecision?: PermissionDecision, approvalId?: string): TaskClaimResult => ({
      status: "rejected",
      reason,
      taskId,
      claimingAgentId,
      permissionDecision,
      approvalId,
    });

    if (!taskId || !claimingAgentId) {
      return reject("Task claim requires a non-empty taskId and claimingAgentId.");
    }

    const task = this.getTask(taskId);
    if (!task) {
      return reject("Task was not found.");
    }
    if (task.status !== "queued") {
      return reject(`Task is ${task.status} and cannot be claimed.`);
    }
    if (task.claim || task.startedAt || task.completedAt || task.result !== undefined || task.error !== undefined || !task.handoff) {
      return reject("Task does not have a valid queued handoff state.");
    }

    const persistedPermission = this.getPermissionDecision(task.handoff.actionId);
    if (!persistedPermission || persistedPermission.action.actionId !== task.handoff.actionId || persistedPermission.action.capability !== task.handoff.requiredCapability) {
      return reject("Task does not have valid persisted permission evidence.");
    }

    const freshPermission = this.evaluatePermission(persistedPermission.action);
    if (freshPermission.status !== "allowed" && freshPermission.status !== "approval-required") {
      return reject(`Current permission evaluation is ${freshPermission.status}.`, freshPermission);
    }

    const eligibleClaimants = this.registry.findEligibleCandidates({ requiredCapability: task.handoff.requiredCapability });
    const claimingProfile = eligibleClaimants.find((agent) => agent.id === claimingAgentId);
    if (!claimingProfile) {
      return reject("Claiming agent is not currently eligible for the required capability.", freshPermission);
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

    const timestamp = new Date().toISOString();
    const claimedTask: TaskRecord = {
      ...task,
      assignedAgentId: claimingAgentId,
      status: "claimed",
      updatedAt: timestamp,
      claim: {
        claimingAgentId,
        claimedAt: timestamp,
        executionReadyAt: timestamp,
        requiredCapability: task.handoff.requiredCapability,
        permissionDecision: freshPermission.status,
        approvalId,
      },
    };
    return {
      status: "claimed",
      reason: "Task authorization and readiness checks passed for a future execution layer.",
      taskId,
      claimingAgentId,
      task: claimedTask,
      permissionDecision: freshPermission,
      approvalId,
    };
  }
}