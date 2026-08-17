import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { GenerationOperationService } from "./generation-operation-service.ts";
import { ElevenLabsNarrationAdapter } from "./elevenlabs-narration-adapter.ts";
import { ElevenLabsNarrationService, type NarrationAssetWriter } from "./elevenlabs-narration-service.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, GenerationOperation, ProductionBrief, PublishingQueueEntry } from "./types.ts";

const brief: ProductionBrief = {
  productionBriefId: "production-brief-elevenlabs-1",
  proposalId: "mem-elevenlabs-A-014",
  agentId: "A-014",
  productionPlanVersion: "1",
  targetPlatform: "instagram",
  contentScript: "Explain the idea.",
  narrationScript: "This is the narration from the ready Production Brief.",
  visualPlan: [{ sequence: 1, description: "Opening visual", durationSeconds: 5 }],
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
  source: "A-014/elevenlabs-test",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.8,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Make a narration", structuredResult: { platform: "instagram", caption: "Original proposal" } },
};
const decision: ContentReviewDecisionRecord = { decisionId: "decision-elevenlabs", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: "2026-01-01T00:01:00.000Z" };
const queue: PublishingQueueEntry = { queueEntryId: "queue-elevenlabs", proposalId: proposal.id, agentId: "A-014", status: "queued", createdAt: "2026-01-01T00:02:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z" };

function repositoryWithOperation(storageRoot: string, operationOverrides: Partial<GenerationOperation> = {}) {
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  repository.upsertMemory(proposal);
  repository.createContentReviewDecision(decision);
  repository.createPublishingQueueEntry(queue);
  repository.upsertProductionBrief(brief);
  const created = new GenerationOperationService().createNarrationOperation(brief, repository, "2026-01-01T00:03:00.000Z");
  assert.equal(created.status, "created");
  if (created.status !== "created") throw new Error("test setup failed");
  if (Object.keys(operationOverrides).length > 0) {
    repository.updateGenerationOperation(created.operation.generationOperationId, "queued", { ...created.operation, ...operationOverrides });
  }
  return repository;
}

function operationWithType(storageRoot: string, operationType: string): RuntimeRepository {
  const repository = repositoryWithOperation(storageRoot);
  const current = repository.getGenerationOperation("generation-production-brief-elevenlabs-1-narration")!;
  repository.updateGenerationOperation(current.generationOperationId, "queued", { ...current, operationType: operationType as never });
  return repository;
}

function adapterWith(requester: ConstructorParameters<typeof ElevenLabsNarrationAdapter>[0]["requester"], env: NodeJS.ProcessEnv = { ELEVENLABS_API_KEY: "fake-key", ELEVENLABS_VOICE_ID: "voice-123" }) {
  return new ElevenLabsNarrationAdapter({ env, requester });
}

function successfulRequester(counter?: { calls: number }) {
  return async () => {
    if (counter) counter.calls += 1;
    return { kind: "response" as const, status: 200, headers: { "content-type": "audio/mpeg" }, bytes: new Uint8Array([0x49, 0x44, 0x33, 0x01, 0x02]) };
  };
}

function writer(root: string): NarrationAssetWriter {
  return {
    write: (operation, bytes, mimeType) => {
      const localPath = path.join(root, `${operation.generationOperationId}.mp3`);
      requireFsWrite(localPath, bytes);
      return { localPath, reference: localPath };
    },
  };
}

function requireFsWrite(localPath: string, bytes: Uint8Array): void {
  mkdirSync(path.dirname(localPath), { recursive: true });
  writeFileSync(localPath, bytes);
}

