import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { GenerationOperationService } from "./generation-operation-service.ts";
import type { AssetMetadata, CompanyMemoryEntry, ContentReviewDecisionRecord, GenerationOperation, ProductionBrief, PublishingQueueEntry } from "./types.ts";

const brief: ProductionBrief = {
  productionBriefId: "production-brief-generation-1",
  proposalId: "mem-generation-A-014",
  agentId: "A-014",
  productionPlanVersion: "1",
  targetPlatform: "instagram",
  contentScript: "Explain the useful idea.",
  narrationScript: "Here is the useful idea.",
  visualPlan: [{ sequence: 1, description: "Branded opening", durationSeconds: 5 }],
  requiredMediaType: "short-form-video",
  aspectRatio: "9:16",
  targetDurationSeconds: 20,
  captionRequirements: { burnedIn: true, language: "en" },
  productionReadiness: "ready",
  missingRequirements: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const incompleteBrief: ProductionBrief = {
  ...brief,
  productionBriefId: "production-brief-generation-incomplete",
  proposalId: "mem-generation-incomplete-A-014",
  narrationScript: undefined,
  productionReadiness: "not-ready",
  missingRequirements: ["narrationScript"],
};

const proposal: CompanyMemoryEntry = {
  id: brief.proposalId,
  type: "evidence",
  source: "A-014/generation-test",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.8,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Create a short video", structuredResult: { platform: "instagram", caption: "Original proposal content" } },
};
const decision: ContentReviewDecisionRecord = {
  decisionId: "decision-generation",
  proposalId: proposal.id,
  agentId: "A-014",
  reviewerId: "human",
  decision: "approved",
  recordedAt: "2026-01-01T00:01:00.000Z",
};
const queueEntry: PublishingQueueEntry = {
  queueEntryId: "queue-generation",
  proposalId: proposal.id,
  agentId: "A-014",
  status: "queued",
  createdAt: "2026-01-01T00:02:00.000Z",
  updatedAt: "2026-01-01T00:02:00.000Z",
};

function repositoryWithBrief(storageRoot: string): RuntimeRepository {
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  repository.upsertMemory(proposal);
  repository.createContentReviewDecision(decision);
  repository.createPublishingQueueEntry(queueEntry);
  repository.upsertProductionBrief(brief);
  return repository;
}

function asset(operation: GenerationOperation): AssetMetadata {
  return {
    assetId: "asset-generation-audio-1",
    generationOperationId: operation.generationOperationId,
    productionBriefId: operation.productionBriefId,
    proposalId: operation.proposalId,
    assetType: "audio",
    status: "metadata-only",
    createdAt: "2026-01-01T00:04:00.000Z",
    updatedAt: "2026-01-01T00:04:00.000Z",
  };
}

// A/N: a valid brief creates one queued narration operation and no asset.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-create-"));
  const repository = repositoryWithBrief(storageRoot);
  const result = new GenerationOperationService().createNarrationOperation(brief, repository, "2026-01-01T00:03:00.000Z");
  assert.equal(result.status, "created");
  if (result.status === "created") {
    assert.equal(result.operation.operationType, "narration");
    assert.equal(result.operation.status, "queued");
    assert.deepEqual(result.operation.resultAssetIds, []);
  }
  assert.deepEqual(repository.listAssets(), [], "operation creation must not create an asset");
}

// B/C: incomplete or non-existent durable briefs cannot create operations.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-reject-"));
  const repository = repositoryWithBrief(storageRoot);
  repository.upsertProductionBrief(incompleteBrief);
  const service = new GenerationOperationService();
  const incomplete = service.createNarrationOperation(incompleteBrief, repository);
  assert.equal(incomplete.status, "rejected");
  assert.match((incomplete as { reason: string }).reason, /not ready/i);
  const missing = service.createNarrationOperation({ ...brief, productionBriefId: "missing-brief" }, repository);
  assert.equal(missing.status, "rejected");
  assert.match((missing as { reason: string }).reason, /does not exist/i);
}

// D: repeated creation returns the existing operation and never duplicates it.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-duplicate-"));
  const repository = repositoryWithBrief(storageRoot);
  const service = new GenerationOperationService();
  const first = service.createNarrationOperation(brief, repository, "2026-01-01T00:03:00.000Z");
  const second = service.createNarrationOperation(brief, repository, "2026-01-01T00:05:00.000Z");
  assert.equal(first.status, "created");
  assert.equal(second.status, "existing");
  assert.equal(repository.listGenerationOperations().length, 1);
}

