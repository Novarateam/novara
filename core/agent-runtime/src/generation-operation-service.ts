import type {
  AssetMetadata,
  GenerationOperation,
  GenerationOperationStatus,
  ProductionBrief,
  VisualSceneAssetMapping,
  NarrationAlignment,
} from "./types.ts";

const CONTENT_AGENT_ID = "A-014" as const;
const NARRATION_OPERATION_TYPE = "narration" as const;
const VISUAL_OPERATION_TYPE = "visual" as const;
const VIDEO_OPERATION_TYPE = "video" as const;
const ALIGNMENT_OPERATION_TYPE = "alignment" as const;
const SUBTITLE_OPERATION_TYPE = "subtitle" as const;

export interface GenerationOperationRepository {
  getProductionBrief(productionBriefId: string): ProductionBrief | undefined;
  getGenerationOperation(generationOperationId: string): GenerationOperation | undefined;
  getGenerationOperationByBrief(productionBriefId: string, operationType: GenerationOperation["operationType"], sceneSequence?: number): GenerationOperation | undefined;
  createGenerationOperation(operation: GenerationOperation): GenerationOperation;
  claimGenerationOperation(generationOperationId: string, operation: GenerationOperation): GenerationOperation | undefined;
  updateGenerationOperation(generationOperationId: string, expectedStatus: GenerationOperationStatus, operation: GenerationOperation): GenerationOperation | undefined;
  completeGenerationOperation(generationOperationId: string, operation: GenerationOperation, assets: AssetMetadata[], mappings?: VisualSceneAssetMapping[], alignment?: NarrationAlignment): GenerationOperation | undefined;
  getAsset(assetId: string): AssetMetadata | undefined;
  listAssets(): AssetMetadata[];
}

export type CreateGenerationOperationResult =
  | { status: "created"; operation: GenerationOperation }
  | { status: "existing"; operation: GenerationOperation }
  | { status: "rejected"; reason: string };

export type GenerationTransitionResult =
  | { status: "updated"; operation: GenerationOperation }
  | { status: "rejected"; reason: string };

function isNarrationBriefReady(brief: ProductionBrief): boolean {
  return brief.agentId === CONTENT_AGENT_ID
    && brief.productionReadiness === "ready"
    && typeof brief.narrationScript === "string"
    && brief.narrationScript.trim().length > 0;
}

function operationIdFor(brief: ProductionBrief): string {
  return `generation-${brief.productionBriefId}-${NARRATION_OPERATION_TYPE}`;
}

function visualOperationIdFor(brief: ProductionBrief, sceneSequence: number): string {
  return `generation-${brief.productionBriefId}-${VISUAL_OPERATION_TYPE}-${sceneSequence}`;
}

function videoOperationIdFor(brief: ProductionBrief): string {
  return `generation-${brief.productionBriefId}-${VIDEO_OPERATION_TYPE}`;
}

function alignmentOperationIdFor(brief: ProductionBrief): string {
  return `generation-${brief.productionBriefId}-${ALIGNMENT_OPERATION_TYPE}`;
}

