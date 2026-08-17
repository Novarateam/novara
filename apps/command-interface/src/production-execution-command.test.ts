import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { ElevenLabsForcedAlignmentAdapter } from "../../../core/agent-runtime/src/elevenlabs-forced-alignment-adapter.ts";
import { ElevenLabsNarrationAdapter } from "../../../core/agent-runtime/src/elevenlabs-narration-adapter.ts";
import { ElevenLabsNarrationService, LocalNarrationAssetWriter } from "../../../core/agent-runtime/src/elevenlabs-narration-service.ts";
import { FFmpegVideoRenderService } from "../../../core/agent-runtime/src/ffmpeg-video-render-service.ts";
import { GenerationOperationService } from "../../../core/agent-runtime/src/generation-operation-service.ts";
import { NarrationAlignmentService } from "../../../core/agent-runtime/src/narration-alignment-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { normalizeAndPersistProductionBrief } from "../../../core/agent-runtime/src/production-brief-service.ts";
import { LocalSubtitleAssetWriter, SubtitleGenerationService } from "../../../core/agent-runtime/src/subtitle-generation-service.ts";
import { LocalVisualAssetWriter, VisualProductionService, type VisualGenerationAdapter } from "../../../core/agent-runtime/src/visual-production-service.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, PublishingQueueEntry } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService } from "./production-execution-access-service.ts";
import { handleProductionExecutionCommand, type ProductionExecutionDependencies } from "./production-execution-command.ts";

const narrationText = "Show the proof. Keep the promise.";
const proposal: CompanyMemoryEntry = {
  id: "proposal-production-command-A-014", type: "evidence", source: "A-014/production-command-test", timestamp: "2026-08-13T00:00:00.000Z", confidence: 0.9, authority: "recommend", status: "proposed",
  content: { objective: "Create an approved local video.", structuredResult: { summary: "Ready", platform: "instagram", hook: "Proof", title: "Proof", caption: "Caption", hashtags: ["novara"], angle: "education", confidence: 0.9, reasons: ["test"], humanReviewRequired: true, productionPlan: { productionPlanVersion: "1", targetPlatform: "instagram", contentScript: "Show proof.", narrationScript: narrationText, visualPlan: [{ sequence: 1, description: "Blue proof card", durationSeconds: 2 }], requiredMediaType: "short-form-video", aspectRatio: "9:16", targetDurationSeconds: 2, captionRequirements: { burnedIn: true, language: "en" } } } },
};
const decision: ContentReviewDecisionRecord = { decisionId: "decision-production-command", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: "2026-08-13T00:01:00.000Z" };
const queue: PublishingQueueEntry = { queueEntryId: "queue-production-command", proposalId: proposal.id, agentId: "A-014", status: "queued", createdAt: "2026-08-13T00:02:00.000Z", updatedAt: "2026-08-13T00:02:00.000Z" };
const access = new LocalProductionExecutionAccessService([{ identity: "human-producer", credential: "produce-key", operations: ["produceApprovedContent"] }]);

