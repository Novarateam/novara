import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { ElevenLabsForcedAlignmentAdapter } from "./elevenlabs-forced-alignment-adapter.ts";
import { ElevenLabsNarrationAdapter } from "./elevenlabs-narration-adapter.ts";
import { ElevenLabsNarrationService, LocalNarrationAssetWriter } from "./elevenlabs-narration-service.ts";
import { FFmpegVideoRenderService } from "./ffmpeg-video-render-service.ts";
import { GenerationOperationService } from "./generation-operation-service.ts";
import { NarrationAlignmentService } from "./narration-alignment-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { normalizeAndPersistProductionBrief } from "./production-brief-service.ts";
import { LocalSubtitleAssetWriter, SubtitleGenerationService } from "./subtitle-generation-service.ts";
import { LocalVisualAssetWriter, VisualProductionService, type VisualGenerationAdapter } from "./visual-production-service.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, PublishingQueueEntry } from "./types.ts";

const narrationText = "Build trust first. Then show the proof.";
const proposal: CompanyMemoryEntry = {
  id: "proposal-e2e-A-014",
  type: "evidence",
  source: "A-014/e2e-local-test",
  timestamp: "2026-08-13T00:00:00.000Z",
  confidence: 0.9,
  authority: "recommend",
  status: "proposed",
  content: {
    objective: "Produce one truthful local content video.",
    structuredResult: {
      summary: "A ready local production proposal.", platform: "instagram", hook: "Trust needs proof.", title: "Trust", caption: "A local test caption.", hashtags: ["novara"], angle: "education", confidence: 0.9, reasons: ["Explicit plan"], humanReviewRequired: true,
      productionPlan: {
        productionPlanVersion: "1", targetPlatform: "instagram", contentScript: "Build trust and demonstrate proof.", narrationScript: narrationText,
        visualPlan: [{ sequence: 1, description: "Blue opening card", durationSeconds: 2 }, { sequence: 2, description: "Green proof card", durationSeconds: 2 }],
        requiredMediaType: "short-form-video", aspectRatio: "9:16", targetDurationSeconds: 4, captionRequirements: { burnedIn: true, language: "en" },
      },
    },
  },
};
const decision: ContentReviewDecisionRecord = { decisionId: "decision-e2e", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: "2026-08-13T00:01:00.000Z" };
const queue: PublishingQueueEntry = { queueEntryId: "queue-e2e", proposalId: proposal.id, agentId: "A-014", status: "queued", createdAt: "2026-08-13T00:02:00.000Z", updatedAt: "2026-08-13T00:02:00.000Z" };

function requireFfmpeg(executable: "ffmpeg" | "ffprobe"): void {
  assert.equal(spawnSync(executable, ["-version"], { windowsHide: true, stdio: "ignore" }).status, 0, `${executable} must be installed for this local integration test`);
}

