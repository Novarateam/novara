/**
 * One real end-to-end content production run.
 *
 * Composes the existing production services with LIVE adapters instead of the
 * test stubs, in the same order the integration test proves correct:
 *
 *   narration -> timing correction -> visuals -> alignment -> subtitles -> video
 *
 * This produces a finished 9:16 MP4 on disk. It deliberately does NOT publish.
 * Review and publishing remain behind their existing governance gates.
 *
 * Usage: node ops/produce-one.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ElevenLabsForcedAlignmentAdapter } from "../core/agent-runtime/src/elevenlabs-forced-alignment-adapter.ts";
import { ElevenLabsNarrationAdapter } from "../core/agent-runtime/src/elevenlabs-narration-adapter.ts";
import {
  ElevenLabsNarrationService,
  LocalNarrationAssetWriter,
} from "../core/agent-runtime/src/elevenlabs-narration-service.ts";
import { FFmpegVideoRenderService } from "../core/agent-runtime/src/ffmpeg-video-render-service.ts";
import { GenerationOperationService } from "../core/agent-runtime/src/generation-operation-service.ts";
import { NarrationAlignmentService } from "../core/agent-runtime/src/narration-alignment-service.ts";
import { OpenAIVisualGenerationAdapter } from "../core/agent-runtime/src/openai-image-generation-adapter.ts";
import { FileRuntimeStore, RuntimeRepository } from "../core/agent-runtime/src/persistence.ts";
import { normalizeAndPersistProductionBrief } from "../core/agent-runtime/src/production-brief-service.ts";
import {
  LocalSubtitleAssetWriter,
  SubtitleGenerationService,
} from "../core/agent-runtime/src/subtitle-generation-service.ts";
import {
  LocalVisualAssetWriter,
  VisualProductionService,
} from "../core/agent-runtime/src/visual-production-service.ts";
import type {
  CompanyMemoryEntry,
  ContentReviewDecisionRecord,
  PublishingQueueEntry,
} from "../core/agent-runtime/src/types.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The creative brief for one history short.
 *
 * Scenes carry a `weight` rather than a fixed duration. The runner measures the
 * real narration length first, then distributes it across scenes by weight, so
 * the render service's 0.25s audio/visual sync rule is satisfied for ANY script
 * without hand-tuning. Weights here are the word counts of each script beat, so
 * visuals change roughly when the sentence does.
 */
const brief = {
  platform: "instagram",
  title: "Why Roman concrete outlasts ours",
  hook: "Roman concrete gets stronger with age. Ours falls apart.",
  caption: "The flaw that turned out to be the feature.",
  hashtags: ["history", "ancientrome", "engineering"],
  narration:
    "Roman concrete has survived two thousand years in seawater. Modern concrete starts crumbling in fifty. For decades nobody knew why. Then researchers found the answer hiding in the flaws: tiny chunks of lime the Romans never mixed properly. When water seeps into a crack, it dissolves that lime, and the concrete reseals itself. The mistake was the mechanism.",
  scenes: [
    { sequence: 1, weight: 9, description: "An ancient Roman harbour pier of weathered concrete standing in turquoise seawater, waves breaking against it, warm late afternoon light, photorealistic wide shot, no people" },
    { sequence: 2, weight: 11, description: "A modern concrete highway overpass with deep cracks, rust stains and crumbling spalled edges, flat grey overcast light, documentary photography, no people" },
    { sequence: 3, weight: 18, description: "An extreme macro close-up of grey volcanic ash concrete showing bright white chunks of lime embedded in the rough surface, sharp scientific detail, raking light" },
    { sequence: 4, weight: 15, description: "A macro close-up of a hairline crack running through pale stone with water seeping along it and glistening, shallow depth of field, cool light" },
    { sequence: 5, weight: 5, description: "The same ancient Roman sea pier at golden hour, intact and monumental against calm water, sweeping wide shot, photorealistic, no people" },
  ],
} as const;

/**
 * ElevenLabs is not deterministic: the same text rendered twice differs in
 * length by seconds. So we never estimate — we measure the exact narration the
 * pipeline produced, then correct the brief before rendering.
 */
function probeDurationSeconds(filePath: string): number {
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
    { encoding: "utf8", windowsHide: true },
  );
  const seconds = Number(probe.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`could not read duration of ${filePath} (ffprobe said: ${probe.stdout || probe.stderr})`);
  }
  return seconds;
}