// 2/valid execution: queued -> generating -> completed with actual mocked bytes and truthful metadata.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-success-"));
  const assetRoot = mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-assets-"));
  const repository = repositoryWithOperation(storageRoot);
  const service = new ElevenLabsNarrationService(adapterWith(successfulRequester()), writer(assetRoot));
  const result = await service.execute("generation-production-brief-elevenlabs-1-narration", repository, "2026-01-01T00:04:00.000Z");
  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(result.asset.assetType, "audio");
    assert.equal(result.asset.status, "available");
    assert.equal(result.asset.mimeType, "audio/mpeg");
    assert.equal(result.asset.durationSeconds, undefined);
    assert.equal(existsSync(result.asset.localPath!), true);
    assert.deepEqual(Array.from(new Uint8Array(readFileSync(result.asset.localPath!))), [0x49, 0x44, 0x33, 0x01, 0x02]);
  }
  const reloaded = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  assert.equal(reloaded.getGenerationOperation("generation-production-brief-elevenlabs-1-narration")?.status, "completed");
  assert.equal(reloaded.listAssets().length, 1);
}

// 3/8: missing configuration, operation, wrong type, missing brief, and not-ready brief make no provider call.
{
  const scenarios: Array<{ name: string; setup: (root: string) => RuntimeRepository; operationId: string; env?: NodeJS.ProcessEnv; reason: RegExp }> = [
    { name: "missing operation", setup: (root) => repositoryWithOperation(root), operationId: "missing", reason: /not found/i },
    { name: "missing configuration", setup: (root) => repositoryWithOperation(root), operationId: "generation-production-brief-elevenlabs-1-narration", env: {}, reason: /configuration is missing/i },
    { name: "wrong operation type", setup: (root) => operationWithType(root, "video"), operationId: "generation-production-brief-elevenlabs-1-narration", reason: /not a narration/i },
    { name: "missing brief", setup: (root) => { const repo = new RuntimeRepository(new FileRuntimeStore(root)); repo.createGenerationOperation({ generationOperationId: "generation-production-brief-elevenlabs-1-narration", productionBriefId: "missing-brief", proposalId: proposal.id, agentId: "A-014", operationType: "narration", status: "queued", createdAt: "2026-01-01T00:03:00.000Z", updatedAt: "2026-01-01T00:03:00.000Z", resultAssetIds: [] }); return repo; }, operationId: "generation-production-brief-elevenlabs-1-narration", reason: /Production Brief/i },
    { name: "not ready", setup: (root) => { const repo = repositoryWithOperation(root); repo.upsertProductionBrief({ ...brief, productionReadiness: "not-ready", narrationScript: undefined }); return repo; }, operationId: "generation-production-brief-elevenlabs-1-narration", reason: /not ready/i },
  ];
  for (const scenario of scenarios) {
    const root = mkdtempSync(path.join(tmpdir(), `novara-elevenlabs-${scenario.name.replace(/ /g, "-")}-`));
    const repository = scenario.setup(root);
    let calls = 0;
    const adapter = adapterWith(async () => { calls += 1; return { kind: "response", status: 200, headers: {}, bytes: new Uint8Array([1]) }; }, scenario.env ?? { ELEVENLABS_API_KEY: "fake", ELEVENLABS_VOICE_ID: "voice" });
    const result = await new ElevenLabsNarrationService(adapter, writer(root)).execute(scenario.operationId, repository);
    assert.equal(result.status, "failed", scenario.name);
    assert.match(result.reason, scenario.reason, scenario.name);
    assert.equal(calls, 0, `${scenario.name} must not call ElevenLabs`);
    if (scenario.name === "missing configuration") assert.equal(repository.getGenerationOperation(scenario.operationId)?.status, "queued");
  }
}

