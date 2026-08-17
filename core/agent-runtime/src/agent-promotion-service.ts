import type {
  AgentProfile,
  AgentPromotionConfirmation,
  AgentPromotionProposal,
  AgentPromotionRecord,
  AgentPromotionResult,
  AgentTrustPerformanceReport,
  HumanGovernanceDecisionRecord,
} from "./types.ts";

export interface PromotionReadStore {
  getAgent(agentId: string): AgentProfile | undefined;
  getTrustReport(reportId: string): AgentTrustPerformanceReport | undefined;
  getGovernanceDecision(decisionId: string): HumanGovernanceDecisionRecord | undefined;
  getProposal(proposalId: string): AgentPromotionProposal | undefined;
  getConfirmation(confirmationId: string): AgentPromotionConfirmation | undefined;
  getAppliedPromotion(proposalId: string): AgentPromotionRecord | undefined;
}

function validateEvidence(store: PromotionReadStore, agentId: string, trustReportId: string, governanceDecisionId: string): { profile: AgentProfile; proposalError?: string } {
  const profile = store.getAgent(agentId);
  if (!profile) return { profile: undefined as never, proposalError: "Agent was not found." };
  const trust = store.getTrustReport(trustReportId);
  if (!trust) return { profile, proposalError: "Trust report was not found." };
  if (trust.agentId !== agentId) return { profile, proposalError: "Trust report belongs to a different agent." };
  const governance = store.getGovernanceDecision(governanceDecisionId);
  if (!governance) return { profile, proposalError: "Human governance decision was not found." };
  if (governance.agentId !== agentId || governance.trustReportId !== trustReportId) return { profile, proposalError: "Governance decision does not link to the exact agent and trust report." };
  if (governance.decision !== "approved-for-human-review") return { profile, proposalError: "Governance decision is not approved-for-human-review." };
  return { profile };
}

export class AgentPromotionService {
  private readonly store: PromotionReadStore;

  constructor(store: PromotionReadStore) {
    this.store = store;
  }

  createProposal(input: { proposalId: string; agentId: string; trustReportId: string; governanceDecisionId: string; promotionType: string }): AgentPromotionResult {
    const proposalId = input.proposalId.trim();
    const agentId = input.agentId.trim();
    const trustReportId = input.trustReportId.trim();
    const governanceDecisionId = input.governanceDecisionId.trim();
    if (!proposalId || !agentId || !trustReportId || !governanceDecisionId) return { status: "rejected", reason: "proposalId, agentId, trustReportId, and governanceDecisionId are required." };
    if (input.promotionType !== "observed-to-trusted") return { status: "rejected", reason: "Unsupported promotion type." };
    const evidence = validateEvidence(this.store, agentId, trustReportId, governanceDecisionId);
    if (evidence.proposalError) return { status: "rejected", reason: evidence.proposalError };
    if (evidence.profile.status !== "observed") return { status: "rejected", reason: "Promotion requires the agent to currently be observed." };
    return { status: "created", proposal: { proposalId, agentId, trustReportId, governanceDecisionId, promotionType: "observed-to-trusted", currentStatus: "observed", proposedStatus: "trusted", changedFields: ["status"], prohibitedFields: ["authorityLevel", "executionState", "capabilities", "permissionPolicy", "approvalRequirements", "externalAccess", "executionScope"], createdAt: new Date().toISOString() } };
  }

  confirm(input: { confirmationId: string; proposalId: string; reviewerId: string; confirmation: string }): AgentPromotionResult {
    const confirmationId = input.confirmationId.trim();
    const proposalId = input.proposalId.trim();
    const reviewerId = input.reviewerId.trim();
    if (!confirmationId || !proposalId || !reviewerId || input.confirmation !== "confirm-promotion") return { status: "rejected", reason: "confirmationId, proposalId, reviewerId, and confirm-promotion are required." };
    const proposal = this.store.getProposal(proposalId);
    if (!proposal) return { status: "rejected", reason: "Promotion proposal was not found." };
    if (this.store.getAppliedPromotion(proposalId)) return { status: "rejected", reason: "Promotion proposal has already been applied." };
    const evidence = validateEvidence(this.store, proposal.agentId, proposal.trustReportId, proposal.governanceDecisionId);
    if (evidence.proposalError || evidence.profile.status !== proposal.currentStatus) return { status: "rejected", reason: evidence.proposalError ?? "Agent state no longer matches the proposal." };
    return { status: "confirmed", confirmation: { confirmationId, proposalId, reviewerId, confirmation: "confirm-promotion", confirmedAt: new Date().toISOString() } };
  }

  apply(input: { promotionId: string; proposalId: string; confirmationId: string }): AgentPromotionResult {
    const promotionId = input.promotionId.trim();
    const proposalId = input.proposalId.trim();
    const confirmationId = input.confirmationId.trim();
    if (!promotionId || !proposalId || !confirmationId) return { status: "rejected", reason: "promotionId, proposalId, and confirmationId are required." };
    if (this.store.getAppliedPromotion(proposalId)) return { status: "rejected", reason: "Promotion proposal has already been applied." };
    const proposal = this.store.getProposal(proposalId);
    const confirmation = this.store.getConfirmation(confirmationId);
    if (!proposal || !confirmation || confirmation.proposalId !== proposalId || confirmation.confirmation !== "confirm-promotion") return { status: "rejected", reason: "Promotion proposal and explicit confirmation do not link correctly." };
    const evidence = validateEvidence(this.store, proposal.agentId, proposal.trustReportId, proposal.governanceDecisionId);
    if (evidence.proposalError || evidence.profile.status !== proposal.currentStatus || proposal.currentStatus !== "observed" || proposal.proposedStatus !== "trusted") return { status: "rejected", reason: evidence.proposalError ?? "Agent state or proposed transition is no longer valid." };
    return { status: "applied", promotion: { promotionId, proposalId, confirmationId, agentId: proposal.agentId, trustReportId: proposal.trustReportId, governanceDecisionId: proposal.governanceDecisionId, previousStatus: "observed", newStatus: "trusted", reviewerId: confirmation.reviewerId, appliedAt: new Date().toISOString() } };
  }
}