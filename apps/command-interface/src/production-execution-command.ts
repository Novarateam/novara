import { existsSync, statSync } from "node:fs";
import { ElevenLabsNarrationService } from "../../../core/agent-runtime/src/elevenlabs-narration-service.ts";
import { FFmpegVideoRenderService } from "../../../core/agent-runtime/src/ffmpeg-video-render-service.ts";
import { GenerationOperationService, type CreateGenerationOperationResult } from "../../../core/agent-runtime/src/generation-operation-service.ts";
import { NarrationAlignmentService } from "../../../core/agent-runtime/src/narration-alignment-service.ts";
import { OpenAIVisualGenerationAdapter } from "../../../core/agent-runtime/src/openai-image-generation-adapter.ts";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { SubtitleGenerationService } from "../../../core/agent-runtime/src/subtitle-generation-service.ts";
import { VisualProductionService } from "../../../core/agent-runtime/src/visual-production-service.ts";
import { isContentProposalEntry } from "../../../core/agent-runtime/src/content-review-service.ts";
import type { AssetMetadata, GenerationOperation, ProductionBrief } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService, loadLocalProductionExecutionAccessRules, type ProductionExecutionOperation } from "./production-execution-access-service.ts";

export type ProductionExecutionCommand = { operation: ProductionExecutionOperation; proposalId?: string };
export type ProductionStage = "visual" | "narration" | "alignment" | "subtitle" | "video";

export type ProductionExecutionResult =
  | { status: "completed"; proposalId: string; productionBriefId: string; completedThrough: "video"; videoAssetId: string; localPath: string }
  | { status: "blocked"; proposalId: string; productionBriefId?: string; completedThrough: ProductionStage | null; blockedAt: ProductionStage; operationId?: string; operationStatus?: GenerationOperation["status"]; reason: string }
  | { status: "rejected"; proposalId?: string; reason: string };

export type ProductionExecutionCommandResponse =
  | { status: "ok"; operation: ProductionExecutionOperation; result: ProductionExecutionResult }
  | { status: "invalid-request"; reason: string };

export interface ProductionExecutionDependencies {
  operations: GenerationOperationService;
  visuals: VisualProductionService;
  narration: ElevenLabsNarrationService;
  alignment: NarrationAlignmentService;
  subtitles: SubtitleGenerationService;
  renderer: FFmpegVideoRenderService;
}

function defaultDependencies(): ProductionExecutionDependencies {
  return {
    operations: new GenerationOperationService(),
    visuals: new VisualProductionService(new OpenAIVisualGenerationAdapter()),
    narration: new ElevenLabsNarrationService(),
    alignment: new NarrationAlignmentService(),
    subtitles: new SubtitleGenerationService(),
    renderer: new FFmpegVideoRenderService(),
  };
}

function localReadable(filePath: string | undefined): filePath is string {
  if (!filePath || !existsSync(filePath)) return false;
  try { return statSync(filePath).isFile() && statSync(filePath).size > 0; } catch { return false; }
}

function matchingAsset(repository: RuntimeRepository, operation: GenerationOperation, assetType: AssetMetadata["assetType"], mimeType?: string): AssetMetadata | undefined {
  return operation.resultAssetIds
    .map((assetId) => repository.getAsset(assetId))
    .find((asset) => asset?.generationOperationId === operation.generationOperationId && asset.productionBriefId === operation.productionBriefId && asset.proposalId === operation.proposalId && asset.assetType === assetType && asset.status === "available" && (!mimeType || asset.mimeType === mimeType));
}

function blocked(proposalId: string, brief: ProductionBrief | undefined, completedThrough: ProductionStage | null, blockedAt: ProductionStage, operation: GenerationOperation | undefined, reason: string): ProductionExecutionResult {
  return { status: "blocked", proposalId, ...(brief ? { productionBriefId: brief.productionBriefId } : {}), completedThrough, blockedAt, ...(operation ? { operationId: operation.generationOperationId, operationStatus: operation.status } : {}), reason };
}

