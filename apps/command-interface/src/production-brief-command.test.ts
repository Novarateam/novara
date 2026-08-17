import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService } from "./production-execution-access-service.ts";
import { handleProductionApprovalCommand } from "./production-approval-command.ts";
import { handleProductionBriefCommand } from "./production-brief-command.ts";
import { executeApprovedProduction } from "./production-execution-command.ts";

const access = new LocalProductionExecutionAccessService([{ identity: "human-producer", credential: "brief-key", operations: ["normalizeProductionBrief"] }]);
const approvalAccess = new LocalProductionExecutionAccessService([{ identity: "human-producer", credential: "approval-key", operations: ["decideProductionApproval"] }]);
const proposal = (plan: Record<string, unknown> | undefined): CompanyMemoryEntry => ({
  id: "proposal-production-brief-A-014",
  type: "evidence",
  source: "A-014/production-brief-command",
  timestamp: "2026-08-14T00:00:00.000Z",
  confidence: 0.9,
  authority: "recommend",
  status: "proposed",
  content: { structuredResult: { platform: "instagram", ...(plan ? { productionPlan: plan } : {}) } },
});
const completePlan = {
  contentScript: "Show the proof.",
  narrationScript: "Here is the proof.",
  visualPlan: [{ sequence: 1, description: "Proof card", durationSeconds: 2 }],
  requiredMediaType: "short-form-video",
  aspectRatio: "9:16",
  targetDurationSeconds: 2,
  captionRequirements: { burnedIn: true, language: "en" },
};

function repositoryWith(entry: CompanyMemoryEntry, review?: "approved" | "rejected") {
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-brief-command-"));
  const repository = new RuntimeRepository(new FileRuntimeStore(root));
  repository.upsertMemory(entry);
  if (review) repository.createContentReviewDecision({ decisionId: `review-${review}`, proposalId: entry.id, agentId: "A-014", reviewerId: "human", decision: review, recordedAt: entry.timestamp } as ContentReviewDecisionRecord);
  return { root, repository };
}

function normalize(repository: RuntimeRepository, proposalId = proposal(undefined).id) {
  return handleProductionBriefCommand({ operation: "normalizeProductionBrief", proposalId }, "brief-key", repository, access);
}

assert.equal(handleProductionBriefCommand({ operation: "normalizeProductionBrief", proposalId: "missing" }, "brief-key", new RuntimeRepository(new FileRuntimeStore(mkdtempSync(path.join(tmpdir(), "novara-production-brief-missing-")))), access).result.status, "rejected");

