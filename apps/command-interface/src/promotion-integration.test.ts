import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "../../../core/agent-runtime/src/agent.ts";
import { createTrendMonitorEvaluationCorpus } from "../../../core/agent-runtime/src/intelligence-evaluation-service.ts";
import { AgentRuntime } from "../../../core/agent-runtime/src/runtime.ts";
import { LocalPromotionAccessService } from "./promotion-access-service.ts";
import { handlePromotionCommand, type PromotionWorkflow } from "./promotion-command.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-promotion-integration-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
runtime.runIntelligenceEvaluation({ reportId: "integration-evaluation", agentId: "A-012", capability: "trend_monitoring", cases: createTrendMonitorEvaluationCorpus() });
for (let index = 0; index < 5; index += 1) {
  const action = { actionId: `integration-task-${index}`, agentId: "A-012", actionType: "research" as const, capability: "trend_monitoring", purpose: "trend", target: "internal", scope: "company" as const, impactLevel: "low" as const, requestedAt: new Date().toISOString(), operation: "analyse_trend" as const, operationInput: { values: [10, 12, 14, 16] } };
  runtime.evaluateAction(action);
  const handoff = runtime.handoffTask({ actionId: action.actionId, taskId: `integration-task-record-${index}` });
  runtime.claimTask({ taskId: handoff.task!.id, claimingAgentId: "A-012" });
  runtime.attemptExecution({ taskId: handoff.task!.id });
}
const trust = runtime.generateTrustPerformanceReport("A-012", "integration-trust");
const governance = runtime.recordHumanGovernanceDecision({ decisionId: "integration-governance", agentId: "A-012", trustReportId: trust.reportId, reviewerId: "governor", decision: "approved-for-human-review" });
assert.equal(governance.status, "created");
const access = new LocalPromotionAccessService([
  { identity: "proposer", credential: "proposal-key", operations: ["createPromotionProposal"] },
  { identity: "confirmer", credential: "confirm-key", operations: ["confirmPromotion"] },
  { identity: "applier", credential: "apply-key", operations: ["applyPromotion"] },
]);
const accessAudits: unknown[] = [];
const workflow: PromotionWorkflow = {
  createPromotionProposal: (input) => runtime.createPromotionProposal(input),
  confirmPromotion: (input) => runtime.confirmPromotion(input),
  applyPromotion: (input) => runtime.applyPromotion(input),
  recordAccessAudit: (input) => accessAudits.push(input),
};
const before = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
const rejectedBeforeProposal = handlePromotionCommand({ operation: "applyPromotion", promotionId: "promotion", proposalId: "proposal", confirmationId: "confirmation" }, "apply-key", workflow, access);
assert.equal(rejectedBeforeProposal.status, "ok");
if (rejectedBeforeProposal.status === "ok") assert.equal(rejectedBeforeProposal.result.status, "rejected");
assert.equal(handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "proposal", agentId: "A-012", trustReportId: trust.reportId, governanceDecisionId: "integration-governance", promotionType: "observed-to-trusted" }, undefined, workflow, access).status, "invalid-request");
assert.equal(handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "proposal", agentId: "A-012", trustReportId: trust.reportId, governanceDecisionId: "integration-governance", promotionType: "observed-to-trusted" }, "invalid-key", workflow, access).status, "invalid-request");
assert.equal(handlePromotionCommand({ operation: "confirmPromotion", confirmationId: "confirmation", proposalId: "proposal", reviewerId: "impersonated", confirmation: "confirm-promotion" }, "proposal-key", workflow, access).status, "invalid-request");
assert.equal(handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "bad-link", agentId: "A-002", trustReportId: trust.reportId, governanceDecisionId: "integration-governance", promotionType: "observed-to-trusted" }, "proposal-key", workflow, access).status, "ok");
const proposal = handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "proposal", agentId: "A-012", trustReportId: trust.reportId, governanceDecisionId: "integration-governance", promotionType: "observed-to-trusted", authorityLevel: "delegate" } as never, "proposal-key", workflow, access);
assert.equal(proposal.status, "ok");
if (proposal.status === "ok") assert.equal(proposal.result.status, "created");
const afterProposal = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
assert.deepEqual(afterProposal.agents, before.agents, "proposal must not mutate agent state");
assert.equal(handlePromotionCommand({ operation: "applyPromotion", promotionId: "promotion", proposalId: "proposal", confirmationId: "confirmation" }, "confirm-key", workflow, access).status, "invalid-request", "confirmation identity cannot apply");
const confirmation = handlePromotionCommand({ operation: "confirmPromotion", confirmationId: "confirmation", proposalId: "proposal", reviewerId: "impersonated", confirmation: "confirm-promotion" }, "confirm-key", workflow, access);
assert.equal(confirmation.status, "ok");
if (confirmation.status === "ok") assert.equal(confirmation.result.status, "confirmed");
assert.equal(runtime.getPromotionConfirmation("confirmation")?.reviewerId, "confirmer", "authenticated identity must bind confirmation");
const afterConfirmation = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
assert.deepEqual(afterConfirmation.agents, before.agents, "confirmation must not mutate agent state");
assert.equal(handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "another", agentId: "A-012", trustReportId: trust.reportId, governanceDecisionId: "integration-governance", promotionType: "observed-to-trusted" }, "apply-key", workflow, access).status, "invalid-request", "apply identity cannot create proposal");
const applied = handlePromotionCommand({ operation: "applyPromotion", promotionId: "promotion", proposalId: "proposal", confirmationId: "confirmation" }, "apply-key", workflow, access);
assert.equal(applied.status, "ok");
if (applied.status === "ok") assert.equal(applied.result.status, "applied");
const after = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
const beforeAgent = before.agents.find((agent: any) => agent.id === "A-012");
const afterAgent = after.agents.find((agent: any) => agent.id === "A-012");
assert.equal(afterAgent.status, "trusted");
assert.equal(afterAgent.authorityLevel, beforeAgent.authorityLevel);
assert.equal(afterAgent.executionState, beforeAgent.executionState);
assert.deepEqual(afterAgent.capabilities, beforeAgent.capabilities);
assert.deepEqual(afterAgent.approvalRequirements, beforeAgent.approvalRequirements);
assert.deepEqual(after.permissionPolicies, before.permissionPolicies);
assert.deepEqual(after.approvalRequests, before.approvalRequests);
assert.equal(after.tasks.length, before.tasks.length, "promotion must not create tasks");
assert.equal(runtime.applyPromotion({ promotionId: "repeat", proposalId: "proposal", confirmationId: "confirmation" }).status, "rejected", "duplicate application must reject");
const reloaded = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) reloaded.registerAgent(definition);
const stateAfterReload = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
assert.equal(stateAfterReload.agents.find((agent: any) => agent.id === "A-012").status, "trusted");
assert.equal(reloaded.getTrustPerformanceReport(trust.reportId)?.agentId, "A-012");
assert.equal(reloaded.getHumanGovernanceDecision("integration-governance")?.trustReportId, trust.reportId);
assert.equal(reloaded.getPromotionProposal("proposal")?.trustReportId, trust.reportId);
assert.equal(reloaded.getPromotionConfirmation("confirmation")?.reviewerId, "confirmer");
assert.equal(reloaded.listPromotionHistory().length, 1);
const audit = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(audit, /promotion\.proposal_created/);
assert.match(audit, /promotion\.confirmed/);
assert.match(audit, /promotion\.applied/);
assert.match(audit, /promotion\.apply_rejected/);
assert.ok(accessAudits.length >= 4, "access failures must be recorded without credentials");
assert.doesNotMatch(audit, /proposal-key|confirm-key|apply-key|invalid-key/);
console.log("Promotion end-to-end integration tests passed.");