async function executeQueued(
  stage: ProductionStage,
  proposalId: string,
  brief: ProductionBrief,
  operation: GenerationOperation,
  completedThrough: ProductionStage | null,
  repository: RuntimeRepository,
  execute: () => Promise<{ status: string; reason?: string }>,
  validate: (current: GenerationOperation) => boolean,
): Promise<{ status: "complete" } | { status: "blocked"; result: ProductionExecutionResult }> {
  let current = repository.getGenerationOperation(operation.generationOperationId) ?? operation;
  let executionReason: string | undefined;
  if (current.status === "queued") {
    try { executionReason = (await execute()).reason; } catch { executionReason = "Production stage raised an ambiguous local error."; }
    current = repository.getGenerationOperation(operation.generationOperationId) ?? current;
  }
  if (current.status !== "completed") return { status: "blocked", result: blocked(proposalId, brief, completedThrough, stage, current, executionReason ?? current.failureReason ?? current.unknownReason ?? `Production stage is ${current.status}.`) };
  if (!validate(current)) return { status: "blocked", result: blocked(proposalId, brief, completedThrough, stage, current, "Completed operation is missing its required durable result.") };
  return { status: "complete" };
}

function operationFrom(result: CreateGenerationOperationResult): GenerationOperation | undefined {
  return result.status === "rejected" ? undefined : result.operation;
}

/** Explicit foreground command: it reuses durable operations and never schedules, retries, or publishes. */
export async function executeApprovedProduction(
  proposalId: string,
  repository: RuntimeRepository,
  dependencies: ProductionExecutionDependencies = defaultDependencies(),
): Promise<ProductionExecutionResult> {
  const proposal = repository.getSnapshot().memory.find((entry) => entry.id === proposalId);
  if (!proposal || !isContentProposalEntry(proposal) || !proposal.id.endsWith("A-014")) return { status: "rejected", proposalId, reason: "Proposal was not found or is not an A-014 content proposal." };
  const decision = repository.getContentReviewDecisionByProposal(proposalId);
  if (!decision || decision.agentId !== "A-014" || decision.decision !== "approved") return { status: "rejected", proposalId, reason: "A human-approved A-014 content review decision is required." };
  const brief = repository.getProductionBriefByProposal(proposalId);
  if (!brief || brief.proposalId !== proposalId || brief.agentId !== "A-014" || brief.productionReadiness !== "ready") return { status: "rejected", proposalId, reason: "A ready A-014 Production Brief is required." };
  const productionApproval = repository.getProductionApprovalByBrief(brief.productionBriefId);
  if (!productionApproval || productionApproval.proposalId !== proposalId || productionApproval.productionBriefId !== brief.productionBriefId) return { status: "rejected", proposalId, reason: "An explicit human production approval for the current Production Brief is required." };
  if (productionApproval.decision === "rejected-for-production") return { status: "rejected", proposalId, reason: "Production was explicitly rejected for this Production Brief." };

  for (const scene of [...brief.visualPlan].sort((left, right) => left.sequence - right.sequence)) {
    const created = dependencies.operations.createVisualOperation(brief, repository, scene.sequence);
    const operation = operationFrom(created);
    if (!operation) return blocked(proposalId, brief, null, "visual", undefined, created.reason);
    const stage = await executeQueued("visual", proposalId, brief, operation, null, repository, () => dependencies.visuals.execute(operation.generationOperationId, repository), (current) => {
      const mapping = repository.getVisualSceneAssetMapping(brief.productionBriefId, scene.sequence);
      const asset = mapping && repository.getAsset(mapping.assetId);
      return mapping?.generationOperationId === current.generationOperationId && mapping.proposalId === proposalId && asset?.generationOperationId === current.generationOperationId && asset.assetType === "image" && asset.status === "available" && localReadable(asset.localPath);
    });
    if (stage.status === "blocked") return stage.result;
  }

  const narrationCreated = dependencies.operations.createNarrationOperation(brief, repository);
  const narrationOperation = operationFrom(narrationCreated);
  if (!narrationOperation) return blocked(proposalId, brief, "visual", "narration", undefined, narrationCreated.reason);
  const narration = await executeQueued("narration", proposalId, brief, narrationOperation, "visual", repository, () => dependencies.narration.execute(narrationOperation.generationOperationId, repository), (current) => Boolean(matchingAsset(repository, current, "audio", "audio/mpeg")?.localPath && localReadable(matchingAsset(repository, current, "audio", "audio/mpeg")?.localPath)));
  if (narration.status === "blocked") return narration.result;

  const alignmentCreated = dependencies.operations.createAlignmentOperation(brief, repository);
  const alignmentOperation = operationFrom(alignmentCreated);
  if (!alignmentOperation) return blocked(proposalId, brief, "narration", "alignment", undefined, alignmentCreated.reason);
  const alignment = await executeQueued("alignment", proposalId, brief, alignmentOperation, "narration", repository, () => dependencies.alignment.execute(alignmentOperation.generationOperationId, repository), (current) => {
    const record = repository.getNarrationAlignmentByOperation(current.generationOperationId);
    return record?.productionBriefId === brief.productionBriefId && record.proposalId === proposalId && record.narrationText === brief.narrationScript;
  });
  if (alignment.status === "blocked") return alignment.result;

  const subtitleCreated = dependencies.operations.createSubtitleOperation(brief, repository);
  const subtitleOperation = operationFrom(subtitleCreated);
  if (!subtitleOperation) return blocked(proposalId, brief, "alignment", "subtitle", undefined, subtitleCreated.reason);
  const subtitle = await executeQueued("subtitle", proposalId, brief, subtitleOperation, "alignment", repository, async () => dependencies.subtitles.execute(subtitleOperation.generationOperationId, repository), (current) => {
    const srt = matchingAsset(repository, current, "subtitle", "application/x-subrip");
    const vtt = matchingAsset(repository, current, "subtitle", "text/vtt");
    return localReadable(srt?.localPath) && localReadable(vtt?.localPath);
  });
  if (subtitle.status === "blocked") return subtitle.result;

  const videoCreated = dependencies.operations.createVideoOperation(brief, repository);
  const videoOperation = operationFrom(videoCreated);
  if (!videoOperation) return blocked(proposalId, brief, "subtitle", "video", undefined, videoCreated.reason);
  const video = await executeQueued("video", proposalId, brief, videoOperation, "subtitle", repository, () => dependencies.renderer.execute(videoOperation.generationOperationId, repository), (current) => {
    const asset = matchingAsset(repository, current, "video", "video/mp4");
    return Boolean(asset && localReadable(asset.localPath) && typeof asset.durationSeconds === "number" && asset.durationSeconds > 0);
  });
  if (video.status === "blocked") return video.result;
  const finalOperation = repository.getGenerationOperation(videoOperation.generationOperationId)!;
  const asset = matchingAsset(repository, finalOperation, "video", "video/mp4")!;
  return { status: "completed", proposalId, productionBriefId: brief.productionBriefId, completedThrough: "video", videoAssetId: asset.assetId, localPath: asset.localPath! };
}

