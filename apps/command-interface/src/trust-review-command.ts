import { HumanTrustReviewService, type TrustReportReadStore } from "../../../core/agent-runtime/src/human-trust-review-service.ts";
import { loadTrustPerformanceReportsReadOnly } from "../../../core/agent-runtime/src/persistence.ts";

export type TrustReviewCommand = {
  operation: "listTrustReports" | "getTrustReport" | "getAgentTrustReview";
  reportId?: string;
  agentId?: string;
};

export type TrustReviewCommandResponse =
  | { status: "ok"; operation: TrustReviewCommand["operation"]; data: unknown }
  | { status: "invalid-request"; reason: string };

function defaultStore(): TrustReportReadStore {
  return {
    listTrustPerformanceReports: () => loadTrustPerformanceReportsReadOnly(),
    getTrustPerformanceReport: (reportId) => loadTrustPerformanceReportsReadOnly().find((report) => report.reportId === reportId),
  };
}

export function handleTrustReviewCommand(command: Partial<TrustReviewCommand>, store: TrustReportReadStore = defaultStore()): TrustReviewCommandResponse {
  const operation = command.operation;
  if (operation !== "listTrustReports" && operation !== "getTrustReport" && operation !== "getAgentTrustReview") {
    return { status: "invalid-request", reason: "Unsupported trust review operation." };
  }
  const service = new HumanTrustReviewService(store);
  if (operation === "listTrustReports") {
    return { status: "ok", operation, data: service.listTrustReports() };
  }
  if (operation === "getTrustReport") {
    const reportId = command.reportId?.trim();
    return reportId
      ? { status: "ok", operation, data: service.getTrustReport(reportId) }
      : { status: "invalid-request", reason: "reportId is required." };
  }
  const agentId = command.agentId?.trim();
  return agentId
    ? { status: "ok", operation, data: service.getAgentTrustReview(agentId) }
    : { status: "invalid-request", reason: "agentId is required." };
}