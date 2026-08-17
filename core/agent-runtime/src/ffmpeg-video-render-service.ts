import { accessSync, constants, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { GenerationOperationService, type GenerationOperationRepository } from "./generation-operation-service.ts";
import type { AssetMetadata, GenerationOperation, ProductionBrief, VisualSceneAssetMapping } from "./types.ts";

const VIDEO_ASSET_MIME = "video/mp4";
const SRT_ASSET_MIME = "application/x-subrip";
const OUTPUT_SIZE_BY_ASPECT: Record<string, string> = { "9:16": "1080:1920", "1:1": "1080:1080", "16:9": "1920:1080" };
const PROCESS_TIMEOUT_MS = 120000;
const TIMELINE_TOLERANCE_SECONDS = 0.25;

export interface FFmpegProcessExecutor {
  isAvailable(executable: string): boolean;
  run(executable: string, args: string[]): Promise<{ status: "exited"; code: number; stderr: string; stdout: string } | { status: "unknown"; reason: string }>;
  probe(executable: string, filePath: string): Promise<{ status: "ok"; durationSeconds: number; hasAudio: boolean; hasVideo: boolean } | { status: "failed"; reason: string } | { status: "unknown"; reason: string }>;
}

function spawnProcess(executable: string, args: string[]): Promise<{ status: "exited"; code: number; stderr: string; stdout: string } | { status: "unknown"; reason: string }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ status: "unknown", reason: "FFmpeg process timed out or was interrupted; render outcome is unknown." });
    }, PROCESS_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: "exited", code: -1, stderr: error.message, stdout });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status: "exited", code: code ?? -1, stderr, stdout });
    });
  });
}