function fixture(root: string): { image: Uint8Array; audio: Uint8Array } {
  assert.equal(spawnSync("ffmpeg", ["-version"], { windowsHide: true, stdio: "ignore" }).status, 0);
  assert.equal(spawnSync("ffprobe", ["-version"], { windowsHide: true, stdio: "ignore" }).status, 0);
  const imagePath = path.join(root, "fixture.png"); const audioPath = path.join(root, "fixture.mp3");
  assert.equal(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1", "-y", imagePath], { windowsHide: true }).status, 0);
  assert.equal(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libmp3lame", "-y", audioPath], { windowsHide: true }).status, 0);
  return { image: new Uint8Array(readFileSync(imagePath)), audio: new Uint8Array(readFileSync(audioPath)) };
}

function repository(root: string): RuntimeRepository {
  const result = new RuntimeRepository(new FileRuntimeStore(root));
  result.upsertMemory(proposal); result.createContentReviewDecision(decision); result.createPublishingQueueEntry(queue);
  assert.equal(normalizeAndPersistProductionBrief(proposal, result, "2026-08-13T00:03:00.000Z")?.status, "created");
  const brief = result.getProductionBriefByProposal(proposal.id)!;
  assert.ok(result.createProductionApproval({ approvalId: `approval-${brief.productionBriefId}`, proposalId: proposal.id, productionBriefId: brief.productionBriefId, reviewerId: "human-producer", decision: "approved-for-production", recordedAt: "2026-08-13T00:03:00.000Z" }));
  return result;
}

function dependencies(root: string, assets: { image: Uint8Array; audio: Uint8Array }, options: { visualConfigured?: boolean; narrationMode?: "success" | "unknown" | "missing-config" } = {}, calls = { narration: 0 }): ProductionExecutionDependencies {
  const assetRoot = path.join(root, "assets");
  const visual: VisualGenerationAdapter = { isConfigured: () => options.visualConfigured ?? true, generate: async () => ({ status: "succeeded", assets: [{ assetType: "image", bytes: assets.image, mimeType: "image/png" }] }) };
  const narration = new ElevenLabsNarrationAdapter({
    env: options.narrationMode === "missing-config" ? {} : { ELEVENLABS_API_KEY: "test", ELEVENLABS_VOICE_ID: "voice" },
    requester: async () => {
      calls.narration += 1;
      return options.narrationMode === "unknown"
        ? { kind: "transport-error", code: "timeout", reason: "test timeout" }
        : { kind: "response", status: 200, headers: { "content-type": "audio/mpeg" }, bytes: assets.audio };
    },
  });
  const alignment = new ElevenLabsForcedAlignmentAdapter({ env: { ELEVENLABS_API_KEY: "test" }, requester: async () => ({ kind: "response", status: 200, bytes: new TextEncoder().encode(JSON.stringify({ characters: [{ text: "S", start: 0, end: 0.1 }], words: [{ text: "Show", start: 0, end: 0.4, loss: 0.01 }, { text: "the", start: 0.41, end: 0.6, loss: 0.01 }, { text: "proof.", start: 0.61, end: 0.9, loss: 0.01 }, { text: "Keep", start: 1.1, end: 1.4, loss: 0.01 }, { text: "the", start: 1.41, end: 1.6, loss: 0.01 }, { text: "promise.", start: 1.61, end: 1.9, loss: 0.01 }], loss: 0.01 })) }) });
  return { operations: new GenerationOperationService(), visuals: new VisualProductionService(visual, new LocalVisualAssetWriter(assetRoot)), narration: new ElevenLabsNarrationService(narration, new LocalNarrationAssetWriter(assetRoot)), alignment: new NarrationAlignmentService(alignment), subtitles: new SubtitleGenerationService(new LocalSubtitleAssetWriter(assetRoot)), renderer: new FFmpegVideoRenderService({ config: { assetRoot } }) };
}

async function run(root: string, repo: RuntimeRepository, deps: ProductionExecutionDependencies) {
  return handleProductionExecutionCommand({ operation: "produceApprovedContent", proposalId: proposal.id }, "produce-key", repo, access, deps);
}

// Explicit authorized execution reaches a real local FFmpeg render and durable video record.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-command-success-")); const repo = repository(root); const deps = dependencies(root, fixture(root));
  const initial = await run(root, repo, deps);
  assert.equal(initial.status, "ok"); assert.equal(initial.result.status, "completed");
  if (initial.status === "ok" && initial.result.status === "completed") assert.ok(initial.result.localPath.endsWith(".mp4"));
  const counts = { operations: repo.listGenerationOperations().length, assets: repo.listAssets().length, mappings: repo.listVisualSceneAssetMappings().length };
  const repeated = await run(root, new RuntimeRepository(new FileRuntimeStore(root)), deps);
  assert.equal(repeated.status, "ok"); assert.equal(repeated.result.status, "completed");
  const reloaded = new RuntimeRepository(new FileRuntimeStore(root));
  assert.deepEqual({ operations: reloaded.listGenerationOperations().length, assets: reloaded.listAssets().length, mappings: reloaded.listVisualSceneAssetMappings().length }, counts);
  assert.equal(reloaded.listGenerationOperations().filter((operation) => operation.status === "completed").length, 5);
}

// A provider failure before claim stops at visuals and does not create downstream work.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-command-visual-failure-")); const repo = repository(root);
  const response = await run(root, repo, dependencies(root, fixture(root), { visualConfigured: false }));
  assert.equal(response.status, "ok"); if (response.status === "ok") { assert.equal(response.result.status, "blocked"); if (response.result.status === "blocked") assert.equal(response.result.blockedAt, "visual"); }
  assert.equal(repo.getGenerationOperationByBrief(repo.getProductionBriefByProposal(proposal.id)!.productionBriefId, "narration"), undefined);
}