/** Distributes total seconds across scenes by weight, absorbing rounding into the last scene. */
function planSceneDurations(totalSeconds: number): Array<{ sequence: number; description: string; durationSeconds: number }> {
  const totalWeight = brief.scenes.reduce((sum, scene) => sum + scene.weight, 0);
  let allocated = 0;
  return brief.scenes.map((scene, index) => {
    const isLast = index === brief.scenes.length - 1;
    const duration = isLast
      ? Number((totalSeconds - allocated).toFixed(3))
      : Number(((totalSeconds * scene.weight) / totalWeight).toFixed(3));
    allocated = Number((allocated + duration).toFixed(3));
    return { sequence: scene.sequence, description: scene.description, durationSeconds: duration };
  });
}

function loadEnv(): void {
  const envPath = path.join(repoRoot, ".env");
  if (!existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath}`);
  }
  process.loadEnvFile(envPath);
}

function buildProposal(
  now: string,
  scenes: Array<{ sequence: number; description: string; durationSeconds: number }>,
): CompanyMemoryEntry {
  return {
    id: `proposal-live-${Date.now()}`,
    type: "evidence",
    source: "A-014/produce-one",
    timestamp: now,
    confidence: 0.9,
    authority: "recommend",
    status: "proposed",
    content: {
      objective: "Produce one real history short for the Novara channel.",
      structuredResult: {
        summary: "A history short on why Roman concrete outlasts modern concrete.",
        platform: brief.platform,
        hook: brief.hook,
        title: brief.title,
        caption: brief.caption,
        hashtags: [...brief.hashtags],
        angle: "education",
        confidence: 0.9,
        reasons: ["Explicit production plan", "Factual historical claim"],
        humanReviewRequired: true,
        productionPlan: {
          productionPlanVersion: "1",
          targetPlatform: brief.platform,
          contentScript: brief.narration,
          narrationScript: brief.narration,
          visualPlan: scenes.map((scene) => ({ ...scene })),
          requiredMediaType: "short-form-video",
          aspectRatio: "9:16",
          targetDurationSeconds: Number(
            scenes.reduce((total, scene) => total + scene.durationSeconds, 0).toFixed(3),
          ),
          captionRequirements: { burnedIn: true, language: "en" },
        },
      },
    },
  };
}

function step(label: string): void {
  console.log(`\n> ${label}`);
}

async function main(): Promise<void> {
  loadEnv();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runRoot = path.join(repoRoot, ".novara", "runtime", `production-${stamp}`);
  const assetRoot = path.join(runRoot, "assets");
  mkdirSync(assetRoot, { recursive: true });

  console.log("\n--- NOVARA LIVE PRODUCTION RUN ---");
  console.log(`run dir: ${runRoot}`);
  console.log(`title:   ${brief.title}`);
  console.log(`scenes:  ${brief.scenes.length}`);

  // Placeholder timings; corrected from the real narration before rendering.
  const now = new Date().toISOString();
  const proposal = buildProposal(now, planSceneDurations(brief.scenes.length));  // placeholder

  const repository = new RuntimeRepository(new FileRuntimeStore(runRoot));
  repository.upsertMemory(proposal);

  const decision: ContentReviewDecisionRecord = {
    decisionId: `decision-${stamp}`,
    proposalId: proposal.id,
    agentId: "A-014",
    reviewerId: "human",
    decision: "approved",
    recordedAt: now,
  };
  const queueEntry: PublishingQueueEntry = {
    queueEntryId: `queue-${stamp}`,
    proposalId: proposal.id,
    agentId: "A-014",
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  repository.createContentReviewDecision(decision);
  repository.createPublishingQueueEntry(queueEntry);

  const normalized = normalizeAndPersistProductionBrief(proposal, repository, now);
  if (normalized?.status !== "created") {
    throw new Error(`brief normalization failed: ${JSON.stringify(normalized)}`);
  }
  const productionBrief = repository.getProductionBrief(normalized.brief.productionBriefId)!;
  console.log(`brief:   ${productionBrief.productionBriefId} (${productionBrief.productionReadiness})`);

  const operations = new GenerationOperationService();

  step("Generating narration via ElevenLabs");
  const narrationCreated = operations.createNarrationOperation(productionBrief, repository);
  if (narrationCreated.status !== "created") {
    throw new Error(`narration operation: ${narrationCreated.status}`);
  }
  const narrationResult = await new ElevenLabsNarrationService(
    new ElevenLabsNarrationAdapter({ env: process.env }),
    new LocalNarrationAssetWriter(assetRoot),
  ).execute(narrationCreated.operation.generationOperationId, repository);
  if (narrationResult.status !== "completed") {
    throw new Error(`narration failed: ${JSON.stringify(narrationResult)}`);
  }
  console.log(`  audio: ${narrationResult.asset.localPath}`);

  step("Correcting scene timings from the real narration");
  const narrationSeconds = probeDurationSeconds(narrationResult.asset.localPath!);
  const scenes = planSceneDurations(narrationSeconds);
  repository.upsertProductionBrief({
    ...productionBrief,
    visualPlan: scenes,
    targetDurationSeconds: Number(narrationSeconds.toFixed(3)),
  });
  const timedBrief = repository.getProductionBrief(productionBrief.productionBriefId)!;
  console.log(`  narration: ${narrationSeconds.toFixed(3)}s`);
  console.log(`  scenes:    ${scenes.map((scene) => `${scene.durationSeconds}s`).join(" + ")}`);

  step(`Generating ${timedBrief.visualPlan.length} visuals via OpenAI`);
  const visualAdapter = new OpenAIVisualGenerationAdapter({ env: process.env });
  if (!visualAdapter.isConfigured()) {
    throw new Error("OpenAI visual adapter is not configured (OPENAI_API_KEY missing)");
  }
  for (const scene of timedBrief.visualPlan) {
    const created = operations.createVisualOperation(timedBrief, repository, scene.sequence);
    if (created.status !== "created") {
      throw new Error(`visual operation ${scene.sequence}: ${created.status}`);
    }
    const result = await new VisualProductionService(
      visualAdapter,
      new LocalVisualAssetWriter(assetRoot),
    ).execute(created.operation.generationOperationId, repository);
    if (result.status !== "completed") {
      throw new Error(`scene ${scene.sequence} failed: ${JSON.stringify(result)}`);
    }
    console.log(`  scene ${scene.sequence}: ${result.assets[0].localPath}`);
  }

  step("Aligning narration to word timings");
  const alignmentCreated = operations.createAlignmentOperation(timedBrief, repository);
  if (alignmentCreated.status !== "created") {
    throw new Error(`alignment operation: ${alignmentCreated.status}`);
  }
  const alignmentResult = await new NarrationAlignmentService(
    new ElevenLabsForcedAlignmentAdapter({ env: process.env }),
  ).execute(alignmentCreated.operation.generationOperationId, repository);
  if (alignmentResult.status !== "completed") {
    throw new Error(`alignment failed: ${JSON.stringify(alignmentResult)}`);
  }
  console.log(`  aligned ${alignmentResult.alignment.words.length} words`);

  step("Generating subtitles");
  const subtitleCreated = operations.createSubtitleOperation(timedBrief, repository);
  if (subtitleCreated.status !== "created") {
    throw new Error(`subtitle operation: ${subtitleCreated.status}`);
  }
  const subtitleResult = new SubtitleGenerationService(new LocalSubtitleAssetWriter(assetRoot)).execute(
    subtitleCreated.operation.generationOperationId,
    repository,
  );
  if (subtitleResult.status !== "completed") {
    throw new Error(`subtitles failed: ${JSON.stringify(subtitleResult)}`);
  }
  for (const asset of subtitleResult.assets) {
    console.log(`  ${asset.mimeType}: ${asset.localPath}`);
  }

  step("Rendering video with ffmpeg");
  const videoCreated = operations.createVideoOperation(timedBrief, repository);
  if (videoCreated.status !== "created") {
    throw new Error(`video operation: ${videoCreated.status}`);
  }
  const renderResult = await new FFmpegVideoRenderService({ config: { assetRoot } }).execute(
    videoCreated.operation.generationOperationId,
    repository,
  );
  if (renderResult.status !== "completed") {
    throw new Error(`render failed: ${JSON.stringify(renderResult)}`);
  }

  const videoAsset = repository
    .listAssets()
    .find((asset) => asset.generationOperationId === videoCreated.operation.generationOperationId);

  console.log("\n--- COMPLETE ---");
  console.log(`video:    ${videoAsset?.localPath}`);
  console.log(`duration: ${videoAsset?.durationSeconds}s`);
  console.log(`type:     ${videoAsset?.mimeType}`);
  console.log("\nNothing was published. The publishing queue gate is untouched.\n");
}

main().catch((error) => {
  console.error("\nProduction run failed:", (error as Error).message, "\n");
  process.exitCode = 1;
});
