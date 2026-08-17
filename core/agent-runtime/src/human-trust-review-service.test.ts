import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { createTrendMonitorEvaluationCorpus } from "./intelligence-evaluation-service.ts";
import { HumanTrustReviewService } from "./human-trust-review-service.ts";
import { AgentRuntime } from "./runtime.ts";
import type { AgentTrustPerformanceReport } from "./types.ts";

function report(reportId: string, agentId: string, generatedAt: string, recommendation: AgentTrustPerformanceReport["recommendation"] = "continue-observation"): AgentTrustPerformanceReport {
  return {
    reportId, agentId, generatedAt, trustScore: 50, trustLevel: "observed", recommendation, reasons: [reportId],
    evidenceWindow: { taskOutcomeCount: 0, evaluationReportIds: [], evaluationCaseCount: 0, auditEventCount: 0 },
    operational: { completed: 0, failedOrRejected: 0, outcomeCount: 0, completionRate: null, sufficiency: "insufficient" },
    evaluation: { reportCount: 0, caseCount: 0, averageScore: null, directionAccuracy: null, recommendationAccuracy: null, confidenceQuality: null, sufficiency: "insufficient" },
    governance: { sufficiency: "unavailable", attributablePermissionDenials: 0, attributableCapabilityMismatches: 0, attributableExecutionRejections: 0, humanApprovalRejectionsIgnored: 0 },
    componentScores: { controlledQuality: 0, confidenceCalibration: 0, operationalReliability: 0, governanceSafety: 7 },
  };
}

const stored = [report("old", "A-012", "2026-01-01T00:00:00.000Z"), report("new", "A-012", "2026-02-01T00:00:00.000Z", "eligible-for-human-review"), report("other", "A-002", "2026-03-01T00:00:00.000Z")];
const service = new HumanTrustReviewService({
  listTrustPerformanceReports: () => structuredClone(stored),
  getTrustPerformanceReport: (reportId) => { const found = stored.find((entry) => entry.reportId === reportId); return found ? structuredClone(found) : undefined; },
});
const emptyService = new HumanTrustReviewService({ listTrustPerformanceReports: () => [], getTrustPerformanceReport: () => undefined });
assert.deepEqual(emptyService.listTrustReports(), []);
assert.deepEqual(service.listTrustReports().map((item) => item.reportId), ["other", "new", "old"], "ordering must be newest first");
assert.deepEqual(service.listTrustReportsByAgent("A-012").map((item) => item.reportId), ["new", "old"], "agent filter must not leak reports");
assert.deepEqual(service.listTrustReportsByAgent("missing"), []);
assert.equal(service.getTrustReport("missing").status, "not-found");
const found = service.getTrustReport("new");
assert.equal(found.status, "found");
if (found.status === "found") found.report.reasons.push("mutated");
const foundAgain = service.getTrustReport("new");
assert.equal(foundAgain.status, "found");
if (foundAgain.status === "found") assert.deepEqual(foundAgain.report.reasons, ["new"], "returned report mutation must not affect stored history");
const summary = service.getAgentTrustReview("A-012");
assert.equal(summary.reportCount, 2);
assert.equal(summary.latestReport?.reportId, "new");
assert.equal(summary.humanReviewEligible, true, "eligibility is informational only");

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-review-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
runtime.runIntelligenceEvaluation({ reportId: "review-evaluation", agentId: "A-012", capability: "trend_monitoring", cases: createTrendMonitorEvaluationCorpus() });
const generated = runtime.generateTrustPerformanceReport("A-012", "review-report");
const before = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
const auditBeforeReview = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
const runtimeSummary = runtime.getAgentTrustReview("A-012");
assert.equal(runtimeSummary.latestReport?.reportId, "review-report");
assert.equal(runtime.getTrustReport("review-report").status, "found");
assert.equal(runtime.getTrustReport("no-report").status, "not-found");
const mutable = runtime.getTrustReport("review-report");
if (mutable.status === "found") mutable.report.reasons.push("tamper");
const immutable = runtime.getTrustReport("review-report");
if (immutable.status === "found") assert.ok(!immutable.report.reasons.includes("tamper"));
const auditAfterReview = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.equal(auditAfterReview, auditBeforeReview, "review reads must append no audit events");
const after = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
assert.deepEqual(after.agents, before.agents, "review reads must not mutate agents");
assert.deepEqual(after.permissionPolicies, before.permissionPolicies, "review reads must not mutate policies");
assert.deepEqual(after.approvalRequests, before.approvalRequests, "review reads must not create approvals");
assert.deepEqual(after.tasks, before.tasks, "review reads must not create or execute tasks");
assert.equal(after.trustPerformanceReports.length, before.trustPerformanceReports.length, "review reads must not change report history");
const reloaded = new AgentRuntime({ storageRoot });
assert.equal(reloaded.getAgentTrustReview("A-012").latestReport?.reportId, generated.reportId, "review results must survive reload");
const source = readFileSync(new URL("./human-trust-review-service.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /node:|fetch\(|http|https|readFile|writeFile|exec\(|spawn\(|process\.|attemptExecution|handoffTask|claimTask|approveAction/, "review service must expose no external, execution, task, or approval dependency");

console.log("Human trust review tests passed.");