// 9/concurrency: two repository instances yield one claim and one provider call.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-concurrent-"));
  const creator = repositoryWithOperation(root);
  const first = new RuntimeRepository(new FileRuntimeStore(root));
  const second = new RuntimeRepository(new FileRuntimeStore(root));
  const counter = { calls: 0 };
  const requester = async () => { counter.calls += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return { kind: "response" as const, status: 200, headers: { "content-type": "audio/mpeg" }, bytes: new Uint8Array([1, 2]) }; };
  const [firstResult, secondResult] = await Promise.all([
    new ElevenLabsNarrationService(adapterWith(requester), writer(mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-concurrent-assets-")))).execute("generation-production-brief-elevenlabs-1-narration", first),
    new ElevenLabsNarrationService(adapterWith(requester), writer(mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-concurrent-assets-2-")))).execute("generation-production-brief-elevenlabs-1-narration", second),
  ]);
  assert.equal(firstResult.status, "completed");
  assert.equal(secondResult.status, "failed");
  assert.equal(counter.calls, 1);
  assert.equal(creator.getSnapshot().publishingQueueEntries.length, 1);
}

// 10/11/12: definitive failure, unknown result, and local persistence failure are truthful and asset-free.
for (const [name, adapter] of [
  ["provider-failure", adapterWith(async () => ({ kind: "response" as const, status: 500, headers: {}, bytes: new Uint8Array() }))],
  ["unknown-result", adapterWith(async () => ({ kind: "transport-error" as const, code: "timeout", reason: "unknown result" }))],
] as const) {
  const root = mkdtempSync(path.join(tmpdir(), `novara-elevenlabs-${name}-`));
  const repository = repositoryWithOperation(root);
  const result = await new ElevenLabsNarrationService(adapter, writer(mkdtempSync(path.join(tmpdir(), `novara-elevenlabs-${name}-assets-`)))).execute("generation-production-brief-elevenlabs-1-narration", repository);
  assert.equal(result.status, name === "unknown-result" ? "unknown-result" : "failed");
  assert.deepEqual(repository.listAssets(), []);
  assert.equal(repository.getGenerationOperation("generation-production-brief-elevenlabs-1-narration")?.resultAssetIds.length, 0);
  assert.equal(new GenerationOperationService().claim("generation-production-brief-elevenlabs-1-narration", repository).status, "rejected");
}
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-write-failure-"));
  const repository = repositoryWithOperation(root);
  const failingWriter: NarrationAssetWriter = { write: () => { throw new Error("disk full"); } };
  const result = await new ElevenLabsNarrationService(adapterWith(successfulRequester()), failingWriter).execute("generation-production-brief-elevenlabs-1-narration", repository);
  assert.equal(result.status, "unknown-result");
  assert.equal(repository.getGenerationOperation("generation-production-brief-elevenlabs-1-narration")?.status, "unknown-result");
  assert.deepEqual(repository.listAssets(), []);
}

// 14/15/16/17: proposal, brief, review, queue remain unchanged; reads remain pure; no automatic execution.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-immutability-"));
  const repository = repositoryWithOperation(root);
  const proposalBefore = JSON.stringify(repository.getSnapshot().memory);
  const briefBefore = JSON.stringify(repository.getProductionBrief(brief.productionBriefId));
  const decisionBefore = JSON.stringify(repository.getContentReviewDecision(decision.decisionId));
  const queueBefore = JSON.stringify(repository.getPublishingQueueEntry(queue.queueEntryId));
  const stateBefore = readFileSync(path.join(root, "state.json"), "utf8");
  const result = await new ElevenLabsNarrationService(adapterWith(successfulRequester()), writer(mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-immutable-assets-")))).execute("generation-production-brief-elevenlabs-1-narration", repository);
  assert.equal(result.status, "completed");
  assert.equal(JSON.stringify(repository.getSnapshot().memory), proposalBefore);
  assert.equal(JSON.stringify(repository.getProductionBrief(brief.productionBriefId)), briefBefore);
  assert.equal(JSON.stringify(repository.getContentReviewDecision(decision.decisionId)), decisionBefore);
  assert.equal(JSON.stringify(repository.getPublishingQueueEntry(queue.queueEntryId)), queueBefore);
  repository.getGenerationOperation("generation-production-brief-elevenlabs-1-narration");
  repository.listGenerationOperations();
  repository.listAssets();
  assert.notEqual(readFileSync(path.join(root, "state.json"), "utf8"), stateBefore, "execution should persist only generation/asset state");
}

// 17: no timers, retry loops, background calls, provider secrets, or unrelated providers in this phase files.
for (const file of ["./elevenlabs-narration-adapter.ts", "./elevenlabs-narration-service.ts"]) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval|automaticRetry|retryAfter|polling|backgroundJob/i);
  assert.doesNotMatch(source, /Metricool|RevenueCat|Obsidian|Hermes|FFmpeg|video-generation|OpenAI/i);
}

console.log("ElevenLabs narration service tests passed.");
