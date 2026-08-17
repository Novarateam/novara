import assert from "node:assert/strict";
import { HumanTrustReviewService, type TrustReportReadStore } from "../../../core/agent-runtime/src/human-trust-review-service.ts";
import { handleTrustReviewCommand } from "./trust-review-command.ts";
import type { AgentTrustPerformanceReport } from "../../../core/agent-runtime/src/types.ts";

function report(reportId: string, agentId: string): AgentTrustPerformanceReport {
  return { reportId, agentId, generatedAt: "2026-01-01T00:00:00.000Z", trustScore: 80, trustLevel: "demonstrated", recommendation: "eligible-for-human-review", reasons: ["evidence"], evidenceWindow: { taskOutcomeCount: 5, evaluationReportIds: [], evaluationCaseCount: 7, auditEventCount: 3 }, operational: { completed: 5, failedOrRejected: 0, outcomeCount: 5, completionRate: 100, sufficiency: "sufficient" }, evaluation: { reportCount: 1, caseCount: 7, averageScore: 100, directionAccuracy: 100, recommendationAccuracy: 100, confidenceQuality: 100, sufficiency: "sufficient" }, governance: { sufficiency: "sufficient", attributablePermissionDenials: 0, attributableCapabilityMismatches: 0, attributableExecutionRejections: 0, humanApprovalRejectionsIgnored: 0 }, componentScores: { controlledQuality: 40, confidenceCalibration: 15, operationalReliability: 30, governanceSafety: 15 } };
}

const reports = [report("r1", "A-012"), report("r2", "A-002")];
const store: TrustReportReadStore = { listTrustPerformanceReports: () => structuredClone(reports), getTrustPerformanceReport: (id) => { const found = reports.find((entry) => entry.reportId === id); return found ? structuredClone(found) : undefined; } };
assert.equal(handleTrustReviewCommand({ operation: "listTrustReports" }, store).status, "ok");
assert.equal(handleTrustReviewCommand({ operation: "getTrustReport" }, store).status, "invalid-request");
const missing = handleTrustReviewCommand({ operation: "getTrustReport", reportId: "missing" }, store);
assert.equal(missing.status, "ok");
if (missing.status === "ok") assert.equal((missing.data as { status: string }).status, "not-found");
const summary = handleTrustReviewCommand({ operation: "getAgentTrustReview", agentId: "A-012" }, store);
assert.equal(summary.status, "ok");
if (summary.status === "ok") assert.equal((summary.data as { humanReviewEligible: boolean }).humanReviewEligible, true);
assert.equal(handleTrustReviewCommand({ operation: "unknown" as never }, store).status, "invalid-request");
const source = HumanTrustReviewService.toString() + handleTrustReviewCommand.toString();
assert.doesNotMatch(source, /approve|handoff|claim|attemptExecution|generateTrust/);
console.log("Trust review command tests passed.");