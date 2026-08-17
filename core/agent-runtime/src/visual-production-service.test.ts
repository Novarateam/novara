import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenerationOperationService } from "./generation-operation-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { VisualProductionService, type VisualGenerationAdapter, type VisualGenerationOutcome, type VisualAssetWriter } from "./visual-production-service.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, GenerationOperation, ProductionBrief, PublishingQueueEntry } from "./types.ts";

const brief: ProductionBrief = {
  productionBriefId: "production-brief-visual-1",
  proposalId: "mem-visual-A-014",
  agentId: "A-014",
  productionPlanVersion: "1",
  targetPlatform: "instagram",
  contentScript: "Explain the idea.",
  narrationScript: "Narrate the idea.",
  visualPlan: [{ sequence: 1, description: "Opening visual", durationSeconds: 5 }, { sequence: 2, description: "Supporting visual", durationSeconds: 10 }],
  requiredMediaType: "short-form-video",
  aspectRatio: "9:16",
  targetDurationSeconds: 20,
  captionRequirements: { burnedIn: true, language: "en" },
  productionReadiness: "ready",
  missingRequirements: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const proposal: CompanyMemoryEntry = {
  id: brief.proposalId,
  type: "evidence",
  source: "A-014/visual-test",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.8,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Create visuals", structuredResult: { platform: "instagram", caption: "Original caption" } },
};
const decision: ContentReviewDecisionRecord = { decisionId: "decision-visual", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: "2026-01-01T00:01:00.000Z" };
const queue: PublishingQueueEntry = { queueEntryId: "queue-visual", proposalId: proposal.id, agentId: "A-014", status: "queued", createdAt: "2026-01-01T00:02:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z" };

function repositoryWithBrief(root: string, selectedBrief = brief): RuntimeRepository {
  const repository = new RuntimeRepository(new FileRuntimeStore(root));
  repository.upsertMemory(proposal);
  repository.createContentReviewDecision(decision);
  repository.createPublishingQueueEntry(queue);
  repository.upsertProductionBrief(selectedBrief);
  return repository;
}

function createVisualOperation(repository: RuntimeRepository, selectedBrief = brief): GenerationOperation {
  const result = new GenerationOperationService().createVisualOperation(selectedBrief, repository, 1, "2026-01-01T00:03:00.000Z");
  assert.equal(result.status, "created");
  if (result.status !== "created") throw new Error("visual operation setup failed");
  return result.operation;
}

function adapter(outcome: VisualGenerationOutcome, calls: { count: number } = { count: 0 }): VisualGenerationAdapter {
  return { isConfigured: () => true, generate: async () => { calls.count += 1; return outcome; } };
}

function writer(root: string): VisualAssetWriter {
  return { write: (operation, asset, index) => { const localPath = path.join(root, `${operation.generationOperationId}-${index}.png`); mkdirSync(root, { recursive: true }); writeFileSync(localPath, asset.bytes); return { localPath, reference: localPath } } };
}

function successOutcome(): VisualGenerationOutcome {
  return { status: "succeeded", assets: [{ assetType: "image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }] };
}

// 1/3: visual plan is durable and tied to valid A-014 Production Brief state.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-plan-reload-"));
  const repository = repositoryWithBrief(root);
  const operation = createVisualOperation(repository);
  assert.equal(operation.productionBriefId, brief.productionBriefId);
  assert.equal(operation.proposalId, brief.proposalId);
  const reloaded = new RuntimeRepository(new FileRuntimeStore(root));
  assert.deepEqual(reloaded.getProductionBrief(brief.productionBriefId)?.visualPlan, brief.visualPlan);
}

// 4: invalid and not-ready briefs fail closed before an operation or provider call.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-invalid-"));
  const repository = repositoryWithBrief(root);
  const incomplete = { ...brief, productionBriefId: "production-brief-visual-incomplete", productionReadiness: "not-ready" as const, visualPlan: [], missingRequirements: ["visualPlan"] };
  repository.upsertProductionBrief(incomplete);
  const service = new GenerationOperationService();
  assert.equal(service.createVisualOperation(incomplete, repository, 1).status, "rejected");
  assert.equal(repository.listGenerationOperations().length, 0);
  assert.equal(service.createVisualOperation({ ...brief, productionBriefId: "missing" }, repository, 1).status, "rejected");
}

// 5/6: execution is explicit; missing provider configuration leaves queued and makes no call.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-config-"));
  const repository = repositoryWithBrief(root);
  const operation = createVisualOperation(repository);
  let calls = 0;
  const unavailable: VisualGenerationAdapter = { isConfigured: () => false, generate: async () => { calls += 1; return successOutcome(); } };
  const result = await new VisualProductionService(unavailable).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "failed");
  assert.equal(calls, 0);
  assert.equal(repository.getGenerationOperation(operation.generationOperationId)?.status, "queued");
}

