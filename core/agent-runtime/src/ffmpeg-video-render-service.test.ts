import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { GenerationOperationService } from "./generation-operation-service.ts";
import { FFmpegVideoRenderService, buildFFmpegArguments, type FFmpegProcessExecutor } from "./ffmpeg-video-render-service.ts";
import type { AssetMetadata, CompanyMemoryEntry, ContentReviewDecisionRecord, GenerationOperation, NarrationAlignment, ProductionBrief, PublishingQueueEntry } from "./types.ts";

const brief: ProductionBrief = {
  productionBriefId: "production-brief-render-1", proposalId: "mem-render-A-014", agentId: "A-014", productionPlanVersion: "1", targetPlatform: "instagram", contentScript: "Render the idea.", narrationScript: "Narrate the idea.", visualPlan: [{ sequence: 1, description: "Opening", durationSeconds: 5 }, { sequence: 2, description: "Support", durationSeconds: 5 }], requiredMediaType: "short-form-video", aspectRatio: "9:16", targetDurationSeconds: 10, captionRequirements: { burnedIn: true }, productionReadiness: "ready", missingRequirements: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const proposal: CompanyMemoryEntry = { id: brief.proposalId, type: "evidence", source: "A-014/render-test", timestamp: "2026-01-01T00:00:00.000Z", confidence: 0.8, authority: "recommend", status: "proposed", content: { objective: "Render", structuredResult: { platform: "instagram", caption: "Original" } } };
const decision: ContentReviewDecisionRecord = { decisionId: "decision-render", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: "2026-01-01T00:01:00.000Z" };
const queue: PublishingQueueEntry = { queueEntryId: "queue-render", proposalId: proposal.id, agentId: "A-014", status: "queued", createdAt: "2026-01-01T00:02:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z" };

function setup(root: string): { repository: RuntimeRepository; operation: GenerationOperation; audio: AssetMetadata; images: AssetMetadata[]; subtitles: AssetMetadata[]; alignment: NarrationAlignment } {
  const repository = new RuntimeRepository(new FileRuntimeStore(root));
  repository.upsertMemory(proposal); repository.createContentReviewDecision(decision); repository.createPublishingQueueEntry(queue); repository.upsertProductionBrief(brief);
  const operations = new GenerationOperationService();
  const narration = operations.createNarrationOperation(brief, repository, "2026-01-01T00:03:00.000Z");
  assert.equal(narration.status, "created");
  const narrationOperation = narration.operation;
  operations.claim(narrationOperation.generationOperationId, repository);
  const audioPath = path.join(root, "audio.mp3"); writeFileSync(audioPath, new Uint8Array([1, 2, 3]));
  const audio: AssetMetadata = { assetId: "asset-audio", generationOperationId: narrationOperation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, assetType: "audio", status: "available", localPath: audioPath, reference: audioPath, mimeType: "audio/mpeg", createdAt: "2026-01-01T00:04:00.000Z", updatedAt: "2026-01-01T00:04:00.000Z" };
  assert.equal(operations.complete(narrationOperation.generationOperationId, [audio], repository).status, "updated");
  const alignmentOperation = operations.createAlignmentOperation(brief, repository);
  assert.equal(alignmentOperation.status, "created");
  assert.equal(operations.claim(alignmentOperation.operation.generationOperationId, repository).status, "updated");
  const alignment: NarrationAlignment = { alignmentId: "alignment-render", generationOperationId: alignmentOperation.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, narrationAssetId: audio.assetId, narrationText: brief.narrationScript!, source: "elevenlabs-forced-alignment", characters: [{ text: "N", start: 0, end: 0.1 }], words: [{ text: "Narrate", start: 0, end: 0.5, loss: 0.01 }], loss: 0.01, createdAt: "2026-01-01T00:04:00.000Z", updatedAt: "2026-01-01T00:04:00.000Z" };
  assert.equal(operations.complete(alignmentOperation.operation.generationOperationId, [], repository, undefined, [], alignment).status, "updated");
  const images: AssetMetadata[] = [];
  for (const scene of brief.visualPlan) {
    const visual = operations.createVisualOperation(brief, repository, scene.sequence);
    assert.equal(visual.status, "created");
    operations.claim(visual.operation.generationOperationId, repository);
    const imagePath = path.join(root, `scene-${scene.sequence}.png`); writeFileSync(imagePath, new Uint8Array([scene.sequence, 1, 2]));
    const image: AssetMetadata = { assetId: `asset-image-${scene.sequence}`, generationOperationId: visual.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, assetType: "image", status: "available", localPath: imagePath, reference: imagePath, mimeType: "image/png", createdAt: "2026-01-01T00:04:00.000Z", updatedAt: "2026-01-01T00:04:00.000Z" };
    assert.equal(operations.complete(visual.operation.generationOperationId, [image], repository, undefined, [{ mappingId: `mapping-${scene.sequence}`, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, generationOperationId: visual.operation.generationOperationId, sceneSequence: scene.sequence, assetId: image.assetId, createdAt: image.createdAt, updatedAt: image.updatedAt }]).status, "updated");
    images.push(image);
  }
  const subtitle = operations.createSubtitleOperation(brief, repository);
  assert.equal(subtitle.status, "created");
  assert.equal(operations.claim(subtitle.operation.generationOperationId, repository).status, "updated");
  const srtPath = path.join(root, "subtitles.srt"); const vttPath = path.join(root, "subtitles.vtt");
  writeFileSync(srtPath, "1\n00:00:00,000 --> 00:00:01,000\nRender subtitles.\n", "utf8"); writeFileSync(vttPath, "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nRender subtitles.\n", "utf8");
  const subtitles: AssetMetadata[] = [
    { assetId: "asset-subtitle-srt", generationOperationId: subtitle.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, assetType: "subtitle", status: "available", localPath: srtPath, reference: srtPath, mimeType: "application/x-subrip", createdAt: "2026-01-01T00:04:00.000Z", updatedAt: "2026-01-01T00:04:00.000Z" },
    { assetId: "asset-subtitle-vtt", generationOperationId: subtitle.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: brief.proposalId, assetType: "subtitle", status: "available", localPath: vttPath, reference: vttPath, mimeType: "text/vtt", createdAt: "2026-01-01T00:04:00.000Z", updatedAt: "2026-01-01T00:04:00.000Z" },
  ];
  assert.equal(operations.complete(subtitle.operation.generationOperationId, subtitles, repository).status, "updated");
  const render = operations.createVideoOperation(brief, repository);
  assert.equal(render.status, "created");
  return { repository, operation: render.operation, audio, images, subtitles, alignment };
}

function executor(root: string, mode: "success" | "ffmpeg-fail" | "unknown" | "no-output" = "success", calls = { count: 0 }): FFmpegProcessExecutor {
  return {
    isAvailable: () => true,
    run: async (_exe, args) => { calls.count += 1; if (mode === "unknown") return { status: "unknown", reason: "interrupted" }; if (mode === "ffmpeg-fail") return { status: "exited", code: 1, stderr: "failed", stdout: "" }; if (mode === "success") { mkdirSync(path.dirname(args.at(-1)!), { recursive: true }); writeFileSync(args.at(-1)!, new Uint8Array([9, 8, 7])); } return { status: "exited", code: 0, stderr: "", stdout: "" }; },
    probe: async (_exe, filePath) => filePath.endsWith("audio.mp3") ? { status: "ok", durationSeconds: 10, hasAudio: true, hasVideo: false } : mode === "no-output" ? { status: "failed", reason: "no output" } : { status: "ok", durationSeconds: 10, hasAudio: true, hasVideo: true },
  };
}

function replaceSnapshot(root: string, change: (snapshot: ReturnType<RuntimeRepository["getSnapshot"]>) => void): RuntimeRepository {
  const store = new FileRuntimeStore(root);
  const snapshot = store.loadSnapshot();
  change(snapshot);
  store.saveSnapshot(snapshot);
  return new RuntimeRepository(new FileRuntimeStore(root));
}

// Each still becomes its own looped input carrying a zoompan move, the moves
// concat in scene order, and subtitles burn onto the concatenated result.
{
  const args = buildFFmpegArguments(
    [{ imagePath: "a.png", durationSeconds: 4 }, { imagePath: "b.png", durationSeconds: 6 }],
    "audio.mp3",
    "C:\\assets\\subtitles.srt",
    "out.mp4",
    "1080:1920",
    10,
  );
  const filterComplex = args[args.indexOf("-filter_complex") + 1];

  // Each still enters as a single frame; zoompan's `d` expands it. Looping the
  // input instead would multiply every scene and truncate the video in scene 1.
  assert.deepEqual(args.slice(0, 6), ["-hide_banner", "-y", "-i", "a.png", "-i", "b.png"]);
  assert.deepEqual(args.slice(6, 8), ["-i", "audio.mp3"]);
  // Narration is the input after the stills, and the burned video is mapped out.
  assert.deepEqual([args[args.indexOf("-map") + 1], args[args.lastIndexOf("-map") + 1]], ["[vout]", "2:a"]);
  // 4s and 6s at 30fps become explicit zoompan frame counts.
  assert.ok(filterComplex.includes("d=120") && filterComplex.includes("d=180"));
  // Alternating push then pull.
  assert.ok(filterComplex.includes("z='min(1+0.0009*on,1.15)'") && filterComplex.includes("z='max(1.15-0.0009*on,1)'"));
  // Stills are supersampled to 1620x2880 before the zoom, then output at 1080x1920.
  assert.ok(filterComplex.includes("scale=1620:2880:force_original_aspect_ratio=increase") && filterComplex.includes("s=1080x1920"));
  assert.ok(filterComplex.includes("[v0][v1]concat=n=2:v=1:a=0[vcat]"));
  // Captions burn onto the concatenated video with explicit styling, not the
  // thin bottom-anchored default an untouched SRT would render.
  assert.ok(filterComplex.includes("format=yuv420p,subtitles=filename='C\\:/assets/subtitles.srt':force_style='"));
  assert.ok(filterComplex.includes("Bold=1") && filterComplex.includes("Outline=2") && filterComplex.includes("MarginV=60"));
  assert.ok(filterComplex.endsWith("[vout]"));
  assert.ok(filterComplex.includes("[vcat]eq=contrast=") && filterComplex.includes("vignette="));
  assert.deepEqual(args.slice(-15), ["-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", "10", "-movflags", "+faststart", "out.mp4"]);
}

// Missing tools fail before claim and never create output.
for (const missing of ["ffmpeg", "ffprobe"] as const) {
  const root = mkdtempSync(path.join(tmpdir(), `novara-render-missing-${missing}-`)); const { repository, operation } = setup(root); const ex = executor(root); ex.isAvailable = (exe) => !exe.includes(missing); const result = await new FFmpegVideoRenderService({ executor: ex, config: { ffmpegPath: "ffmpeg", ffprobePath: "ffprobe", assetRoot: root } }).execute(operation.generationOperationId, repository); assert.equal(result.status, "failed"); assert.equal(repository.getGenerationOperation(operation.generationOperationId)?.status, "queued");
}

// Every locally persisted dependency must remain present and readable before the render claim.
for (const missing of ["audio", "subtitle", "scene"] as const) {
  const root = mkdtempSync(path.join(tmpdir(), `novara-render-missing-${missing}-`));
  const { repository, operation, audio, images, subtitles } = setup(root);
  unlinkSync(missing === "audio" ? audio.localPath! : missing === "subtitle" ? subtitles[0].localPath! : images[0].localPath!);
  const result = await new FFmpegVideoRenderService({ executor: executor(root), config: { assetRoot: root } }).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "failed");
  assert.equal(repository.getGenerationOperation(operation.generationOperationId)?.status, "queued");
}

