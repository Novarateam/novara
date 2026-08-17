import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import type { AssetMetadata, GenerationOperation } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService, loadLocalProductionExecutionAccessRules } from "./production-execution-access-service.ts";

export type ProductionStatusCommand = { operation: "readProductionStatus"; proposalId?: string };

export type ProductionControlStage = "production-brief" | "visual" | "narration" | "alignment" | "subtitle" | "video";
export type ProductionControlStageStatus = "not-ready" | "not-created" | "queued" | "in-progress" | "completed" | "blocked" | "failed" | "unknown-result";
export type ProductionOverallStatus = "not-ready" | "awaiting-production-approval" | "rejected-for-production" | "ready-to-produce" | "in-progress" | "blocked" | "failed" | "unknown-result" | "completed";
export type ProductionControlStageSummary = { status: ProductionControlStageStatus; operationIds: string[]; reason: string | null };
export type ProductionControlSummary = {
  overallStatus: ProductionOverallStatus;
  blockingStage: ProductionControlStage | null;
  blockingReason: string | null;
  stages: Record<"productionBrief" | "visual" | "narration" | "alignment" | "subtitle" | "video", ProductionControlStageSummary>;
};

export type ProductionStatusData = {
  proposalId: string;
  contentReviewDecision: ReturnType<RuntimeRepository["getContentReviewDecisionByProposal"]>;
  productionBrief: ReturnType<RuntimeRepository["getProductionBriefByProposal"]>;
  productionApproval: ReturnType<RuntimeRepository["getProductionApprovalByBrief"]>;
  summary: ProductionControlSummary;
  stages: {
    visuals: { operations: GenerationOperation[]; sceneMappings: ReturnType<RuntimeRepository["listVisualSceneAssetMappings"]>; assets: AssetMetadata[] };
    narration: { operation?: GenerationOperation; assets: AssetMetadata[] };
    alignment: { operation?: GenerationOperation; record?: ReturnType<RuntimeRepository["getNarrationAlignmentByOperation"]> };
    subtitles: { operation?: GenerationOperation; assets: AssetMetadata[] };
    video: { operation?: GenerationOperation; assets: AssetMetadata[] };
  };
};

export type ProductionStatusCommandResponse =
  | { status: "ok"; operation: "readProductionStatus"; data: ProductionStatusData }
  | { status: "not-found"; proposalId: string; reason: string }
  | { status: "invalid-request"; reason: string };

function defaultRepository(): RuntimeRepository { return new RuntimeRepository(new FileRuntimeStore()); }

function assetsFor(repository: RuntimeRepository, operation: GenerationOperation | undefined): AssetMetadata[] {
  return operation ? operation.resultAssetIds.flatMap((assetId) => {
    const asset = repository.getAsset(assetId);
    return asset ? [asset] : [];
  }) : [];
}

function operationSummary(operations: GenerationOperation[], hasRequiredOutput: boolean, missingOutputReason: string): ProductionControlStageSummary {
  const operationIds = operations.map((operation) => operation.generationOperationId);
  if (operations.length === 0) return { status: "not-created", operationIds, reason: "Operation has not been created." };
  const failed = operations.find((operation) => operation.status === "failed");
  if (failed) return { status: "failed", operationIds, reason: failed.failureReason ?? "Operation failed." };
  const unknown = operations.find((operation) => operation.status === "unknown-result");
  if (unknown) return { status: "unknown-result", operationIds, reason: unknown.unknownReason ?? "Operation result is unknown." };
  if (operations.some((operation) => operation.status === "generating")) return { status: "in-progress", operationIds, reason: "Operation is generating." };
  if (operations.some((operation) => operation.status === "queued")) return { status: "queued", operationIds, reason: "Operation is queued for explicit execution." };
  if (operations.every((operation) => operation.status === "completed") && hasRequiredOutput) return { status: "completed", operationIds, reason: null };
  return { status: "blocked", operationIds, reason: missingOutputReason };
}

