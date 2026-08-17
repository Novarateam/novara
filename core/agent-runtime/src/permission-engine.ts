import type { AgentRegistry } from "./agent-registry.ts";
import type {
  ActionRequest,
  PermissionDecision,
  PermissionPolicy,
} from "./types.ts";

const activeStatuses = new Set(["observed", "trusted", "autonomous", "delegated"]);
const safeActionTypes = new Set(["read", "research", "analyse", "recommend"]);
const approvalActionTypes = new Set([
  "execute",
  "publish",
  "external_communication",
  "spend_money",
  "modify_code",
  "modify_system",
  "manage_agents",
  "modify_authority",
]);

export class PermissionEngine {
  private readonly registry: AgentRegistry;
  private readonly getPolicy: (agentId: string) => PermissionPolicy | undefined;

  constructor(registry: AgentRegistry, getPolicy: (agentId: string) => PermissionPolicy | undefined) {
    this.registry = registry;
    this.getPolicy = getPolicy;
  }

  evaluate(action: ActionRequest): PermissionDecision {
    const evaluatedAt = new Date().toISOString();
    const deny = (reason: string): PermissionDecision => ({ action, status: "denied", reason, evaluatedAt });
    const escalate = (reason: string): PermissionDecision => ({ action, status: "escalation-required", reason, evaluatedAt });
    const requireApproval = (reason: string): PermissionDecision => ({
      action,
      status: "approval-required",
      reason,
      evaluatedAt,
      requiredApprovalLevel: "human",
      approval: {
        approvalId: `approval-${action.actionId}`,
        actionId: action.actionId,
        requestedBy: action.agentId,
        status: "pending",
        requestedAt: action.requestedAt,
        reason,
      },
    });

    if (!action.actionId.trim() || !action.agentId.trim() || !action.actionType.trim() || !action.capability.trim() || !action.purpose.trim() || !action.target.trim()) {
      return deny("An action request requires identity, action type, capability, purpose, and target.");
    }

    const agent = this.registry.get(action.agentId);
    if (!agent) {
      return deny("The requesting agent is not registered.");
    }

    if (agent.executionState !== "implemented" || !activeStatuses.has(agent.status)) {
      return deny("The requesting agent is registered but is not active and executable.");
    }

    if (!agent.capabilities.includes(action.capability)) {
      return deny("The requested capability is not declared by the agent.");
    }

    const policy = this.getPolicy(action.agentId);
    if (!policy) {
      return escalate("No persisted permission policy is available for the requesting agent.");
    }

    if (!policy.allowedAuthorities.includes(agent.authorityLevel)) {
      return escalate("The agent authority level is not allowed by its persisted permission policy.");
    }

    const purpose = action.purpose.toLowerCase();
    const target = action.target.toLowerCase();
    if (action.actionType === "modify_authority" && action.targetAgentId === action.agentId) {
      return deny("An agent may not modify or increase its own authority.");
    }

    if (action.actionType === "modify_system" && target.includes("permission-engine")) {
      return deny("An agent may not modify the permission engine.");
    }

    if (action.actionType === "manage_agents" && (purpose.includes("create") || purpose.includes("activate"))) {
      return deny("An agent may not autonomously create or activate another agent.");
    }

    if (safeActionTypes.has(action.actionType)) {
      if (["external", "code", "system", "organization"].includes(action.scope) || action.impactLevel === "high" || action.impactLevel === "critical") {
        return requireApproval("The requested action exceeds the safe internal scope or impact level.");
      }

      if (policy.approvalRequiredFor.includes(agent.authorityLevel)) {
        return requireApproval("The persisted permission policy requires approval at the agent's authority level.");
      }

      return { action, status: "allowed", reason: "The active agent has the declared capability for a safe internal action.", evaluatedAt };
    }

    if (action.actionType === "create_draft") {
      return action.scope === "external" || action.impactLevel !== "low"
        ? requireApproval("An externally meaningful draft requires human approval.")
        : { action, status: "allowed", reason: "The draft is bounded to a low-impact internal scope.", evaluatedAt };
    }

    if (approvalActionTypes.has(action.actionType)) {
      return requireApproval("This action type has potential external or high-impact consequences and requires human approval.");
    }

    return escalate("The action type has no established policy and requires human review.");
  }
}