// E/G/H/I: reloads preserve operations, briefs, proposals, decisions, and queue entries unchanged.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-reload-"));
  const repository = repositoryWithBrief(storageRoot);
  const originalBrief = JSON.stringify(repository.getProductionBrief(brief.productionBriefId));
  const originalProposal = JSON.stringify(repository.getSnapshot().memory.find((entry) => entry.id === proposal.id));
  const originalDecision = JSON.stringify(repository.getContentReviewDecision(decision.decisionId));
  const originalQueue = JSON.stringify(repository.getPublishingQueueEntry(queueEntry.queueEntryId));
  new GenerationOperationService().createNarrationOperation(brief, repository);
  const reloaded = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  assert.ok(reloaded.getGenerationOperation("generation-production-brief-generation-1-narration"));
  assert.equal(JSON.stringify(reloaded.getProductionBrief(brief.productionBriefId)), originalBrief);
  assert.equal(JSON.stringify(reloaded.getSnapshot().memory.find((entry) => entry.id === proposal.id)), originalProposal);
  assert.equal(JSON.stringify(reloaded.getContentReviewDecision(decision.decisionId)), originalDecision);
  assert.equal(JSON.stringify(reloaded.getPublishingQueueEntry(queueEntry.queueEntryId)), originalQueue);
}

// F/J/K: the queued-to-generating claim is durable and only one concurrent repository claimant wins.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-claim-"));
  const creator = repositoryWithBrief(storageRoot);
  const created = new GenerationOperationService().createNarrationOperation(brief, creator, "2026-01-01T00:03:00.000Z");
  assert.equal(created.status, "created");
  const operationId = created.operation.generationOperationId;
  const firstRepository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const secondRepository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const service = new GenerationOperationService();
  const first = service.claim(operationId, firstRepository, "2026-01-01T00:04:00.000Z");
  const second = service.claim(operationId, secondRepository, "2026-01-01T00:04:01.000Z");
  assert.equal(first.status, "updated");
  assert.equal(second.status, "rejected");
  assert.equal(new RuntimeRepository(new FileRuntimeStore(storageRoot)).getGenerationOperation(operationId)?.status, "generating");
}

// L/M: terminal operations cannot be reclaimed; unknown-result never creates assets or retries.
for (const terminal of ["completed", "failed", "unknown-result"] as const) {
  const storageRoot = mkdtempSync(path.join(tmpdir(), `novara-generation-terminal-${terminal}-`));
  const repository = repositoryWithBrief(storageRoot);
  const service = new GenerationOperationService();
  const created = service.createNarrationOperation(brief, repository);
  assert.equal(created.status, "created");
  const operationId = created.operation.generationOperationId;
  assert.equal(service.claim(operationId, repository).status, "updated");
  if (terminal === "completed") assert.equal(service.complete(operationId, [asset(repository.getGenerationOperation(operationId)!)], repository).status, "updated");
  if (terminal === "failed") assert.equal(service.fail(operationId, "definitive test failure", repository).status, "updated");
  if (terminal === "unknown-result") assert.equal(service.markUnknown(operationId, "ambiguous test timeout", repository).status, "updated");
  assert.equal(service.claim(operationId, repository).status, "rejected");
  assert.deepEqual(repository.listAssets().map((item) => item.assetId), terminal === "completed" ? ["asset-generation-audio-1"] : []);
}

// O/P: assets are created only by successful explicit completion and persist on reload.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-assets-"));
  const repository = repositoryWithBrief(storageRoot);
  const service = new GenerationOperationService();
  const created = service.createNarrationOperation(brief, repository);
  assert.equal(created.status, "created");
  const operationId = created.operation.generationOperationId;
  assert.equal(service.claim(operationId, repository).status, "updated");
  const generating = repository.getGenerationOperation(operationId)!;
  const completed = service.complete(operationId, [asset(generating)], repository, "2026-01-01T00:05:00.000Z");
  assert.equal(completed.status, "updated");
  assert.equal(repository.getAsset("asset-generation-audio-1")?.status, "metadata-only");
  assert.deepEqual(repository.getGenerationOperation(operationId)?.resultAssetIds, ["asset-generation-audio-1"]);
  const reloaded = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  assert.ok(reloaded.getAsset("asset-generation-audio-1"));
}

// Q: the added generation service is inert and contains no provider, network, rendering, or hosting path.
{
  const source = readFileSync(new URL("./generation-operation-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|http:\/\/|https:\/\//i);
  assert.doesNotMatch(source, /ElevenLabs|OpenAI|FFmpeg|Metricool|RevenueCat|Obsidian|fetch\(|hosting/i);
}

// F: repeated repository reads do not mutate state or create audit records.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-generation-reads-"));
  const repository = repositoryWithBrief(storageRoot);
  new GenerationOperationService().createNarrationOperation(brief, repository);
  const statePath = path.join(storageRoot, "state.json");
  const auditPath = path.join(storageRoot, "audit.log");
  const stateBefore = readFileSync(statePath, "utf8");
  const auditBefore = existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "";
  repository.getGenerationOperation("generation-production-brief-generation-1-narration");
  repository.listGenerationOperations();
  repository.getAsset("missing-asset");
  repository.listAssets();
  assert.equal(readFileSync(statePath, "utf8"), stateBefore);
  assert.equal(existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "", auditBefore);
}

console.log("Generation operation service tests passed.");
