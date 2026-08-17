import type { AgentRegistry } from "./agent-registry.ts";
import type { CoordinationRequest, RoutingResult } from "./types.ts";

export class CoordinationService {
  private readonly registry: AgentRegistry;
  private readonly appendAudit: (type: string, message: string, payload: Record<string, unknown>, taskId?: string) => void;

  constructor(registry: AgentRegistry, appendAudit: (type: string, message: string, payload: Record<string, unknown>, taskId?: string) => void) {
    this.registry = registry;
    this.appendAudit = appendAudit;
  }

  requestRouting(request: CoordinationRequest): RoutingResult {
    if (!request.id.trim() || !request.objective.trim() || !request.requiredCapability.trim()) {
      const result: RoutingResult = { request, status: "rejected", reason: "A routing request requires id, objective, and requiredCapability." };
      this.appendAudit("coordination.rejected", result.reason, { requestId: request.id }, request.taskId);
      return result;
    }

    const candidates = this.registry.findEligibleCandidates(request);
    if (candidates.length === 0) {
      const result: RoutingResult = {
        request,
        status: "no-eligible-agent",
        reason: `No executable agent is eligible for capability: ${request.requiredCapability}.`,
      };
      this.appendAudit("coordination.no_eligible_agent", result.reason, { requestId: request.id, capability: request.requiredCapability }, request.taskId);
      return result;
    }

    const candidate = candidates[0];
    const approvalRequirement = candidate.approvalRequirements.find((requirement) => requirement.action === "execution");
    const approvalRequired = Boolean(request.requiresExecution && approvalRequirement?.required);
    const result: RoutingResult = {
      request,
      status: approvalRequired ? "approval-required" : "routed",
      proposal: {
        requestId: request.id,
        agentId: candidate.id,
        capability: request.requiredCapability,
        authorityLevel: candidate.authorityLevel,
        approvalRequired,
        reason: approvalRequired
          ? approvalRequirement?.reason ?? "Execution requires approval."
          : "An eligible executable agent is available.",
      },
      reason: approvalRequired
        ? approvalRequirement?.reason ?? "Execution requires approval."
        : `Routed to ${candidate.name} for ${request.requiredCapability}.`,
    };
    this.appendAudit(
      approvalRequired ? "coordination.approval_required" : "coordination.routed",
      result.reason,
      { requestId: request.id, agentId: candidate.id, capability: request.requiredCapability },
      request.taskId,
    );
    return result;
  }
}