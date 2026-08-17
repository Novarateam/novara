import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, ProductionBrief } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService } from "./production-execution-access-service.ts";
import { handleProductionApprovalCommand } from "./production-approval-command.ts";
import { executeApprovedProduction } from "./production-execution-command.ts";

const proposal: CompanyMemoryEntry = { id: "proposal-production-approval-A-014", type: "evidence", source: "A-014/approval-test", timestamp: "2026-08-13T00:00:00.000Z", confidence: 0.9, authority: "recommend", status: "proposed", content: { structuredResult: {} } };
const brief: ProductionBrief = { productionBriefId: "brief-production-approval", proposalId: proposal.id, agentId: "A-014", productionPlanVersion: "1", visualPlan: [{ sequence: 1, description: "scene", durationSeconds: 1 }], productionReadiness: "ready", missingRequirements: [], createdAt: proposal.timestamp, updatedAt: proposal.timestamp };
const access = new LocalProductionExecutionAccessService([{ identity: "human", credential: "approval-key", operations: ["decideProductionApproval"] }]);
function setup(root = mkdtempSync(path.join(tmpdir(), "novara-production-approval-"))) { const repository = new RuntimeRepository(new FileRuntimeStore(root)); repository.upsertMemory(proposal); repository.createContentReviewDecision({ decisionId: "review", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: proposal.timestamp } as ContentReviewDecisionRecord); repository.upsertProductionBrief(brief); return { root, repository }; }
function decide(repository: RuntimeRepository, decision: "approved-for-production" | "rejected-for-production") { return handleProductionApprovalCommand({ operation: "decideProductionApproval", proposalId: proposal.id, productionBriefId: brief.productionBriefId, decision }, "approval-key", repository, access); }

{
  const { root, repository } = setup();
  assert.equal(decide(repository, "approved-for-production").result.status, "created");
  assert.equal(decide(repository, "approved-for-production").result.status, "existing");
  assert.equal(decide(repository, "rejected-for-production").result.status, "conflict");
  assert.equal(new RuntimeRepository(new FileRuntimeStore(root)).getProductionApprovalByBrief(brief.productionBriefId)?.decision, "approved-for-production");
}
{
  const { repository } = setup();
  assert.equal(decide(repository, "rejected-for-production").result.status, "created");
  assert.equal(decide(repository, "rejected-for-production").result.status, "existing");
}
{
  const { repository } = setup();
  assert.equal(handleProductionApprovalCommand({ operation: "decideProductionApproval", proposalId: "wrong", productionBriefId: brief.productionBriefId, decision: "approved-for-production" }, "approval-key", repository, access).result.status, "rejected");
  repository.upsertProductionBrief({ ...brief, productionReadiness: "not-ready", missingRequirements: ["narrationScript"] });
  assert.equal(decide(repository, "approved-for-production").result.status, "rejected");
}
{
  const { root } = setup(); const first = new RuntimeRepository(new FileRuntimeStore(root)); const second = new RuntimeRepository(new FileRuntimeStore(root));
  const [left, right] = await Promise.all([Promise.resolve(decide(first, "approved-for-production")), Promise.resolve(decide(second, "rejected-for-production"))]);
  assert.equal([left.result.status, right.result.status].filter((status) => status === "created").length, 1);
  assert.equal(new RuntimeRepository(new FileRuntimeStore(root)).listProductionApprovals().length, 1);
}
{
  const { repository } = setup();
  assert.equal(decide(repository, "approved-for-production").result.status, "created");
  const revisedBrief: ProductionBrief = { ...brief, productionBriefId: "brief-production-approval-r2", revision: 2, narrationScript: "Changed narration", updatedAt: "2026-08-14T00:00:00.000Z" };
  assert.ok(repository.createProductionBrief(revisedBrief));
  assert.equal(repository.getProductionBriefByProposal(proposal.id)?.productionBriefId, revisedBrief.productionBriefId, "the highest durable revision must be current");
  assert.equal(repository.getProductionApprovalByBrief(brief.productionBriefId)?.decision, "approved-for-production", "the historical approval must remain durable");
  assert.equal(decide(repository, "approved-for-production").result.status, "rejected", "a historical brief must not receive or reuse approval after a newer revision exists");
  const staleExecution = await executeApprovedProduction(proposal.id, repository);
  assert.equal(staleExecution.status, "rejected", "an approval for the historical brief must not authorize the current revision");
  assert.match(staleExecution.reason, /current Production Brief/i);
  const currentApproval = handleProductionApprovalCommand({ operation: "decideProductionApproval", proposalId: proposal.id, productionBriefId: revisedBrief.productionBriefId, decision: "approved-for-production" }, "approval-key", repository, access);
  assert.equal(currentApproval.result.status, "created", "the new current revision requires and accepts its own explicit approval");
}
console.log("Production approval command tests passed.");