import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { createTrendMonitorEvaluationCorpus } from "./intelligence-evaluation-service.ts";
import { AgentRuntime } from "./runtime.ts";
import { TrustPerformanceService, type TrustEvidence } from "./trust-performance-service.ts";
import type { ActionRequest, AgentProfile, IntelligenceEvaluationReport, TaskRecord } from "./types.ts";

function profile(metrics: Record<string, number | string | null> = {}): AgentProfile {
  return {
    id: "A-012", name: "trend", version: "0.2", status: "observed", mission: "test", description: "test", capabilities: ["trend_monitoring"], allowedInputs: [], expectedOutputs: [], authorityLevel: "recommend", approvalRequirements: [], limitations: [], declaredPerformanceSignals: [], executionState: "implemented",
    departmentId: null, toolIds: [], memoryScopeIds: [], metrics, workload: { activeTaskIds: [], queueDepth: 0 }, limits: { maxConcurrentTasks: 1, maxTaskCost: null }, performance: { completedTasks: 0, failedTasks: 0, escalatedTasks: 0 }, cost: { currency: "USD", total: 0 }, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function task(id: string, status: "completed" | "failed"): TaskRecord {
  return { id, objective: id, assignedAgentId: "A-012", priority: "normal", status, cost: { currency: "USD", amount: 0 }, evidence: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

const service = new TrustPerformanceService();
const strongEvaluation: IntelligenceEvaluationReport = {
  reportId: "eval-strong", agentId: "A-012", capability: "trend_monitoring", createdAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z", cases: [], summary: { totalCases: 7, passedCases: 7, failedCases: 0, averageScore: 100, directionAccuracyPercentage: 100, recommendationAccuracyPercentage: 100, confidenceQualityScore: 100 },
};
const strongEvidence: TrustEvidence = { profile: profile(), tasks: Array.from({ length: 5 }, (_, index) => task(`complete-${index}`, "completed")), evaluationReports: [strongEvaluation], auditEvents: [{ id: "audit-1", timestamp: "2026-01-01T00:00:00.000Z", actorId: "A-012", type: "task.execution_completed", message: "ok" }, { id: "audit-2", timestamp: "2026-01-01T00:00:00.000Z", actorId: "A-012", type: "task.execution_completed", message: "ok" }, { id: "audit-3", timestamp: "2026-01-01T00:00:00.000Z", actorId: "A-012", type: "task.execution_completed", message: "ok" }], auditAvailable: true };
const strongReport = service.generate("trust-strong", strongEvidence);
assert.equal(strongReport.trustLevel, "demonstrated");
assert.equal(strongReport.recommendation, "eligible-for-human-review");

const volumeOnly = service.generate("trust-volume", { ...strongEvidence, tasks: Array.from({ length: 30 }, (_, index) => task(`volume-${index}`, "completed")), evaluationReports: [] });
assert.notEqual(volumeOnly.trustLevel, "demonstrated", "volume alone cannot demonstrate trust");
assert.notEqual(volumeOnly.trustLevel, "proven", "volume alone cannot prove trust");
const insufficient = service.generate("trust-insufficient", { ...strongEvidence, tasks: [], evaluationReports: [], auditEvents: [], auditAvailable: false });
assert.equal(insufficient.trustLevel, "unproven");
assert.equal(insufficient.recommendation, "gather-more-evidence");
const weakOperations = service.generate("trust-weak-ops", { ...strongEvidence, tasks: [] });
assert.equal(weakOperations.trustLevel, "developing", "strong evaluation alone cannot demonstrate trust");
const repeatedFailures = service.generate("trust-failures", { ...strongEvidence, tasks: [task("f1", "failed"), task("f2", "failed"), task("f3", "failed")] });
assert.equal(repeatedFailures.recommendation, "investigate-performance");
const governanceViolations = service.generate("trust-governance", { ...strongEvidence, auditEvents: [{ id: "deny-1", timestamp: "2026-01-01T00:00:00.000Z", actorId: "A-012", type: "permission.evaluated", message: "denied", payload: { result: "denied", reason: "capability not declared" } }, { id: "deny-2", timestamp: "2026-01-01T00:00:00.000Z", actorId: "A-012", type: "permission.evaluated", message: "denied", payload: { result: "denied", reason: "capability not declared" } }, { id: "audit-3", timestamp: "2026-01-01T00:00:00.000Z", actorId: "A-012", type: "task.execution_completed", message: "ok" }] });
assert.ok(governanceViolations.componentScores.governanceSafety < 15);
const humanRejection = service.generate("trust-human-rejection", { ...strongEvidence, auditEvents: [{ id: "human", timestamp: "2026-01-01T00:00:00.000Z", actorId: "guido", type: "approval.rejected", message: "human decision" }, ...strongEvidence.auditEvents] });
assert.equal(humanRejection.governance.attributablePermissionDenials, 0, "human approval rejection is not agent misconduct");

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-trust-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
const beforeState = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
runtime.runIntelligenceEvaluation({ reportId: "trend-eval-trust", agentId: "A-012", capability: "trend_monitoring", cases: createTrendMonitorEvaluationCorpus() });
for (let index = 0; index < 5; index += 1) {
  const action: ActionRequest = { actionId: `trust-task-${index}`, agentId: "A-012", actionType: "research", capability: "trend_monitoring", purpose: "Operational trend analysis", target: "internal data", scope: "company", impactLevel: "low", requestedAt: new Date().toISOString(), operation: "analyse_trend", operationInput: { values: [10, 12, 14, 16] } };
  runtime.evaluateAction(action);
  const handoff = runtime.handoffTask({ actionId: action.actionId, taskId: `trust-task-record-${index}` });
  runtime.claimTask({ taskId: handoff.task!.id, claimingAgentId: "A-012" });
  runtime.attemptExecution({ taskId: handoff.task!.id });
}
const persistedReport = runtime.generateTrustPerformanceReport("A-012", "trust-runtime-1");
assert.equal(persistedReport.trustLevel, "demonstrated");
const afterState = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
assert.deepEqual(afterState.agents.find((agent: any) => agent.id === "A-012").authorityLevel, beforeState.agents.find((agent: any) => agent.id === "A-012").authorityLevel);
assert.deepEqual(afterState.agents.find((agent: any) => agent.id === "A-012").status, beforeState.agents.find((agent: any) => agent.id === "A-012").status);
assert.deepEqual(afterState.permissionPolicies, beforeState.permissionPolicies, "trust report cannot mutate policies");
assert.equal(runtime.getTrustPerformanceReport("trust-runtime-1")?.trustScore, persistedReport.trustScore);
const historicalScore = persistedReport.trustScore;
const later = runtime.generateTrustPerformanceReport("A-012", "trust-runtime-2");
assert.equal(runtime.getTrustPerformanceReport("trust-runtime-1")?.trustScore, historicalScore, "historical report must remain immutable");
assert.notEqual(later.reportId, persistedReport.reportId);
const reloaded = new AgentRuntime({ storageRoot });
assert.equal(reloaded.getTrustPerformanceReport("trust-runtime-1")?.agentId, "A-012", "trust reports persist across reload");
const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(auditLog, /agent\.trust_report_generated/);

console.log("Trust performance tests passed.");