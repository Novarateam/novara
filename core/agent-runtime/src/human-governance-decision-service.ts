import type {
  AgentTrustPerformanceReport,
  HumanGovernanceDecisionResult,
  RecordHumanGovernanceDecisionRequest,
} from "./types.ts";

const allowedDecisions = new Set([
  "continue-observation",
  "needs-more-evidence",
  "approved-for-human-review",
  "rejected-for-now",
]);

export class HumanGovernanceDecisionService {
  private readonly getTrustReport: (reportId: string) => AgentTrustPerformanceReport | undefined;

  constructor(getTrustReport: (reportId: string) => AgentTrustPerformanceReport | undefined) {
    this.getTrustReport = getTrustReport;
  }

  record(request: RecordHumanGovernanceDecisionRequest): HumanGovernanceDecisionResult {
    const decisionId = String(request.decisionId ?? "").trim();
    const agentId = String(request.agentId ?? "").trim();
    const trustReportId = String(request.trustReportId ?? "").trim();
    const reviewerId = String(request.reviewerId ?? "").trim();
    const decision = String(request.decision ?? "").trim();
    if (!decisionId || !agentId || !trustReportId || !reviewerId) {
      return { status: "rejected", reason: "decisionId, agentId, trustReportId, and reviewerId are required." };
    }
    if (!allowedDecisions.has(decision)) {
      return { status: "rejected", reason: "Invalid human governance decision." };
    }
    const trustReport = this.getTrustReport(trustReportId);
    if (!trustReport) {
      return { status: "rejected", reason: "Referenced trust report was not found." };
    }
    if (trustReport.agentId !== agentId) {
      return { status: "rejected", reason: "Referenced trust report belongs to a different agent." };
    }
    return {
      status: "created",
      record: {
        decisionId,
        agentId,
        trustReportId,
        reviewerId,
        decision: decision as RecordHumanGovernanceDecisionRequest["decision"],
        reason: request.reason?.trim() || undefined,
        recordedAt: new Date().toISOString(),
      },
    };
  }
}