function createFixtures(root: string): { imageBytes: Uint8Array[]; mp3Bytes: Uint8Array } {
  requireFfmpeg("ffmpeg"); requireFfmpeg("ffprobe");
  const imagePaths = [path.join(root, "fixture-blue.png"), path.join(root, "fixture-green.png")];
  for (const [index, color] of ["blue", "green"].entries()) {
    assert.equal(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=320x240`, "-frames:v", "1", "-y", imagePaths[index]], { windowsHide: true }).status, 0);
  }
  const mp3Path = path.join(root, "fixture.mp3");
  assert.equal(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:a", "libmp3lame", "-y", mp3Path], { windowsHide: true }).status, 0);
  return { imageBytes: imagePaths.map((filePath) => new Uint8Array(readFileSync(filePath))), mp3Bytes: new Uint8Array(readFileSync(mp3Path)) };
}

function createRepository(root: string): { repository: RuntimeRepository; briefId: string } {
  const repository = new RuntimeRepository(new FileRuntimeStore(root));
  repository.upsertMemory(proposal);
  repository.createContentReviewDecision(decision);
  repository.createPublishingQueueEntry(queue);
  const normalized = normalizeAndPersistProductionBrief(proposal, repository, "2026-08-13T00:03:00.000Z");
  assert.equal(normalized?.status, "created");
  assert.equal(normalized?.brief.productionReadiness, "ready");
  return { repository, briefId: normalized!.brief.productionBriefId };
}

// One deliberate, foreground-only composition of all existing content-production services.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-content-pipeline-e2e-"));
  const assetRoot = path.join(root, "assets");
  const fixtures = createFixtures(root);
  const { repository, briefId } = createRepository(root);
  const operations = new GenerationOperationService();
  const brief = repository.getProductionBrief(briefId)!;
  const proposalBefore = JSON.stringify(repository.getSnapshot().memory.find((entry) => entry.id === proposal.id));
  const briefBefore = JSON.stringify(brief);
  const decisionBefore = JSON.stringify(repository.getContentReviewDecision(decision.decisionId));
  const queueBefore = JSON.stringify(repository.getPublishingQueueEntry(queue.queueEntryId));

  const visualAdapter: VisualGenerationAdapter = {
    isConfigured: () => true,
    generate: async (request) => ({ status: "succeeded", assets: [{ assetType: "image", bytes: fixtures.imageBytes[request.sceneSequence - 1], mimeType: "image/png" }] }),
  };
  for (const scene of brief.visualPlan) {
    const created = operations.createVisualOperation(brief, repository, scene.sequence);
    assert.equal(created.status, "created");
    const result = await new VisualProductionService(visualAdapter, new LocalVisualAssetWriter(assetRoot)).execute(created.operation.generationOperationId, repository);
    assert.equal(result.status, "completed");
    if (result.status === "completed") {
      assert.equal(result.assets.length, 1);
      assert.equal(result.assets[0].proposalId, proposal.id);
      assert.equal(result.assets[0].productionBriefId, brief.productionBriefId);
      assert.equal(existsSync(result.assets[0].localPath!), true);
    }
  }
  const mappings = repository.listVisualSceneAssetMappings(brief.productionBriefId);
  assert.deepEqual(mappings.map((mapping) => mapping.sceneSequence), [1, 2]);
  assert.ok(mappings.every((mapping) => repository.getGenerationOperation(mapping.generationOperationId)?.status === "completed" && repository.getAsset(mapping.assetId)?.assetType === "image"));

  const narrationCreated = operations.createNarrationOperation(brief, repository);
  assert.equal(narrationCreated.status, "created");
  let narratedText: string | undefined;
  const narrationAdapter = new ElevenLabsNarrationAdapter({
    env: { ELEVENLABS_API_KEY: "test-key", ELEVENLABS_VOICE_ID: "test-voice" },
    requester: async (request) => { narratedText = (JSON.parse(request.body) as { text: string }).text; return { kind: "response", status: 200, headers: { "content-type": "audio/mpeg" }, bytes: fixtures.mp3Bytes }; },
  });
  const narrationResult = await new ElevenLabsNarrationService(narrationAdapter, new LocalNarrationAssetWriter(assetRoot)).execute(narrationCreated.operation.generationOperationId, repository);
  assert.equal(narrationResult.status, "completed");
  assert.equal(narratedText, narrationText);
  if (narrationResult.status !== "completed") throw new Error("narration setup failed");
  assert.equal(existsSync(narrationResult.asset.localPath!), true);

  const alignmentCreated = operations.createAlignmentOperation(brief, repository);
  assert.equal(alignmentCreated.status, "created");
  const alignmentAdapter = new ElevenLabsForcedAlignmentAdapter({
    env: { ELEVENLABS_API_KEY: "test-key" },
    requester: async () => ({ kind: "response", status: 200, bytes: new TextEncoder().encode(JSON.stringify({
      characters: [{ text: "B", start: 0, end: 0.1 }],
      words: [{ text: "Build", start: 0, end: 0.45, loss: 0.01 }, { text: "trust", start: 0.46, end: 0.9, loss: 0.01 }, { text: "first.", start: 0.91, end: 1.2, loss: 0.01 }, { text: "Then", start: 1.7, end: 2.0, loss: 0.01 }, { text: "show", start: 2.01, end: 2.3, loss: 0.01 }, { text: "the", start: 2.31, end: 2.5, loss: 0.01 }, { text: "proof.", start: 2.51, end: 3.0, loss: 0.01 }], loss: 0.01,
    })) }),
  });
  const alignmentResult = await new NarrationAlignmentService(alignmentAdapter).execute(alignmentCreated.operation.generationOperationId, repository);
  assert.equal(alignmentResult.status, "completed");
  if (alignmentResult.status !== "completed") throw new Error("alignment setup failed");
  assert.equal(alignmentResult.alignment.narrationAssetId, narrationResult.asset.assetId);
  assert.equal(alignmentResult.alignment.narrationText, narrationText);
  assert.ok(alignmentResult.alignment.words.every((word, index, words) => index === 0 || word.start >= words[index - 1].end));

  const subtitleCreated = operations.createSubtitleOperation(brief, repository);
  assert.equal(subtitleCreated.status, "created");
  const subtitleResult = new SubtitleGenerationService(new LocalSubtitleAssetWriter(assetRoot)).execute(subtitleCreated.operation.generationOperationId, repository);
  assert.equal(subtitleResult.status, "completed");
  if (subtitleResult.status !== "completed") throw new Error("subtitle setup failed");
  assert.equal(subtitleResult.assets.length, 2);
  const srtAsset = subtitleResult.assets.find((asset) => asset.mimeType === "application/x-subrip")!;
  assert.equal(readFileSync(srtAsset.localPath!, "utf8"), "1\n00:00:00,000 --> 00:00:01,200\nBuild trust first.\n\n2\n00:00:01,700 --> 00:00:03,000\nThen show the proof.\n");
  assert.ok(subtitleResult.assets.every((asset) => existsSync(asset.localPath!) && asset.proposalId === proposal.id && asset.productionBriefId === brief.productionBriefId));

  const videoCreated = operations.createVideoOperation(brief, repository);
  assert.equal(videoCreated.status, "created");
  const firstRenderer = new RuntimeRepository(new FileRuntimeStore(root));
  const secondRenderer = new RuntimeRepository(new FileRuntimeStore(root));
  const [firstRender, secondRender] = await Promise.all([
    new FFmpegVideoRenderService({ config: { assetRoot } }).execute(videoCreated.operation.generationOperationId, firstRenderer),
    new FFmpegVideoRenderService({ config: { assetRoot } }).execute(videoCreated.operation.generationOperationId, secondRenderer),
  ]);
  assert.equal([firstRender.status, secondRender.status].filter((status) => status === "completed").length, 1);
  const videoAsset = new RuntimeRepository(new FileRuntimeStore(root)).listAssets().find((asset) => asset.generationOperationId === videoCreated.operation.generationOperationId);
  assert.ok(videoAsset && videoAsset.assetType === "video" && videoAsset.mimeType === "video/mp4" && (videoAsset.durationSeconds ?? 0) > 0 && existsSync(videoAsset.localPath!));
  assert.equal(operations.createVideoOperation(brief, new RuntimeRepository(new FileRuntimeStore(root))).status, "existing");

  const reloaded = new RuntimeRepository(new FileRuntimeStore(root));
  assert.equal(reloaded.listGenerationOperations().filter((operation) => operation.productionBriefId === brief.productionBriefId && operation.status === "completed").length, 6);
  assert.equal(reloaded.listAssets().filter((asset) => asset.productionBriefId === brief.productionBriefId).length, 6);
  assert.equal(reloaded.listVisualSceneAssetMappings(brief.productionBriefId).length, 2);
  assert.ok(reloaded.getNarrationAlignmentByOperation(alignmentCreated.operation.generationOperationId));
  assert.equal(reloaded.getAsset(videoAsset!.assetId)?.proposalId, proposal.id);
  assert.equal(JSON.stringify(reloaded.getSnapshot().memory.find((entry) => entry.id === proposal.id)), proposalBefore);
  assert.equal(JSON.stringify(reloaded.getProductionBrief(brief.productionBriefId)), briefBefore);
  assert.equal(JSON.stringify(reloaded.getContentReviewDecision(decision.decisionId)), decisionBefore);
  assert.equal(JSON.stringify(reloaded.getPublishingQueueEntry(queue.queueEntryId)), queueBefore);
}

// A terminal narration failure stops all dependent stages and cannot manufacture downstream assets.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-content-pipeline-stop-"));
  const { repository, briefId } = createRepository(root);
  const brief = repository.getProductionBrief(briefId)!;
  const operations = new GenerationOperationService();
  const narration = operations.createNarrationOperation(brief, repository); assert.equal(narration.status, "created");
  assert.equal(operations.claim(narration.operation.generationOperationId, repository).status, "updated");
  assert.equal(operations.fail(narration.operation.generationOperationId, "test failure", repository).status, "updated");
  const alignment = operations.createAlignmentOperation(brief, repository); assert.equal(alignment.status, "created");
  const alignmentResult = await new NarrationAlignmentService(new ElevenLabsForcedAlignmentAdapter({ env: { ELEVENLABS_API_KEY: "test" }, requester: async () => { throw new Error("must not be called"); } })).execute(alignment.operation.generationOperationId, repository);
  assert.equal(alignmentResult.status, "failed");
  const subtitle = operations.createSubtitleOperation(brief, repository); assert.equal(subtitle.status, "created");
  assert.equal(new SubtitleGenerationService(new LocalSubtitleAssetWriter(path.join(root, "assets"))).execute(subtitle.operation.generationOperationId, repository).status, "failed");
  const video = operations.createVideoOperation(brief, repository); assert.equal(video.status, "created");
  assert.equal((await new FFmpegVideoRenderService({ config: { assetRoot: path.join(root, "assets") } }).execute(video.operation.generationOperationId, repository)).status, "failed");
  assert.deepEqual(repository.listAssets(), []);
}

console.log("Content production pipeline integration tests passed.");