{
  const invalid = { ...proposal(undefined), id: "proposal-production-brief-A-002", source: "A-002/not-content" };
  const { repository } = repositoryWith(invalid, "approved");
  assert.equal(normalize(repository, invalid.id).result.status, "rejected");
}
{
  const { repository } = repositoryWith(proposal(undefined));
  assert.equal(normalize(repository).result.status, "rejected");
}
{
  const { repository } = repositoryWith(proposal(undefined), "rejected");
  assert.equal(normalize(repository).result.status, "rejected");
}
{
  const { repository } = repositoryWith(proposal(undefined), "approved");
  const result = normalize(repository);
  assert.equal(result.status, "ok");
  if (result.status === "ok" && result.result.status !== "rejected") {
    assert.equal(result.result.status, "created");
    assert.equal(result.result.brief.productionReadiness, "not-ready");
    assert.deepEqual(result.result.brief.missingRequirements, ["contentScript", "narrationScript", "visualPlan", "requiredMediaType", "aspectRatio", "targetDurationSeconds", "captionRequirements"]);
  }
  assert.equal(repository.listProductionApprovals().length, 0);
  assert.equal(repository.listGenerationOperations().length, 0);
  assert.equal(repository.listAssets().length, 0);
}
{
  const { repository } = repositoryWith(proposal({ contentScript: "Only a partial plan." }), "approved");
  const result = normalize(repository);
  assert.equal(result.status, "ok");
  if (result.status === "ok" && result.result.status !== "rejected") {
    assert.equal(result.result.brief.productionReadiness, "not-ready");
    assert.ok(result.result.brief.missingRequirements.includes("narrationScript"));
  }
}
{
  const { root, repository } = repositoryWith(proposal(completePlan), "approved");
  const first = normalize(repository);
  assert.equal(first.status, "ok");
  if (first.status === "ok" && first.result.status !== "rejected") {
    assert.equal(first.result.status, "created");
    assert.equal(first.result.brief.productionReadiness, "ready");
    assert.equal(first.result.brief.revision, 1);
  }
  const repeated = normalize(repository);
  assert.equal(repeated.status, "ok");
  if (repeated.status === "ok" && repeated.result.status !== "rejected") assert.equal(repeated.result.status, "unchanged");

  const changed = proposal({ ...completePlan, narrationScript: "Changed narration requires a new approval." });
  repository.upsertMemory(changed);
  const revision = normalize(repository);
  assert.equal(revision.status, "ok");
  if (revision.status === "ok" && revision.result.status !== "rejected" && first.status === "ok" && first.result.status !== "rejected") {
    assert.equal(revision.result.status, "updated");
    assert.equal(revision.result.brief.revision, 2);
    assert.notEqual(revision.result.brief.productionBriefId, first.result.brief.productionBriefId);
    assert.equal(repository.getProductionBrief(first.result.brief.productionBriefId)?.productionBriefId, first.result.brief.productionBriefId);
  }
  assert.equal(repository.listProductionApprovals().length, 0, "normalization must not approve production");
  assert.equal(repository.listGenerationOperations().length, 0, "normalization must not execute production");
  assert.equal(repository.listAssets().length, 0, "normalization must not create assets");
  assert.equal(new RuntimeRepository(new FileRuntimeStore(root)).listProductionBriefsByProposal(changed.id).length, 2, "historical brief revisions must survive reload");
}
{
  const { root, repository } = repositoryWith(proposal(completePlan), "approved");
  const first = normalize(repository);
  assert.equal(first.status, "ok");
  if (first.status !== "ok" || first.result.status === "rejected") throw new Error("Test setup did not create Production Brief A.");
  const briefA = first.result.brief;

  // This repository snapshot represents an approval command that began before a later normalization.
  const staleApprovalRepository = new RuntimeRepository(new FileRuntimeStore(root));
  const normalizationRepository = new RuntimeRepository(new FileRuntimeStore(root));
  const changed = proposal({ ...completePlan, narrationScript: "Revision B must require its own approval." });
  normalizationRepository.upsertMemory(changed);
  const revised = normalize(normalizationRepository);
  assert.equal(revised.status, "ok");
  if (revised.status !== "ok" || revised.result.status === "rejected") throw new Error("Test setup did not create Production Brief B.");
  const briefB = revised.result.brief;
  assert.notEqual(briefA.productionBriefId, briefB.productionBriefId);

  const lateHistoricalApproval = handleProductionApprovalCommand({ operation: "decideProductionApproval", proposalId: changed.id, productionBriefId: briefA.productionBriefId, decision: "approved-for-production" }, "approval-key", staleApprovalRepository, approvalAccess);
  assert.equal(lateHistoricalApproval.result.status, "created", "a pre-existing command snapshot may record historical approval A after B becomes current");

  const reloaded = new RuntimeRepository(new FileRuntimeStore(root));
  assert.equal(reloaded.getProductionBriefByProposal(changed.id)?.productionBriefId, briefB.productionBriefId, "B remains the current durable brief");
  assert.equal(reloaded.getProductionApprovalByBrief(briefA.productionBriefId)?.decision, "approved-for-production", "A approval remains historical evidence");
  assert.equal(reloaded.getProductionApprovalByBrief(briefB.productionBriefId), undefined, "B has no inherited approval");
  const execution = await executeApprovedProduction(changed.id, reloaded);
  assert.equal(execution.status, "rejected", "historical approval A cannot authorize current brief B");
  assert.match(execution.reason, /current Production Brief/i);
}

assert.equal(handleProductionBriefCommand({ operation: "normalizeProductionBrief", proposalId: proposal(undefined).id }, undefined, new RuntimeRepository(new FileRuntimeStore(mkdtempSync(path.join(tmpdir(), "novara-production-brief-access-")))), access).status, "invalid-request");
const source = readFileSync(new URL("./production-brief-command.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /fetch\(|OpenAI|ElevenLabs|FFmpeg|Metricool|produceApprovedContent|createGenerationOperation/i);
console.log("Production Brief command tests passed.");