// 7/8: explicit success claims, writes actual mocked bytes, and persists truthful visual metadata.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-success-"));
  const assets = mkdtempSync(path.join(tmpdir(), "novara-visual-success-assets-"));
  const repository = repositoryWithBrief(root);
  const operation = createVisualOperation(repository);
  const result = await new VisualProductionService(adapter(successOutcome()), writer(assets)).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(result.assets[0].assetType, "image");
    assert.equal(result.assets[0].status, "available");
    assert.equal(result.assets[0].mimeType, "image/png");
    assert.equal(result.assets[0].durationSeconds, undefined);
    assert.equal(existsSync(result.assets[0].localPath!), true);
  }
  const reloaded = new RuntimeRepository(new FileRuntimeStore(root));
  assert.equal(reloaded.getGenerationOperation(operation.generationOperationId)?.status, "completed");
  assert.equal(reloaded.listAssets().length, 1);
  assert.deepEqual(reloaded.getVisualSceneAssetMapping(brief.productionBriefId, 1)?.assetId, reloaded.listAssets()[0].assetId);
}

// 9/10/11: concurrent execution has one provider call; definitive and ambiguous results are terminal.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-concurrent-"));
  const creator = repositoryWithBrief(root);
  const operation = createVisualOperation(creator);
  const first = new RuntimeRepository(new FileRuntimeStore(root));
  const second = new RuntimeRepository(new FileRuntimeStore(root));
  const calls = { count: 0 };
  const sharedAdapter: VisualGenerationAdapter = { isConfigured: () => true, generate: async () => { calls.count += 1; await new Promise((resolve) => setTimeout(resolve, 15)); return successOutcome(); } };
  const [one, two] = await Promise.all([
    new VisualProductionService(sharedAdapter, writer(mkdtempSync(path.join(tmpdir(), "novara-visual-concurrent-assets-1-")))).execute(operation.generationOperationId, first),
    new VisualProductionService(sharedAdapter, writer(mkdtempSync(path.join(tmpdir(), "novara-visual-concurrent-assets-2-")))).execute(operation.generationOperationId, second),
  ]);
  assert.equal(calls.count, 1);
  assert.equal([one.status, two.status].filter((status) => status === "completed").length, 1);
}
for (const [name, outcome, expected] of [
  ["failed", { status: "failed", reason: "provider rejected" }, "failed"],
  ["unknown", { status: "unknown-result", reason: "transport ambiguous" }, "unknown-result"],
] as const) {
  const root = mkdtempSync(path.join(tmpdir(), `novara-visual-${name}-`));
  const repository = repositoryWithBrief(root);
  const operation = createVisualOperation(repository);
  const result = await new VisualProductionService(adapter(outcome)).execute(operation.generationOperationId, repository);
  assert.equal(result.status, expected);
  assert.deepEqual(repository.listAssets(), []);
  assert.equal(new GenerationOperationService().claim(operation.generationOperationId, repository).status, "rejected");
}

// 12: original proposal, brief, Content Review, Publishing Queue, and unrelated narration remain unchanged.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-immutable-"));
  const repository = repositoryWithBrief(root);
  const operation = createVisualOperation(repository);
  const before = {
    proposal: JSON.stringify(repository.getSnapshot().memory),
    brief: JSON.stringify(repository.getProductionBrief(brief.productionBriefId)),
    decision: JSON.stringify(repository.getContentReviewDecision(decision.decisionId)),
    queue: JSON.stringify(repository.getPublishingQueueEntry(queue.queueEntryId)),
  };
  await new VisualProductionService(adapter(successOutcome()), writer(mkdtempSync(path.join(tmpdir(), "novara-visual-immutable-assets-")))).execute(operation.generationOperationId, repository);
  assert.equal(JSON.stringify(repository.getSnapshot().memory), before.proposal);
  assert.equal(JSON.stringify(repository.getProductionBrief(brief.productionBriefId)), before.brief);
  assert.equal(JSON.stringify(repository.getContentReviewDecision(decision.decisionId)), before.decision);
  assert.equal(JSON.stringify(repository.getPublishingQueueEntry(queue.queueEntryId)), before.queue);
}

// 2/13/14/15: reads are pure and this phase has no provider-specific, publishing, or rendering code.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-visual-reads-"));
  const repository = repositoryWithBrief(root);
  createVisualOperation(repository);
  const statePath = path.join(root, "state.json");
  const before = readFileSync(statePath, "utf8");
  repository.getGenerationOperation("generation-production-brief-visual-1-visual");
  repository.listGenerationOperations();
  repository.listAssets();
  assert.equal(readFileSync(statePath, "utf8"), before);
  const source = readFileSync(new URL("./visual-production-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|http:\/\/|https:\/\/|Metricool|ElevenLabs|FFmpeg|render|publish|setInterval|setTimeout\(|background/i);
}

console.log("Visual production service tests passed.");