const defaultExecutor: FFmpegProcessExecutor = {
  isAvailable: (executable) => spawnSync(executable, ["-version"], { windowsHide: true, stdio: "ignore" }).status === 0,
  run: spawnProcess,
  probe: async (executable, filePath) => {
    const result = await spawnProcess(executable, ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", filePath]);
    if (result.status === "unknown") return result;
    if (result.code !== 0) return { status: "failed", reason: "FFprobe could not read the media file." };
    try {
      const parsed = JSON.parse(result.stdout || "{}");
      const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
      const duration = Number(parsed.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0) return { status: "failed", reason: "FFprobe returned no valid media duration." };
      return { status: "ok", durationSeconds: duration, hasAudio: streams.some((stream: { codec_type?: string }) => stream.codec_type === "audio"), hasVideo: streams.some((stream: { codec_type?: string }) => stream.codec_type === "video") };
    } catch {
      return { status: "failed", reason: "FFprobe returned unreadable media metadata." };
    }
  },
};

export interface VideoRenderRepository extends GenerationOperationRepository {
  listGenerationOperations(): GenerationOperation[];
  getVisualSceneAssetMapping(productionBriefId: string, sceneSequence: number): VisualSceneAssetMapping | undefined;
}

export interface VideoRenderConfig {
  ffmpegPath?: string;
  ffprobePath?: string;
  assetRoot?: string;
  /** Optional licensed music bed mixed under the narration. */
  musicPath?: string;
}

export type VideoRenderResult =
  | { status: "completed"; operation: GenerationOperation; asset: AssetMetadata }
  | { status: "failed" | "unknown-result"; operation?: GenerationOperation; reason: string };

function localReadable(filePath: string | undefined): filePath is string {
  if (!filePath || /^https?:\/\//i.test(filePath) || !existsSync(filePath)) return false;
  try {
    accessSync(filePath, constants.R_OK);
    return statSync(filePath).isFile() && statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function quoteConcatPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function quoteSubtitleFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function getOutputSize(brief: ProductionBrief): string | undefined {
  return brief.aspectRatio ? OUTPUT_SIZE_BY_ASPECT[brief.aspectRatio] : undefined;
}

const RENDER_FPS = 30;
/** Stills are upscaled before zoompan so the zoom steps do not visibly jitter. */
const MOTION_SUPERSAMPLE = 1.5;
const MOTION_MAX_ZOOM = 1.15;
const MOTION_ZOOM_PER_FRAME = 0.0009;

/**
 * Slow push or pull across each still, alternating direction per scene so a
 * sequence does not read as one mechanical move. This is what separates a
 * documentary feel from a slideshow.
 */
function buildSceneMotionFilter(inputIndex: number, durationSeconds: number, width: number, height: number): string {
  const frames = Math.max(1, Math.round(durationSeconds * RENDER_FPS));
  const superWidth = Math.round((width * MOTION_SUPERSAMPLE) / 2) * 2;
  const superHeight = Math.round((height * MOTION_SUPERSAMPLE) / 2) * 2;
  const zoomExpression =
    inputIndex % 2 === 0
      ? `min(1+${MOTION_ZOOM_PER_FRAME}*on,${MOTION_MAX_ZOOM})`
      : `max(${MOTION_MAX_ZOOM}-${MOTION_ZOOM_PER_FRAME}*on,1)`;

  return [
    `[${inputIndex}:v]scale=${superWidth}:${superHeight}:force_original_aspect_ratio=increase`,
    `crop=${superWidth}:${superHeight}`,
    `zoompan=z='${zoomExpression}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${RENDER_FPS}`,
    `setsar=1[v${inputIndex}]`,
  ].join(",");
}

/**
 * Music is loudness-normalised rather than scaled by a fixed multiplier: the
 * correct gain depends entirely on how the source track was mastered, so a
 * fixed factor makes a quiet track inaudible and a loud one overpower the
 * voice. -31 LUFS sits under typical narration: present, but never competing
 * with the words.
 */
const MUSIC_TARGET_LUFS = -31;

/**
 * Burned-in caption styling. Default SRT rendering is small, thin and bottom-
 * anchored, which reads as an untouched subtitle file. Short-form wants heavy
 * type with a thick outline, lifted clear of the platform UI.
 *
 * IMPORTANT: these values are NOT pixels. libass renders SRT against a ~288
 * tall reference and scales up, so FontSize=20 lands around 130px on a 1920
 * tall frame and MarginV=60 around 400px. Pixel-sized values here put the text
 * off-frame entirely. Verified by rendering and sampling a frame.
 */
const CAPTION_STYLE = [
  "FontName=Arial Black",
  "FontSize=20",
  "Bold=1",
  "PrimaryColour=&H00FFFFFF",
  "OutlineColour=&H00000000",
  "BorderStyle=1",
  "Outline=2",
  "Shadow=1",
  "Alignment=2",
  "MarginV=60",
  "MarginL=40",
  "MarginR=40",
].join(",");
const MUSIC_FADE_IN_SECONDS = 1.5;
const MUSIC_FADE_OUT_SECONDS = 2.5;

/**
 * One colour treatment applied to the whole timeline after concat, so every
 * scene shares a look. Generated stills otherwise arrive with different white
 * balance and saturation and read as unrelated stock photos rather than one
 * channel. Deliberately restrained: slight desaturation, mild contrast, a warm
 * highlight / cool shadow split, and a soft vignette to pull the eye in.
 */
const COLOUR_GRADE = [
  "eq=contrast=1.08:saturation=0.9:gamma=1.02",
  "colorbalance=rs=0.03:bs=-0.03:rh=0.02:bh=-0.02",
  "vignette=PI/5",
].join(",");

export function buildFFmpegArguments(
  scenes: Array<{ imagePath: string; durationSeconds: number }>,
  narrationPath: string,
  subtitlePath: string,
  outputPath: string,
  outputSize: string,
  durationSeconds: number,
  musicPath?: string,
): string[] {
  const [width, height] = outputSize.split(":").map((value) => Number(value));
  // Each still must enter as exactly ONE frame. zoompan's `d` is output frames
  // PER INPUT FRAME, so looping the input multiplies the scene length and the
  // output gets truncated inside scene one.
  const inputs: string[] = [];
  for (const scene of scenes) {
    inputs.push("-i", scene.imagePath);
  }

  const narrationIndex = scenes.length;
  const musicIndex = narrationIndex + 1;

  const motion = scenes.map((scene, index) => buildSceneMotionFilter(index, scene.durationSeconds, width, height));
  const concatInputs = scenes.map((_scene, index) => `[v${index}]`).join("");
  const filters = [
    ...motion,
    `${concatInputs}concat=n=${scenes.length}:v=1:a=0[vcat]`,
    // original_size pins libass to real pixels. Without it, SRT input renders
    // against a ~288-tall reference, so pixel-sized margins fall off-frame.
    // Grade before captions so the text stays pure white, not tinted.
    `[vcat]${COLOUR_GRADE},format=yuv420p,subtitles=filename='${quoteSubtitleFilterPath(subtitlePath)}':force_style='${CAPTION_STYLE}'[vout]`,
  ];

  if (musicPath) {
    const fadeOutStart = Math.max(0, durationSeconds - MUSIC_FADE_OUT_SECONDS);
    filters.push(
      `[${musicIndex}:a]loudnorm=I=${MUSIC_TARGET_LUFS}:TP=-2:LRA=11,afade=t=in:st=0:d=${MUSIC_FADE_IN_SECONDS},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${MUSIC_FADE_OUT_SECONDS}[mus]`,
      `[${narrationIndex}:a][mus]amix=inputs=2:duration=first:normalize=0[aout]`,
    );
  }

  return [
    "-hide_banner", "-y",
    ...inputs,
    "-i", narrationPath,
    // Looped so a short bed still covers the whole video.
    ...(musicPath ? ["-stream_loop", "-1", "-i", musicPath] : []),
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", musicPath ? "[aout]" : `${narrationIndex}:a`,
    "-r", String(RENDER_FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
    "-t", String(durationSeconds), "-movflags", "+faststart", outputPath,
  ];
}

export class FFmpegVideoRenderService {
  private readonly executor: FFmpegProcessExecutor;
  private readonly operations: GenerationOperationService;
  private readonly config: Required<VideoRenderConfig>;

  constructor(options: { executor?: FFmpegProcessExecutor; operations?: GenerationOperationService; config?: VideoRenderConfig } = {}) {
    this.executor = options.executor ?? defaultExecutor;
    this.operations = options.operations ?? new GenerationOperationService();
    this.config = {
      ffmpegPath: options.config?.ffmpegPath ?? process.env.NOVARA_FFMPEG_PATH?.trim() ?? "ffmpeg",
      ffprobePath: options.config?.ffprobePath ?? process.env.NOVARA_FFPROBE_PATH?.trim() ?? "ffprobe",
      assetRoot: options.config?.assetRoot ?? path.resolve(process.cwd(), ".novara/runtime/assets"),
      musicPath: options.config?.musicPath ?? process.env.NOVARA_MUSIC_PATH?.trim() ?? "",
    };
  }

  async execute(operationId: string, repository: VideoRenderRepository, now = new Date().toISOString()): Promise<VideoRenderResult> {
    const operation = repository.getGenerationOperation(operationId);
    if (!operation) return { status: "failed", reason: "Video render operation was not found." };
    if (operation.operationType !== "video") return { status: "failed", operation, reason: "Generation operation is not a video render operation." };
    if (operation.status !== "queued") return { status: "failed", operation, reason: `Video render operation is ${operation.status} and cannot be executed.` };
    const brief = repository.getProductionBrief(operation.productionBriefId);
    if (!brief || brief.proposalId !== operation.proposalId || brief.agentId !== "A-014") return { status: "failed", operation, reason: "Referenced Production Brief is missing or invalid." };
    if (brief.productionReadiness !== "ready" || !brief.targetDurationSeconds) return { status: "failed", operation, reason: "Production Brief is not ready for video rendering." };
    const outputSize = getOutputSize(brief);
    if (!outputSize) return { status: "failed", operation, reason: `Production Brief aspect ratio "${brief.aspectRatio ?? "missing"}" is unsupported for local rendering.` };
    if (!this.executor.isAvailable(this.config.ffmpegPath)) return { status: "failed", operation, reason: "FFmpeg is not available at the configured executable path." };
    if (!this.executor.isAvailable(this.config.ffprobePath)) return { status: "failed", operation, reason: "FFprobe is not available at the configured executable path." };
    const scenes = [...brief.visualPlan].sort((left, right) => left.sequence - right.sequence);
    if (scenes.length === 0 || scenes.some((scene, index) => scene.sequence !== index + 1 || !Number.isFinite(scene.durationSeconds) || (scene.durationSeconds ?? 0) <= 0)) return { status: "failed", operation, reason: "Every visual scene must be sequential and have a positive explicit durationSeconds." };
    const timeline = scenes.reduce((total, scene) => total + (scene.durationSeconds ?? 0), 0);
    if (Math.abs(timeline - brief.targetDurationSeconds) > 0.01) return { status: "failed", operation, reason: "Scene durations must exactly equal the Production Brief targetDurationSeconds." };

    const narrationOperation = repository.getGenerationOperationByBrief(operation.productionBriefId, "narration");
    if (!narrationOperation || narrationOperation.status !== "completed" || narrationOperation.resultAssetIds.length !== 1) return { status: "failed", operation, reason: "A completed narration operation with exactly one audio asset is required." };
    const narrationAsset = repository.getAsset(narrationOperation.resultAssetIds[0]);
    if (!narrationAsset || narrationAsset.assetType !== "audio" || narrationAsset.status !== "available" || narrationAsset.mimeType !== "audio/mpeg" || !localReadable(narrationAsset.localPath)) return { status: "failed", operation, reason: "A readable local MP3 narration asset is required." };
    const narrationProbe = await this.executor.probe(this.config.ffprobePath, narrationAsset.localPath);
    if (narrationProbe.status !== "ok") return { status: narrationProbe.status === "unknown" ? "unknown-result" : "failed", operation, reason: narrationProbe.reason };
    if (!narrationProbe.hasAudio || Math.abs(narrationProbe.durationSeconds - timeline) > TIMELINE_TOLERANCE_SECONDS) return { status: "failed", operation, reason: "Narration duration must match the explicit visual timeline within 0.25 seconds." };

    const subtitleOperation = repository.getGenerationOperationByBrief(operation.productionBriefId, "subtitle");
    if (!subtitleOperation || subtitleOperation.status !== "completed") return { status: "failed", operation, reason: "A completed subtitle operation is required." };
    const subtitleAssetId = subtitleOperation.resultAssetIds.find((assetId) => {
      const asset = repository.getAsset(assetId);
      return asset?.assetType === "subtitle" && asset.mimeType === SRT_ASSET_MIME;
    });
    const subtitleAsset = subtitleAssetId ? repository.getAsset(subtitleAssetId) : undefined;
    if (!subtitleAsset || subtitleAsset.generationOperationId !== subtitleOperation.generationOperationId || subtitleAsset.productionBriefId !== operation.productionBriefId || subtitleAsset.proposalId !== operation.proposalId || !localReadable(subtitleAsset.localPath)) return { status: "failed", operation, reason: "A readable local SRT subtitle asset matching the render operation is required." };

    const imagePaths: string[] = [];
    for (const scene of scenes) {
      const mapping = repository.getVisualSceneAssetMapping(brief.productionBriefId, scene.sequence);
      if (!mapping || mapping.productionBriefId !== operation.productionBriefId || mapping.proposalId !== operation.proposalId || mapping.sceneSequence !== scene.sequence || mapping.generationOperationId === "" || mapping.assetId === "") return { status: "failed", operation, reason: `Missing or invalid visual asset mapping for scene ${scene.sequence}.` };
      const visualOperation = repository.getGenerationOperation(mapping.generationOperationId);
      if (!visualOperation || visualOperation.operationType !== "visual" || visualOperation.status !== "completed" || visualOperation.productionBriefId !== operation.productionBriefId || visualOperation.proposalId !== operation.proposalId || visualOperation.sceneSequence !== scene.sequence || !visualOperation.resultAssetIds.includes(mapping.assetId)) return { status: "failed", operation, reason: `Visual asset mapping for scene ${scene.sequence} does not reference a completed matching visual operation.` };
      const asset = repository.getAsset(mapping.assetId);
      if (!asset || asset.generationOperationId !== mapping.generationOperationId || asset.productionBriefId !== operation.productionBriefId || asset.proposalId !== operation.proposalId || asset.assetType !== "image" || asset.status !== "available" || !asset.mimeType?.startsWith("image/") || !localReadable(asset.localPath)) return { status: "failed", operation, reason: `Missing or unreadable local image asset for scene ${scene.sequence}.` };
      imagePaths.push(asset.localPath);
    }

    const claimed = this.operations.claim(operationId, repository, now);
    if (claimed.status !== "updated") return { status: "failed", reason: claimed.reason };
    let sceneListPath: string;
    let outputPath: string;
    let finalPath: string;
    try {
      mkdirSync(this.config.assetRoot, { recursive: true });
      const workDir = path.join(this.config.assetRoot, `${operationId}.render`);
      mkdirSync(workDir, { recursive: true });
      sceneListPath = path.join(workDir, "scenes.txt");
      outputPath = path.join(workDir, `${operationId}.mp4`);
      finalPath = path.join(this.config.assetRoot, `${operationId}.mp4`);
      // Scene timings now drive per-image zoompan inputs directly, so the
      // concat list only remains as a record of what was rendered.
      const listLines: string[] = [];
      scenes.forEach((scene, index) => { listLines.push(`file '${quoteConcatPath(imagePaths[index])}'`, `duration ${scene.durationSeconds}`); });
      writeFileSync(sceneListPath, `${listLines.join("\n")}\n`, "utf8");
    } catch {
      const unknown = this.operations.markUnknown(operationId, "Render workspace persistence failed after the operation was claimed; the local result is unknown.", repository, new Date().toISOString());
      return { status: "unknown-result", operation: unknown.status === "updated" ? unknown.operation : undefined, reason: "Render workspace persistence failed after the operation was claimed; the local result is unknown." };
    }

    const renderScenes = scenes.map((scene, index) => ({ imagePath: imagePaths[index], durationSeconds: scene.durationSeconds ?? 0 }));
    // A configured-but-missing music file must not silently render without it.
    const musicPath = this.config.musicPath && localReadable(this.config.musicPath) ? this.config.musicPath : undefined;
    if (this.config.musicPath && !musicPath) {
      const failed = this.operations.fail(operationId, "Configured music bed is missing or unreadable.", repository, new Date().toISOString());
      return { status: "failed", operation: failed.status === "updated" ? failed.operation : undefined, reason: "Configured music bed is missing or unreadable." };
    }
    const render = await this.executor.run(this.config.ffmpegPath, buildFFmpegArguments(renderScenes, narrationAsset.localPath, subtitleAsset.localPath, outputPath, outputSize, narrationProbe.durationSeconds, musicPath));
    if (render.status === "unknown") {
      const unknown = this.operations.markUnknown(operationId, render.reason, repository, new Date().toISOString());
      return unknown.status === "updated" ? { status: "unknown-result", operation: unknown.operation, reason: unknown.reason } : { status: "unknown-result", reason: render.reason };
    }
    if (render.code !== 0 || !localReadable(outputPath)) {
      const failed = this.operations.fail(operationId, "FFmpeg failed or did not produce a non-empty MP4.", repository, new Date().toISOString());
      return failed.status === "updated" ? { status: "failed", operation: failed.operation, reason: "FFmpeg failed or did not produce a non-empty MP4." } : { status: "failed", reason: "FFmpeg failed or did not produce a non-empty MP4." };
    }
    const verified = await this.executor.probe(this.config.ffprobePath, outputPath);
    if (verified.status !== "ok" || !verified.hasVideo || !verified.hasAudio) {
      const result = verified.status === "unknown" ? this.operations.markUnknown(operationId, verified.reason, repository, new Date().toISOString()) : this.operations.fail(operationId, verified.status === "failed" ? verified.reason : "FFprobe did not verify audio and video streams.", repository, new Date().toISOString());
      return result.status === "updated" ? { status: verified.status === "unknown" ? "unknown-result" : "failed", operation: result.operation, reason: verified.status === "unknown" ? verified.reason : "FFprobe did not verify audio and video streams." } : { status: "failed", reason: "FFprobe could not verify the rendered MP4." };
    }
    try {
      renameSync(outputPath, finalPath);
    } catch {
      const unknown = this.operations.markUnknown(operationId, "Rendered MP4 was verified but could not be promoted to durable asset storage; the local result is unknown.", repository, new Date().toISOString());
      return { status: "unknown-result", operation: unknown.status === "updated" ? unknown.operation : undefined, reason: "Rendered MP4 was verified but could not be promoted to durable asset storage; the local result is unknown." };
    }
    const asset: AssetMetadata = { assetId: `asset-${operationId}`, generationOperationId: operationId, productionBriefId: operation.productionBriefId, proposalId: operation.proposalId, assetType: "video", status: "available", localPath: finalPath, reference: finalPath, mimeType: VIDEO_ASSET_MIME, durationSeconds: verified.durationSeconds, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const completed = this.operations.complete(operationId, [asset], repository, new Date().toISOString());
    return completed.status === "updated" ? { status: "completed", operation: completed.operation, asset } : { status: "unknown-result", reason: "Rendered MP4 was verified but completion persistence failed." };
  }
}