// Invalid mappings and incomplete scene timing reject before FFmpeg can start.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-render-invalid-mapping-")); const { operation } = setup(root);
  const repository = replaceSnapshot(root, (snapshot) => { snapshot.visualSceneAssetMappings[0].proposalId = "wrong-proposal"; });
  const result = await new FFmpegVideoRenderService({ executor: executor(root), config: { assetRoot: root } }).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "failed");
}
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-render-bad-duration-")); const { operation } = setup(root);
  const repository = replaceSnapshot(root, (snapshot) => { snapshot.productionBriefs[0].visualPlan[1].durationSeconds = undefined; });
  const result = await new FFmpegVideoRenderService({ executor: executor(root), config: { assetRoot: root } }).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "failed");
}
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-render-duration-mismatch-")); const { repository, operation } = setup(root);
  const ex = executor(root); ex.probe = async (_exe, filePath) => filePath.endsWith("audio.mp3") ? { status: "ok", durationSeconds: 12, hasAudio: true, hasVideo: false } : { status: "ok", durationSeconds: 10, hasAudio: true, hasVideo: true };
  const result = await new FFmpegVideoRenderService({ executor: ex, config: { assetRoot: root } }).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "failed");
}

// Successful mocked render requires output verification and persists one linked video asset.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-render-success-")); const { repository, operation } = setup(root);
  const originalProposal = JSON.stringify(repository.getSnapshot().memory.find((entry) => entry.id === brief.proposalId));
  const originalBrief = JSON.stringify(repository.getProductionBrief(brief.productionBriefId));
  const originalAlignment = JSON.stringify(repository.getNarrationAlignmentByOperation("generation-production-brief-render-1-alignment"));
  const originalSubtitles = JSON.stringify(repository.listAssets().filter((asset) => asset.assetType === "subtitle"));
  const result = await new FFmpegVideoRenderService({ executor: executor(root), config: { assetRoot: root } }).execute(operation.generationOperationId, repository); assert.equal(result.status, "completed"); if (result.status === "completed") { assert.equal(result.asset.assetType, "video"); assert.equal(result.asset.mimeType, "video/mp4"); assert.ok(readFileSync(result.asset.localPath!).length > 0); } assert.equal(repository.listAssets().filter((asset) => asset.assetType === "video").length, 1);
  const reloaded = new RuntimeRepository(new FileRuntimeStore(root));
  assert.equal(JSON.stringify(reloaded.getSnapshot().memory.find((entry) => entry.id === brief.proposalId)), originalProposal);
  assert.equal(JSON.stringify(reloaded.getProductionBrief(brief.productionBriefId)), originalBrief);
  assert.equal(JSON.stringify(reloaded.getNarrationAlignmentByOperation("generation-production-brief-render-1-alignment")), originalAlignment);
  assert.equal(JSON.stringify(reloaded.listAssets().filter((asset) => asset.assetType === "subtitle")), originalSubtitles);
}

