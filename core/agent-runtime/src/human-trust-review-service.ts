import type {
  AgentTrustPerformanceReport,
  AgentTrustReviewSummary,
  TrustReportLookupResult,
  TrustReportReviewItem,
} from "./types.ts";

export interface TrustReportReadStore {
  listTrustPerformanceReports(): AgentTrustPerformanceReport[];
  getTrustPerformanceReport(reportId: string): AgentTrustPerformanceReport | undefined;
}

function toReviewItem(report: AgentTrustPerformanceReport): TrustReportReviewItem {
  return {
    reportId: report.reportId,
    agentId: report.agentId,
    generatedAt: report.generatedAt,
    trustScore: report.trustScore,
    trustLevel: report.trustLevel,
    recommendation: report.recommendation,
    evidenceSufficiency: {
      operational: report.operational.sufficiency,
      evaluation: report.evaluation.sufficiency,
      governance: report.governance.sufficiency,
    },
    reasons: [...report.reasons],
  };
}

function newestFirst(left: AgentTrustPerformanceReport, right: AgentTrustPerformanceReport): number {
  return right.generatedAt.localeCompare(left.generatedAt) || right.reportId.localeCompare(left.reportId);
}

export class HumanTrustReviewService {
  private readonly store: TrustReportReadStore;

  constructor(store: TrustReportReadStore) {
    this.store = store;
  }

  listTrustReports(): TrustReportReviewItem[] {
    return this.store.listTrustPerformanceReports().sort(newestFirst).map(toReviewItem);
  }

  listTrustReportsByAgent(agentId: string): TrustReportReviewItem[] {
    return this.store.listTrustPerformanceReports()
      .filter((report) => report.agentId === agentId)
      .sort(newestFirst)
      .map(toReviewItem);
  }

  getTrustReport(reportId: string): TrustReportLookupResult {
    const report = this.store.getTrustPerformanceReport(reportId);
    return report ? { status: "found", report } : { status: "not-found", reportId };
  }

  getAgentTrustReview(agentId: string): AgentTrustReviewSummary {
    const reports = this.listTrustReportsByAgent(agentId);
    const latestReport = reports[0] ?? null;
    return {
      agentId,
      reportCount: reports.length,
      latestReport,
      humanReviewEligible: latestReport?.recommendation === "eligible-for-human-review",
    };
  }
}