function subtitleOperationIdFor(brief: ProductionBrief): string {
  return `generation-${brief.productionBriefId}-${SUBTITLE_OPERATION_TYPE}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Inert generation domain boundary. It never calls a provider or creates an asset by itself. */
export class GenerationOperationService {
  createNarrationOperation(brief: ProductionBrief, repository: GenerationOperationRepository, now = nowIso()): CreateGenerationOperationResult {
    if (!brief.productionBriefId || !brief.proposalId || brief.agentId !== CONTENT_AGENT_ID) {
      return { status: "rejected", reason: "A valid A-014 Production Brief is required." };
    }
    const persistedBrief = repository.getProductionBrief(brief.productionBriefId);
    if (!persistedBrief || persistedBrief.proposalId !== brief.proposalId) {
      return { status: "rejected", reason: "Production Brief does not exist in durable repository state." };
    }
    if (!isNarrationBriefReady(brief)) {
      return { status: "rejected", reason: "Production Brief is not ready for narration generation; narrationScript and all production requirements are required." };
    }

    const existing = repository.getGenerationOperationByBrief(brief.productionBriefId, NARRATION_OPERATION_TYPE);
    if (existing) return { status: "existing", operation: existing };

    const operation: GenerationOperation = {
      generationOperationId: operationIdFor(brief),
      productionBriefId: brief.productionBriefId,
      proposalId: brief.proposalId,
      agentId: CONTENT_AGENT_ID,
      operationType: NARRATION_OPERATION_TYPE,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      resultAssetIds: [],
    };
    return { status: "created", operation: repository.createGenerationOperation(operation) };
  }

  createVisualOperation(brief: ProductionBrief, repository: GenerationOperationRepository, sceneSequence: number, now = nowIso()): CreateGenerationOperationResult {
    if (!brief.productionBriefId || !brief.proposalId || brief.agentId !== CONTENT_AGENT_ID) {
      return { status: "rejected", reason: "A valid A-014 Production Brief is required." };
    }
    const persistedBrief = repository.getProductionBrief(brief.productionBriefId);
    if (!persistedBrief || persistedBrief.proposalId !== brief.proposalId) {
      return { status: "rejected", reason: "Production Brief does not exist in durable repository state." };
    }
    if (brief.productionReadiness !== "ready" || brief.visualPlan.length === 0) {
      return { status: "rejected", reason: "Production Brief is not ready for visual production and has no valid visual plan." };
    }
    const scene = brief.visualPlan.find((candidate) => candidate.sequence === sceneSequence && candidate.description.trim());
    if (!scene) return { status: "rejected", reason: "Requested visual scene does not exist or has no description." };

    const existing = repository.getGenerationOperationByBrief(brief.productionBriefId, VISUAL_OPERATION_TYPE, sceneSequence);
    if (existing) return { status: "existing", operation: existing };
    if (existing) return { status: "existing", operation: existing };

    const operation: GenerationOperation = {
      generationOperationId: visualOperationIdFor(brief, sceneSequence),
      productionBriefId: brief.productionBriefId,
      proposalId: brief.proposalId,
      agentId: CONTENT_AGENT_ID,
      operationType: VISUAL_OPERATION_TYPE,
      sceneSequence,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      resultAssetIds: [],
    };
    return { status: "created", operation: repository.createGenerationOperation(operation) };
  }

  createVideoOperation(brief: ProductionBrief, repository: GenerationOperationRepository, now = nowIso()): CreateGenerationOperationResult {
    if (!brief.productionBriefId || !brief.proposalId || brief.agentId !== CONTENT_AGENT_ID) return { status: "rejected", reason: "A valid A-014 Production Brief is required." };
    const persistedBrief = repository.getProductionBrief(brief.productionBriefId);
    if (!persistedBrief || persistedBrief.proposalId !== brief.proposalId) return { status: "rejected", reason: "Production Brief does not exist in durable repository state." };
    if (brief.productionReadiness !== "ready" || brief.visualPlan.length === 0 || !brief.targetDurationSeconds) return { status: "rejected", reason: "Production Brief is not ready for video rendering." };
    const existing = repository.getGenerationOperationByBrief(brief.productionBriefId, VIDEO_OPERATION_TYPE);
    if (existing) return { status: "existing", operation: existing };
    const operation: GenerationOperation = {
      generationOperationId: videoOperationIdFor(brief),
      productionBriefId: brief.productionBriefId,
      proposalId: brief.proposalId,
      agentId: CONTENT_AGENT_ID,
      operationType: VIDEO_OPERATION_TYPE,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      resultAssetIds: [],
    };
    return { status: "created", operation: repository.createGenerationOperation(operation) };
  }

  createAlignmentOperation(brief: ProductionBrief, repository: GenerationOperationRepository, now = nowIso()): CreateGenerationOperationResult {
    if (!brief.productionBriefId || !brief.proposalId || brief.agentId !== CONTENT_AGENT_ID) return { status: "rejected", reason: "A valid A-014 Production Brief is required." };
    const persistedBrief = repository.getProductionBrief(brief.productionBriefId);
    if (!persistedBrief || persistedBrief.proposalId !== brief.proposalId) return { status: "rejected", reason: "Production Brief does not exist in durable repository state." };
    if (!isNarrationBriefReady(brief)) return { status: "rejected", reason: "Production Brief is not ready for narration alignment." };
    const existing = repository.getGenerationOperationByBrief(brief.productionBriefId, ALIGNMENT_OPERATION_TYPE);
    if (existing) return { status: "existing", operation: existing };
    const operation: GenerationOperation = {
      generationOperationId: alignmentOperationIdFor(brief),
      productionBriefId: brief.productionBriefId,
      proposalId: brief.proposalId,
      agentId: CONTENT_AGENT_ID,
      operationType: ALIGNMENT_OPERATION_TYPE,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      resultAssetIds: [],
    };
    return { status: "created", operation: repository.createGenerationOperation(operation) };
  }

  createSubtitleOperation(brief: ProductionBrief, repository: GenerationOperationRepository, now = nowIso()): CreateGenerationOperationResult {
    if (!brief.productionBriefId || !brief.proposalId || brief.agentId !== CONTENT_AGENT_ID) return { status: "rejected", reason: "A valid A-014 Production Brief is required." };
    const persistedBrief = repository.getProductionBrief(brief.productionBriefId);
    if (!persistedBrief || persistedBrief.proposalId !== brief.proposalId) return { status: "rejected", reason: "Production Brief does not exist in durable repository state." };
    if (!isNarrationBriefReady(brief)) return { status: "rejected", reason: "Production Brief is not ready for subtitle generation." };
    const existing = repository.getGenerationOperationByBrief(brief.productionBriefId, SUBTITLE_OPERATION_TYPE);
    if (existing) return { status: "existing", operation: existing };
    const operation: GenerationOperation = {
      generationOperationId: subtitleOperationIdFor(brief),
      productionBriefId: brief.productionBriefId,
      proposalId: brief.proposalId,
      agentId: CONTENT_AGENT_ID,
      operationType: SUBTITLE_OPERATION_TYPE,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      resultAssetIds: [],
    };
    return { status: "created", operation: repository.createGenerationOperation(operation) };
  }

  claim(operationId: string, repository: GenerationOperationRepository, now = nowIso()): GenerationTransitionResult {
    const current = repository.getGenerationOperation(operationId);
    if (!current) return { status: "rejected", reason: "Generation operation was not found." };
    if (current.status !== "queued") return { status: "rejected", reason: `Generation operation is ${current.status} and cannot be claimed.` };
    const claimed = repository.claimGenerationOperation(operationId, { ...current, status: "generating", startedAt: now, updatedAt: now });
    return claimed ? { status: "updated", operation: claimed } : { status: "rejected", reason: "Generation operation was claimed by another process or is no longer queued." };
  }

  fail(operationId: string, reason: string, repository: GenerationOperationRepository, now = nowIso()): GenerationTransitionResult {
    const current = repository.getGenerationOperation(operationId);
    if (!current || current.status !== "generating") return { status: "rejected", reason: "Only a generating operation can be marked failed." };
    const operation = repository.updateGenerationOperation(operationId, "generating", { ...current, status: "failed", updatedAt: now, completedAt: now, failureReason: reason, resultAssetIds: [] });
    return operation ? { status: "updated", operation } : { status: "rejected", reason: "Generation operation was not in the expected generating state." };
  }

  markUnknown(operationId: string, reason: string, repository: GenerationOperationRepository, now = nowIso()): GenerationTransitionResult {
    const current = repository.getGenerationOperation(operationId);
    if (!current || current.status !== "generating") return { status: "rejected", reason: "Only a generating operation can be marked unknown-result." };
    const operation = repository.updateGenerationOperation(operationId, "generating", { ...current, status: "unknown-result", updatedAt: now, completedAt: now, unknownReason: reason, resultAssetIds: [] });
    return operation ? { status: "updated", operation } : { status: "rejected", reason: "Generation operation was not in the expected generating state." };
  }

  complete(operationId: string, assets: AssetMetadata[], repository: GenerationOperationRepository, now = nowIso(), mappings: VisualSceneAssetMapping[] = [], alignment?: NarrationAlignment): GenerationTransitionResult {
    const current = repository.getGenerationOperation(operationId);
    if (!current || current.status !== "generating") return { status: "rejected", reason: "Only a generating operation can be completed." };
    if (assets.length === 0 && !alignment) return { status: "rejected", reason: "A completed generation operation must provide an asset or alignment result." };
    if (assets.some((asset) => !asset.assetId || asset.generationOperationId !== current.generationOperationId || asset.productionBriefId !== current.productionBriefId || asset.proposalId !== current.proposalId)) {
      return { status: "rejected", reason: "Asset metadata does not match the generation operation." };
    }
    const operation = repository.completeGenerationOperation(operationId, { ...current, status: "completed", updatedAt: now, completedAt: now, resultAssetIds: assets.map((asset) => asset.assetId) }, assets, mappings, alignment);
    return operation ? { status: "updated", operation } : { status: "rejected", reason: "Generation operation was not in the expected generating state." };
  }
}