export function deriveProductionControlSummary(data: Omit<ProductionStatusData, "summary">): ProductionControlSummary {
  const productionBrief: ProductionControlStageSummary = !data.productionBrief
    ? { status: "not-ready", operationIds: [], reason: data.contentReviewDecision?.decision === "approved" ? "Production Brief has not been persisted." : "Content Review must be approved before a Production Brief can be created." }
    : data.productionBrief.productionReadiness !== "ready"
      ? { status: "not-ready", operationIds: [], reason: `Production Brief is ${data.productionBrief.productionReadiness}.` }
      : { status: "completed", operationIds: [], reason: null };
  const visual = operationSummary(data.stages.visuals.operations,
    data.productionBrief !== undefined && data.stages.visuals.operations.length === data.productionBrief.visualPlan.length && data.stages.visuals.operations.every((operation) => {
      const mapping = data.stages.visuals.sceneMappings.find((candidate) => candidate.sceneSequence === operation.sceneSequence && candidate.generationOperationId === operation.generationOperationId);
      const asset = mapping && data.stages.visuals.assets.find((candidate) => candidate.assetId === mapping.assetId);
      return asset?.assetType === "image" && asset.status === "available";
    }),
    "Completed visual operations are missing required durable image assets or scene mappings.");
  const narration = operationSummary(data.stages.narration.operation ? [data.stages.narration.operation] : [], data.stages.narration.assets.some((asset) => asset.assetType === "audio" && asset.status === "available" && asset.mimeType === "audio/mpeg"), "Completed narration operation is missing a durable MP3 asset.");
  const alignment = operationSummary(data.stages.alignment.operation ? [data.stages.alignment.operation] : [], Boolean(data.stages.alignment.record), "Completed alignment operation is missing its durable NarrationAlignment record.");
  const subtitle = operationSummary(data.stages.subtitles.operation ? [data.stages.subtitles.operation] : [], data.stages.subtitles.assets.some((asset) => asset.assetType === "subtitle" && asset.status === "available" && asset.mimeType === "application/x-subrip") && data.stages.subtitles.assets.some((asset) => asset.assetType === "subtitle" && asset.status === "available" && asset.mimeType === "text/vtt"), "Completed subtitle operation is missing durable SRT or VTT assets.");
  const video = operationSummary(data.stages.video.operation ? [data.stages.video.operation] : [], data.stages.video.assets.some((asset) => asset.assetType === "video" && asset.status === "available" && asset.mimeType === "video/mp4" && typeof asset.durationSeconds === "number" && asset.durationSeconds > 0), "Completed video operation is missing a durable verified MP4 asset.");
  if (productionBrief.status === "completed" && data.productionApproval?.decision === "rejected-for-production") productionBrief.reason = "Production was explicitly rejected by a human.";
  if (productionBrief.status === "completed" && !data.productionApproval) productionBrief.reason = "Production Brief is ready and awaiting explicit human production approval.";
  const stages = { productionBrief, visual, narration, alignment, subtitle, video };
  if (productionBrief.status === "completed" && data.productionApproval?.decision === "rejected-for-production") return { overallStatus: "rejected-for-production", blockingStage: "production-brief", blockingReason: productionBrief.reason, stages };
  if (productionBrief.status === "completed" && !data.productionApproval) return { overallStatus: "awaiting-production-approval", blockingStage: "production-brief", blockingReason: productionBrief.reason, stages };
  const ordered: Array<[ProductionControlStage, ProductionControlStageSummary]> = [["production-brief", productionBrief], ["visual", visual], ["narration", narration], ["alignment", alignment], ["subtitle", subtitle], ["video", video]];
  const incomplete = ordered.find(([, stage]) => stage.status !== "completed");
  if (!incomplete) return { overallStatus: "completed", blockingStage: null, blockingReason: null, stages };
  const [stageName, stage] = incomplete;
  if (stageName === "production-brief" && data.productionApproval?.decision === "rejected-for-production") return { overallStatus: "rejected-for-production", blockingStage: stageName, blockingReason: productionBrief.reason, stages };
  if (stageName === "production-brief" && !data.productionApproval) return { overallStatus: "awaiting-production-approval", blockingStage: stageName, blockingReason: productionBrief.reason, stages };
  if (stage.status === "not-ready") return { overallStatus: "not-ready", blockingStage: stageName, blockingReason: stage.reason, stages };
  if (stage.status === "failed") return { overallStatus: "failed", blockingStage: stageName, blockingReason: stage.reason, stages };
  if (stage.status === "unknown-result") return { overallStatus: "unknown-result", blockingStage: stageName, blockingReason: stage.reason, stages };
  if (stage.status === "in-progress") return { overallStatus: "in-progress", blockingStage: stageName, blockingReason: stage.reason, stages };
  if (stage.status === "blocked") return { overallStatus: "blocked", blockingStage: stageName, blockingReason: stage.reason, stages };
  return { overallStatus: "ready-to-produce", blockingStage: null, blockingReason: null, stages };
}