// Unknown narration is terminal, not retried by a later explicit command, and creates no alignment/subtitles/video.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-command-unknown-")); const repo = repository(root); const calls = { narration: 0 }; const deps = dependencies(root, fixture(root), { narrationMode: "unknown" }, calls);
  const first = await run(root, repo, deps); const second = await run(root, repo, deps);
  for (const response of [first, second]) { assert.equal(response.status, "ok"); if (response.status === "ok") { assert.equal(response.result.status, "blocked"); if (response.result.status === "blocked") assert.equal(response.result.blockedAt, "narration"); } }
  assert.equal(calls.narration, 1); assert.equal(repo.getGenerationOperationByBrief(repo.getProductionBriefByProposal(proposal.id)!.productionBriefId, "narration")?.status, "unknown-result");
  assert.equal(repo.getGenerationOperationByBrief(repo.getProductionBriefByProposal(proposal.id)!.productionBriefId, "alignment"), undefined);
}

// Missing narration configuration preserves the queued operation and never fabricates downstream assets.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-command-no-config-")); const repo = repository(root);
  const response = await run(root, repo, dependencies(root, fixture(root), { narrationMode: "missing-config" }));
  assert.equal(response.status, "ok"); if (response.status === "ok") { assert.equal(response.result.status, "blocked"); if (response.result.status === "blocked") { assert.equal(response.result.blockedAt, "narration"); assert.equal(response.result.operationStatus, "queued"); } }
  assert.equal(repo.listAssets().filter((asset) => asset.assetType === "audio" || asset.assetType === "subtitle" || asset.assetType === "video").length, 0);
}

// Existing completed stages are reused; a later queued video operation resumes only on a new explicit command.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-command-resume-")); const repo = repository(root); const fixtureAssets = fixture(root); const deferred = dependencies(root, fixtureAssets);
  const renderer = deferred.renderer;
  deferred.renderer = new class extends FFmpegVideoRenderService { async execute() { return { status: "failed" as const, reason: "deliberately deferred" }; } }();
  const first = await run(root, repo, deferred); assert.equal(first.status, "ok"); if (first.status === "ok") { assert.equal(first.result.status, "blocked"); if (first.result.status === "blocked") { assert.equal(first.result.blockedAt, "video"); assert.equal(first.result.operationStatus, "queued"); } }
  deferred.renderer = renderer;
  const resumed = await run(root, repo, deferred); assert.equal(resumed.status, "ok"); if (resumed.status === "ok") assert.equal(resumed.result.status, "completed");
}

// Two explicit callers share the existing per-operation claims and leave one final video result.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-production-command-concurrent-")); repository(root); const assets = fixture(root);
  const first = new RuntimeRepository(new FileRuntimeStore(root)); const second = new RuntimeRepository(new FileRuntimeStore(root));
  const [one, two] = await Promise.all([run(root, first, dependencies(root, assets)), run(root, second, dependencies(root, assets))]);
  assert.equal([one, two].filter((response) => response.status === "ok" && response.result.status === "completed").length, 1);
  assert.equal(new RuntimeRepository(new FileRuntimeStore(root)).listAssets().filter((asset) => asset.assetType === "video").length, 1);
}

assert.equal((await handleProductionExecutionCommand({ operation: "produceApprovedContent", proposalId: proposal.id }, undefined, repository(mkdtempSync(path.join(tmpdir(), "novara-production-command-access-"))), access)).status, "invalid-request");
console.log("Production execution command tests passed.");