function defaultRepository(): RuntimeRepository { return new RuntimeRepository(new FileRuntimeStore()); }

export async function handleProductionExecutionCommand(
  command: Partial<ProductionExecutionCommand>,
  credential: string | undefined,
  repository: RuntimeRepository = defaultRepository(),
  access = new LocalProductionExecutionAccessService(loadLocalProductionExecutionAccessRules()),
  dependencies: ProductionExecutionDependencies = defaultDependencies(),
): Promise<ProductionExecutionCommandResponse> {
  const accessResult = access.authorize(command.operation, credential);
  if (accessResult.status !== "authorized") {
    repository.appendAuditEvent({ actorId: accessResult.status === "authorization-rejected" ? accessResult.identity : "unauthenticated", type: accessResult.status === "authentication-rejected" ? "production_execution.authentication_rejected" : "production_execution.authorization_rejected", message: "Rejected production execution access.", payload: { operation: command.operation, reason: accessResult.reason } });
    return { status: "invalid-request", reason: accessResult.reason };
  }
  if (command.operation !== "produceApprovedContent") return { status: "invalid-request", reason: "Unsupported production execution operation." };
  const proposalId = command.proposalId?.trim();
  if (!proposalId) return { status: "invalid-request", reason: "proposalId is required." };
  const result = await executeApprovedProduction(proposalId, repository, dependencies);
  repository.appendAuditEvent({ actorId: accessResult.identity, type: "production_execution.executed", message: "Executed explicit production command.", payload: { proposalId, status: result.status, blockedAt: result.status === "blocked" ? result.blockedAt : undefined } });
  return { status: "ok", operation: command.operation, result };
}