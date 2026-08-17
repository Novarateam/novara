import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { createTrendMonitorEvaluationCorpus, scoreTrendEvaluationCase } from "./intelligence-evaluation-service.ts";
import { AgentRuntime } from "./runtime.ts";
import type { IntelligenceEvaluationCase } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-evaluation-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

const beforeTrend = runtime.listAgents().find((agent) => agent.id === "A-012")!;
const corpus = createTrendMonitorEvaluationCorpus();
const report = runtime.runIntelligenceEvaluation({ reportId: "trend-corpus-v1", agentId: "A-012", capability: "trend_monitoring", cases: corpus });
assert.equal(report.summary.totalCases, 7);
assert.equal(report.summary.passedCases, 7, "known deterministic corpus should pass");
assert.equal(report.summary.averageScore, 100);
assert.equal(report.summary.directionAccuracyPercentage, 100);
assert.equal(report.summary.recommendationAccuracyPercentage, 100);
assert.equal(report.summary.confidenceQualityScore, 100);
assert.ok(report.cases.every((evaluationCase) => evaluationCase.status === "completed" && evaluationCase.passed));

const upward = corpus.find((evaluationCase) => evaluationCase.id === "trend-upward")!;
const wrongDirection = scoreTrendEvaluationCase(upward, { direction: "falling", momentumInterpretation: "positive", recommendation: "monitor-and-evaluate", confidence: 0.8 }, "completed", "test", "synthetic");
assert.equal(wrongDirection.directionScore, 0, "incorrect direction must lose direction score");
const wrongRecommendation = scoreTrendEvaluationCase(upward, { direction: "rising", momentumInterpretation: "positive", recommendation: "investigate-decline", confidence: 0.8 }, "completed", "test", "synthetic");
assert.equal(wrongRecommendation.recommendationScore, 0, "incorrect recommendation must lose recommendation score");
const ambiguous = corpus.find((evaluationCase) => evaluationCase.id === "trend-ambiguous")!;
const overconfident = scoreTrendEvaluationCase(ambiguous, { direction: "rising", momentumInterpretation: "positive", recommendation: "monitor-and-evaluate", confidence: 0.95 }, "completed", "test", "synthetic");
assert.equal(overconfident.confidenceScore, 0, "overconfidence on ambiguous signals must be penalized");

const malformedCase: IntelligenceEvaluationCase = { ...upward, id: "trend-malformed-evaluation", input: { values: [10, "bad"] } };
const malformedReport = runtime.runIntelligenceEvaluation({ reportId: "trend-malformed-v1", agentId: "A-012", capability: "trend_monitoring", cases: [malformedCase] });
assert.equal(malformedReport.cases[0].status, "failed", "malformed trend input must fail safely");
const unauthorizedCase: IntelligenceEvaluationCase = { ...upward, id: "trend-unauthorized-evaluation", capability: "policy_monitoring", operation: "check_policy_update", input: { previous: [], current: [] } };
const unauthorizedReport = runtime.runIntelligenceEvaluation({ reportId: "trend-unauthorized-v1", agentId: "A-012", capability: "policy_monitoring", cases: [unauthorizedCase] });
assert.equal(unauthorizedReport.cases[0].status, "rejected", "undeclared capability must remain rejected");

const afterTrend = runtime.listAgents().find((agent) => agent.id === "A-012")!;
assert.equal(afterTrend.authorityLevel, beforeTrend.authorityLevel, "evaluation must not change authority");
assert.equal(afterTrend.executionState, beforeTrend.executionState, "evaluation must not change activation");
assert.deepEqual(afterTrend.approvalRequirements, beforeTrend.approvalRequirements, "evaluation must not change approval requirements");
const persisted = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
const profile = persisted.agents.find((agent: any) => agent.id === "A-012");
assert.equal(profile.metrics.evaluationReportsCompleted, 3);
assert.equal(profile.metrics.evaluationAverageScore, malformedReport.summary.averageScore === 0 ? unauthorizedReport.summary.averageScore : malformedReport.summary.averageScore);
assert.equal(profile.metrics.tasksReceived, undefined, "controlled evaluation must not alter operational task receipt metrics");
assert.equal(runtime.getIntelligenceEvaluationReport("trend-corpus-v1")?.summary.averageScore, 100, "reports must be retrievable");
const reloaded = new AgentRuntime({ storageRoot });
assert.equal(reloaded.getIntelligenceEvaluationReport("trend-corpus-v1")?.summary.totalCases, 7, "reports must persist across reload");

const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(auditLog, /evaluation\.started/);
assert.match(auditLog, /evaluation\.case_completed/);
assert.match(auditLog, /evaluation\.case_failed/);
assert.match(auditLog, /evaluation\.case_rejected/);
assert.match(auditLog, /evaluation\.report_completed/);
const evaluationSource = readFileSync(new URL("./intelligence-evaluation-service.ts", import.meta.url), "utf8");
assert.doesNotMatch(evaluationSource, /node:|fetch\(|child_process|exec\(|spawn\(|process\.|http|https|readFile|writeFile/, "evaluation service must have no external interface");

console.log("Intelligence evaluation framework tests passed.");