/** Read-only persisted production projection. It never claims, executes, writes, or verifies media. */
export function handleProductionStatusCommand(
  command: Partial<ProductionStatusCommand>,
  credential: string | undefined,
  repository: RuntimeRepository = defaultRepository(),
  access = new LocalProductionExecutionAccessService(loadLocalProductionExecutionAccessRules()),
): ProductionStatusCommandResponse {
  const accessResult = access.authorize(command.operation, credential);
  if (accessResult.status !== "authorized") return { status: "invalid-request", reason: accessResult.reason };
  if (command.operation !== "readProductionStatus") return { status: "invalid-request", reason: "Unsupported production status operation." };
  const proposalId = command.proposalId?.trim();
  if (!proposalId) return { status: "invalid-request", reason: "proposalId is required." };
  const proposal = repository.getSnapshot().memory.find((entry) => entry.id === proposalId);
  if (!proposal) return { status: "not-found", proposalId, reason: "Production proposal was not found." };
  const productionBrief = repository.getProductionBriefByProposal(proposalId);
  const operations = productionBrief ? repository.listGenerationOperations().filter((operation) => operation.productionBriefId === productionBrief.productionBriefId && operation.proposalId === proposalId) : [];
  const byType = (operationType: GenerationOperation["operationType"]) => operations.filter((operation) => operation.operationType === operationType);
  const narration = byType("narration")[0];
  const alignment = byType("alignment")[0];
  const subtitles = byType("subtitle")[0];
  const video = byType("video")[0];
  const visuals = byType("visual").sort((left, right) => (left.sceneSequence ?? 0) - (right.sceneSequence ?? 0));
  const sceneMappings = productionBrief ? repository.listVisualSceneAssetMappings(productionBrief.productionBriefId) : [];
  const dataWithoutSummary: Omit<ProductionStatusData, "summary"> = {
    proposalId,
    contentReviewDecision: repository.getContentReviewDecisionByProposal(proposalId),
    productionBrief,
    productionApproval: productionBrief ? repository.getProductionApprovalByBrief(productionBrief.productionBriefId) : undefined,
    stages: {
      visuals: { operations: visuals, sceneMappings, assets: visuals.flatMap((operation) => assetsFor(repository, operation)) },
      narration: { operation: narration, assets: assetsFor(repository, narration) },
      alignment: { operation: alignment, record: alignment ? repository.getNarrationAlignmentByOperation(alignment.generationOperationId) : undefined },
      subtitles: { operation: subtitles, assets: assetsFor(repository, subtitles) },
      video: { operation: video, assets: assetsFor(repository, video) },
    },
  };
  return {
    status: "ok",
    operation: "readProductionStatus",
    data: { ...dataWithoutSummary, summary: deriveProductionControlSummary(dataWithoutSummary) },
  };
}