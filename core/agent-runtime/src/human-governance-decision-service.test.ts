import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { createTrendMonitorEvaluationCorpus } from "./intelligence-evaluation-service.ts";
import { HumanGovernanceDecisionService } from "./human-governance-decision-service.ts";
import { AgentRuntime } from "./runtime.ts";
import type { AgentTrustPerformanceReport } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-governance-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
runtime.runIntelligenceEvaluation({ reportId: "governance-evaluation", agentId: "A-012", capability: "trend_monitoring", cases: createTrendMonitorEvaluationCorpus() });
const trustReport = runtime.generateTrustPerformanceReport("A-012", "governance-trust");
const before = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));

const first = runtime.recordHumanGovernanceDecision({ decisionId: "decision-a", agentId: "A-012", trustReportId: trustReport.reportId, reviewerId: "guido", decision: "continue-observation", reason: "Continue collecting operational evidence." });
assert.equal(first.status, "created");
const second = runtime.recordHumanGovernanceDecision({ decisionId: "decision-b", agentId: "A-012", trustReportId: trustReport.reportId, reviewerId: "guido", decision: "approved-for-human-review" });
assert.equal(second.status, "created");
assert.deepEqual(runtime.listAgentHumanGovernanceDecisions("A-012").map((record) => record.decisionId), ["decision-a", "decision-b"]);
assert.equal(runtime.getHumanGovernanceDecision("decision-a")?.decision, "continue-observation");
assert.equal(runtime.getHumanGovernanceDecision("decision-b")?.decision, "approved-for-human-review");
const mutable = runtime.getHumanGovernanceDecision("decision-a")!;
mutable.reason = "tamper";
assert.equal(runtime.getHumanGovernanceDecision("decision-a")?.reason, "Continue collecting operational evidence.", "returned decisions must be defensive copies");

const invalid = [
  { decisionId: "missing-reviewer", agentId: "A-012", trustReportId: trustReport.reportId, reviewerId: "", decision: "continue-observation" as const },
  { decisionId: "missing-agent", agentId: "", trustReportId: trustReport.reportId, reviewerId: "guido", decision: "continue-observation" as const },
  { decisionId: "missing-report", agentId: "A-012", trustReportId: "", reviewerId: "guido", decision: "continue-observation" as const },
  { decisionId: "invalid-decision", agentId: "A-012", trustReportId: trustReport.reportId, reviewerId: "guido", decision: "invalid" as never },
  { decisionId: "unknown-report", agentId: "A-012", trustReportId: "unknown", reviewerId: "guido", decision: "continue-observation" as const },
  { decisionId: "mismatch", agentId: "A-002", trustReportId: trustReport.reportId, reviewerId: "guido", decision: "continue-observation" as const },
];
for (const request of invalid) assert.equal(runtime.recordHumanGovernanceDecision(request).status, "rejected");
assert.equal(runtime.listAgentHumanGovernanceDecisions("A-012").length, 2, "invalid requests must not create records");

const after = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
assert.deepEqual(after.agents, before.agents, "governance decisions must not alter agents");
assert.deepEqual(after.permissionPolicies, before.permissionPolicies, "governance decisions must not alter policies");
assert.deepEqual(after.approvalRequests, before.approvalRequests, "governance decisions must not create approvals");
assert.deepEqual(after.tasks, before.tasks, "governance decisions must not create or execute tasks");
assert.deepEqual(after.trustPerformanceReports, before.trustPerformanceReports, "governance decisions must not mutate trust reports");
assert.equal(after.agents.find((agent: any) => agent.id === "A-012").authorityLevel, "recommend", "approved-for-human-review must not promote authority");
assert.equal(after.agents.find((agent: any) => agent.id === "A-012").status, "observed", "approved-for-human-review must not promote lifecycle");
assert.equal(after.agents.find((agent: any) => agent.id === "A-012").executionState, "implemented", "approved-for-human-review must not alter execution state");
const reloaded = new AgentRuntime({ storageRoot });
assert.equal(reloaded.listAgentHumanGovernanceDecisions("A-012").length, 2, "decisions must persist across reload");
const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(auditLog, /governance\.decision_recorded/);
assert.match(auditLog, /governance\.decision_rejected/);

const report: AgentTrustPerformanceReport = trustReport;
const service = new HumanGovernanceDecisionService((reportId) => reportId === report.reportId ? structuredClone(report) : undefined);
const source = HumanGovernanceDecisionService.toString();
assert.doesNotMatch(source, /approve|handoff|claim|attemptExecution|PermissionPolicy|AuthorityLevel/);

console.log("Human governance decision tests passed.");