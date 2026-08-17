import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenerationOperationService } from "./generation-operation-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { deriveSubtitleCues, LocalSubtitleAssetWriter, renderSrt, renderVtt, SubtitleGenerationService, type SubtitleAssetWriter } from "./subtitle-generation-service.ts";
import type { AssetMetadata, CompanyMemoryEntry, ContentReviewDecisionRecord, NarrationAlignment, ProductionBrief, PublishingQueueEntry } from "./types.ts";

const brief: ProductionBrief = { productionBriefId: "brief-subtitle", proposalId: "proposal-subtitle", agentId: "A-014", productionPlanVersion: "1", targetPlatform: "instagram", contentScript: "Hello world. Next sentence.", narrationScript: "Hello world. Next sentence.", visualPlan: [{ sequence: 1, description: "scene", durationSeconds: 4 }], requiredMediaType: "short-form-video", aspectRatio: "9:16", targetDurationSeconds: 4, captionRequirements: { burnedIn: true, language: "en" }, productionReadiness: "ready", missingRequirements: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const proposal: CompanyMemoryEntry = { id: brief.proposalId, type: "evidence", source: "test", timestamp: brief.createdAt, confidence: 0.8, authority: "recommend", status: "proposed", content: {} };
const decision: ContentReviewDecisionRecord = { decisionId: "decision-subtitle", proposalId: brief.proposalId, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: brief.createdAt };
const queue: PublishingQueueEntry = { queueEntryId: "queue-subtitle", proposalId: brief.proposalId, agentId: "A-014", status: "queued", createdAt: brief.createdAt, updatedAt: brief.createdAt };
const words = [{ text: "Hello", start: 0, end: 0.4, loss: 0.01 }, { text: "world.", start: 0.5, end: 0.9, loss: 0.01 }, { text: "Next", start: 1.2, end: 1.5, loss: 0.01 }, { text: "sentence.", start: 1.6, end: 2.1, loss: 0.01 }];

function setup(root = mkdtempSync(path.join(tmpdir(), "novara-subtitle-"))) {
  const repository = new RuntimeRepository(new FileRuntimeStore(root));
  repository.upsertMemory(proposal); repository.createContentReviewDecision(decision); repository.createPublishingQueueEntry(queue); repository.upsertProductionBrief(brief);
  const operations = new GenerationOperationService();
  const narration = operations.createNarrationOperation(brief, repository, "2026-01-01T00:01:00.000Z"); assert.equal(narration.status, "created");
  const audioPath = path.join(root, "narration.mp3"); writeFileSync(audioPath, "audio");
  assert.equal(operations.claim(narration.operation.generationOperationId, repository).status, "updated");
  const audio: AssetMetadata = { assetId: "asset-subtitle-audio", generationOperationId: narration.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, assetType: "audio", status: "available", localPath: audioPath, reference: audioPath, mimeType: "audio/mpeg", createdAt: brief.createdAt, updatedAt: brief.createdAt };
  assert.equal(operations.complete(narration.operation.generationOperationId, [audio], repository).status, "updated");
  const alignmentOperation = operations.createAlignmentOperation(brief, repository); assert.equal(alignmentOperation.status, "created");
  assert.equal(operations.claim(alignmentOperation.operation.generationOperationId, repository).status, "updated");
  const alignment: NarrationAlignment = { alignmentId: "alignment-subtitle", generationOperationId: alignmentOperation.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, narrationAssetId: audio.assetId, narrationText: brief.narrationScript!, source: "elevenlabs-forced-alignment", characters: [], words: structuredClone(words), loss: 0.01, createdAt: brief.createdAt, updatedAt: brief.createdAt };
  assert.equal(operations.complete(alignmentOperation.operation.generationOperationId, [], repository, undefined, [], alignment).status, "updated");
  const subtitle = operations.createSubtitleOperation(brief, repository); assert.equal(subtitle.status, "created");
  return { root, repository, operations, subtitle: subtitle.operation, alignment };
}

// Exact formatting and every boundary comes from an aligned word boundary.
{
  const cues = deriveSubtitleCues({ narrationText: brief.narrationScript!, words } as NarrationAlignment)!;
  assert.deepEqual(cues, [{ text: "Hello world.", start: 0, end: 0.9 }, { text: "Next sentence.", start: 1.2, end: 2.1 }]);
  assert.equal(renderSrt(cues), "1\n00:00:00,000 --> 00:00:00,900\nHello world.\n\n2\n00:00:01,200 --> 00:00:02,100\nNext sentence.\n");
  assert.equal(renderVtt(cues), "WEBVTT\n\n00:00:00.000 --> 00:00:00.900\nHello world.\n\n00:00:01.200 --> 00:00:02.100\nNext sentence.\n");
  assert.equal(deriveSubtitleCues({ narrationText: "x", words: [{ ...words[0] }, { ...words[1], start: 0.3 }] } as NarrationAlignment), null);
}

// Valid local generation writes both UTF-8 formats, atomically completes metadata, and survives reload without mutating sources.
{
  const setupResult = setup();
  const beforeBrief = JSON.stringify(setupResult.repository.getProductionBrief(brief.productionBriefId));
  const beforeAlignment = JSON.stringify(setupResult.repository.getNarrationAlignmentByOperation("generation-brief-subtitle-alignment"));
  const result = new SubtitleGenerationService(new LocalSubtitleAssetWriter(path.join(setupResult.root, "assets"))).execute(setupResult.subtitle.generationOperationId, setupResult.repository);
  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(readFileSync(result.assets[0].localPath!, "utf8"), renderSrt(deriveSubtitleCues(setupResult.alignment)!));
    assert.equal(readFileSync(result.assets[1].localPath!, "utf8"), renderVtt(deriveSubtitleCues(setupResult.alignment)!));
    assert.deepEqual(result.operation.resultAssetIds, ["asset-generation-brief-subtitle-subtitle-srt", "asset-generation-brief-subtitle-subtitle-vtt"]);
  }
  const reloaded = new RuntimeRepository(new FileRuntimeStore(setupResult.root));
  assert.equal(reloaded.listAssets().filter((asset) => asset.assetType === "subtitle").length, 2);
  assert.equal(JSON.stringify(reloaded.getProductionBrief(brief.productionBriefId)), beforeBrief);
  assert.equal(JSON.stringify(reloaded.getNarrationAlignmentByOperation("generation-brief-subtitle-alignment")), beforeAlignment);
}