// Definitive, ambiguous, and unverifiable outputs are terminal and asset-free.
for (const [mode, expected] of [["ffmpeg-fail", "failed"], ["unknown", "unknown-result"], ["no-output", "failed"]] as const) { const root = mkdtempSync(path.join(tmpdir(), `novara-render-${mode}-`)); const { repository, operation } = setup(root); const result = await new FFmpegVideoRenderService({ executor: executor(root, mode), config: { assetRoot: root } }).execute(operation.generationOperationId, repository); assert.equal(result.status, expected); assert.equal(repository.listAssets().filter((asset) => asset.assetType === "video").length, 0); assert.equal(new GenerationOperationService().claim(operation.generationOperationId, repository).status, "rejected"); }

// FFprobe must affirm both streams and a positive duration after FFmpeg exits successfully.
for (const probeResult of [
  { status: "ok" as const, durationSeconds: 10, hasAudio: false, hasVideo: true },
  { status: "ok" as const, durationSeconds: 10, hasAudio: true, hasVideo: false },
  { status: "failed" as const, reason: "zero duration" },
]) {
  const root = mkdtempSync(path.join(tmpdir(), "novara-render-probe-failure-")); const { repository, operation } = setup(root); const ex = executor(root);
  ex.probe = async (_exe, filePath) => filePath.endsWith("audio.mp3") ? { status: "ok", durationSeconds: 10, hasAudio: true, hasVideo: false } : probeResult;
  const result = await new FFmpegVideoRenderService({ executor: ex, config: { assetRoot: root } }).execute(operation.generationOperationId, repository);
  assert.equal(result.status, "failed");
}

