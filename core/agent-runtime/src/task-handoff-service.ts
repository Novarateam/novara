import type { AgentRegistry } from "./agent-registry.ts";
import type {
  ApprovalRecord,
  PersistedPermissionDecision,
  TaskHandoffRequest,
  TaskHandoffResult,
  TaskRecord,
} from "./types.ts";

const activeStatuses = new Set(["observed", "trusted", "autonomous", "delegated"]);

export class TaskHandoffService {
  private readonly registry: AgentRegistry;
  private readonly getPermissionDecision: (actionId: string) => PersistedPermissionDecision | undefined;
  private readonly getApproval: (approvalId: string) => ApprovalRecord | undefined;

  constructor(
    registry: AgentRegistry,
    getPermissionDecision: (actionId: string) => PersistedPermissionDecision | undefined,
    getApproval: (approvalId: string) => ApprovalRecord | undefined,
  ) {
    this.registry = registry;
    this.getPermissionDecision = getPermissionDecision;
    this.getApproval = getApproval;
  }

  handoff(request: TaskHandoffRequest): TaskHandoffResult {
    const actionId = String(request.actionId ?? "").trim();
    const approvalId = request.approvalId?.trim();
    const reject = (reason: string): TaskHandoffResult => ({ status: "rejected", reason, actionId, approvalId });

    if (!actionId || !request.taskId?.trim()) {
      return reject("Task handoff requires a valid actionId and taskId.");
    }

    const permission = this.getPermissionDecision(actionId);
    if (!permission || permission.action.actionId !== actionId) {
      return reject("No authoritative permission decision exists for the action.");
    }

    const agent = this.registry.get(permission.action.agentId);
    if (!agent || agent.executionState !== "implemented" || !activeStatuses.has(agent.status)) {
      return reject("The action agent is no longer registered as active and executable.");
    }

    if (!agent.capabilities.includes(permission.action.capability)) {
      return reject("The action capability is no longer declared by the assigned agent.");
    }

    let approvedForHandoff: string | undefined;
    if (permission.status === "allowed") {
      approvedForHandoff = undefined;
    } else if (permission.status === "approval-required") {
      if (!approvalId) {
        return reject("The action requires a matching approved approval record before handoff.");
      }

      const approval = this.getApproval(approvalId);
      if (!approval) {
        return reject("The referenced approval record does not exist.");
      }
      if (approval.actionId !== actionId) {
        return reject("The referenced approval record belongs to a different action.");
      }
      if (approval.status !== "approved") {
        return reject(`The referenced approval record is ${approval.status}, not approved.`);
      }
      approvedForHandoff = approval.approvalId;
    } else {
      return reject(`The persisted permission decision is ${permission.status} and cannot authorize task handoff.`);
    }

    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: request.taskId.trim(),
      objective: permission.action.purpose,
      assignedAgentId: permission.action.agentId,
      priority: request.priority ?? "normal",
      status: "queued",
      cost: { currency: "USD", amount: 0 },
      evidence: [`permission-${actionId}`, ...(approvedForHandoff ? [`approval-${approvedForHandoff}`] : [])],
      createdAt: now,
      updatedAt: now,
      handoff: {
        actionId,
        requiredCapability: permission.action.capability,
        permissionDecision: permission.status,
        approvalId: approvedForHandoff,
        sourceRequestId: permission.action.routingRequestId ?? permission.action.taskId,
      },
    };

    return { status: "created", reason: "Authorized action was handed off as a queued task.", task, actionId, approvalId: approvedForHandoff };
  }
}