// Wrong type/state, missing alignment/audio, mismatched ownership, and malformed timings are all rejected without a claim or retry.
{
  const setupResult = setup();
  assert.equal(new SubtitleGenerationService().execute("generation-brief-subtitle-narration", setupResult.repository).status, "failed");
  assert.equal(setupResult.operations.claim(setupResult.subtitle.generationOperationId, setupResult.repository).status, "updated");
  assert.equal(new SubtitleGenerationService().execute(setupResult.subtitle.generationOperationId, setupResult.repository).status, "failed");
}
{
  const setupResult = setup();
  const snapshot = setupResult.repository.getSnapshot();
  snapshot.narrationAlignments = [];
  const broken = new RuntimeRepository({ loadSnapshot: () => structuredClone(snapshot), saveSnapshot: () => structuredClone(snapshot) });
  assert.equal(new SubtitleGenerationService().execute(setupResult.subtitle.generationOperationId, broken).status, "failed");
}
{
  const setupResult = setup();
  const snapshot = setupResult.repository.getSnapshot();
  snapshot.assets = [];
  const broken = new RuntimeRepository({ loadSnapshot: () => structuredClone(snapshot), saveSnapshot: () => structuredClone(snapshot) });
  assert.equal(new SubtitleGenerationService().execute(setupResult.subtitle.generationOperationId, broken).status, "failed");
}
{
  const setupResult = setup();
  const snapshot = setupResult.repository.getSnapshot();
  snapshot.narrationAlignments[0].words[1].start = 0.3;
  const broken = new RuntimeRepository({ loadSnapshot: () => structuredClone(snapshot), saveSnapshot: () => structuredClone(snapshot) });
  assert.equal(new SubtitleGenerationService().execute(setupResult.subtitle.generationOperationId, broken).status, "failed");
}
{
  const setupResult = setup();
  const alignment = setupResult.repository.getNarrationAlignmentByOperation("generation-brief-subtitle-alignment")!;
  alignment.proposalId = "wrong";
  const snapshot = setupResult.repository.getSnapshot(); snapshot.narrationAlignments = [alignment];
  const broken = new RuntimeRepository({ loadSnapshot: () => structuredClone(snapshot), saveSnapshot: () => structuredClone(snapshot) });
  assert.equal(new SubtitleGenerationService().execute(setupResult.subtitle.generationOperationId, broken).status, "failed");
}

// One writer failure after the durable claim yields unknown-result and creates no subtitle metadata; repeated/concurrent execution cannot claim twice.
{
  const setupResult = setup();
  const failingWriter: SubtitleAssetWriter = { write: () => { throw new Error("vtt write failed"); } };
  const result = new SubtitleGenerationService(failingWriter).execute(setupResult.subtitle.generationOperationId, setupResult.repository);
  assert.equal(result.status, "unknown-result");
  assert.equal(setupResult.repository.getGenerationOperation(setupResult.subtitle.generationOperationId)?.status, "unknown-result");
  assert.equal(setupResult.repository.listAssets().filter((asset) => asset.assetType === "subtitle").length, 0);
  assert.equal(new SubtitleGenerationService(failingWriter).execute(setupResult.subtitle.generationOperationId, setupResult.repository).status, "failed");
}
{
  const setupResult = setup();
  const first = new RuntimeRepository(new FileRuntimeStore(setupResult.root));
  const second = new RuntimeRepository(new FileRuntimeStore(setupResult.root));
  const writer: SubtitleAssetWriter = { write: () => ({ srtPath: path.join(setupResult.root, "a.srt"), vttPath: path.join(setupResult.root, "a.vtt") }) };
  assert.equal(new SubtitleGenerationService(writer).execute(setupResult.subtitle.generationOperationId, first).status, "completed");
  assert.equal(new SubtitleGenerationService(writer).execute(setupResult.subtitle.generationOperationId, second).status, "failed");
}

const source = readFileSync(new URL("./subtitle-generation-service.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /fetch\(|https?:\/\/|ElevenLabs|FFmpeg|Metricool/i);
console.log("Subtitle generation service tests passed.");