// Concurrent executions share one durable claim and one renderer invocation.
{
  const root = mkdtempSync(path.join(tmpdir(), "novara-render-concurrent-")); const { repository, operation } = setup(root); const first = new RuntimeRepository(new FileRuntimeStore(root)); const second = new RuntimeRepository(new FileRuntimeStore(root)); const calls = { count: 0 }; const shared = executor(root, "success", calls); const [one, two] = await Promise.all([new FFmpegVideoRenderService({ executor: shared, config: { assetRoot: root } }).execute(operation.generationOperationId, first), new FFmpegVideoRenderService({ executor: shared, config: { assetRoot: root } }).execute(operation.generationOperationId, second)]); assert.equal(calls.count, 1); assert.equal([one.status, two.status].filter((status) => status === "completed").length, 1);
}

// Local integration: use the installed binaries to create tiny real inputs and render a real MP4.
{
  const available = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0 && spawnSync("ffprobe", ["-version"], { stdio: "ignore" }).status === 0;
  if (available) {
    const root = mkdtempSync(path.join(tmpdir(), "novara-render-real-")); const { repository, operation, audio, images } = setup(root);
    const imageOne = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x240", "-frames:v", "1", "-y", images[0].localPath!]);
    const imageTwo = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=green:s=320x240", "-frames:v", "1", "-y", images[1].localPath!]);
    const audioResult = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", "-c:a", "libmp3lame", "-y", audio.localPath!]);
    assert.equal(imageOne.status, 0); assert.equal(imageTwo.status, 0); assert.equal(audioResult.status, 0);
    const result = await new FFmpegVideoRenderService({ config: { assetRoot: root } }).execute(operation.generationOperationId, repository);
    assert.equal(result.status, "completed");
    if (result.status === "completed") assert.ok(readFileSync(result.asset.localPath!).length > 0);
  } else {
    console.log("FFmpeg local integration test skipped: verified binaries unavailable.");
  }
}

console.log("FFmpeg video render tests passed.");
