import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GenerationOperationService, type GenerationOperationRepository } from "./generation-operation-service.ts";
import type { AssetMetadata, AssetType, GenerationOperation, ProductionBrief, ProductionVisualSegment, VisualSceneAssetMapping } from "./types.ts";

export interface VisualGenerationRequest {
  productionBriefId: string;
  proposalId: string;
  sceneSequence: number;
  sceneDescription: string;
  targetPlatform?: string;
  aspectRatio?: string;
  visualPlan: ProductionVisualSegment[];
}

export interface VisualGenerationAsset {
  assetType: Extract<AssetType, "image">;
  bytes: Uint8Array;
  mimeType?: string;
  durationSeconds?: number;
}

export type VisualGenerationOutcome =
  | { status: "succeeded"; assets: VisualGenerationAsset[] }
  | { status: "failed"; reason: string }
  | { status: "unknown-result"; reason: string };

export interface VisualGenerationAdapter {
  isConfigured(): boolean;
  generate(request: VisualGenerationRequest): Promise<VisualGenerationOutcome>;
}

export interface VisualAssetWriter {
  write(operation: GenerationOperation, asset: VisualGenerationAsset, index: number): { localPath: string; reference: string };
}

export class LocalVisualAssetWriter implements VisualAssetWriter {
  private readonly root: string;

  constructor(root = path.resolve(process.cwd(), ".novara/runtime/assets")) {
    this.root = path.resolve(root);
  }

  write(operation: GenerationOperation, asset: VisualGenerationAsset, index: number): { localPath: string; reference: string } {
    mkdirSync(this.root, { recursive: true });
    const extension = "png";
    const localPath = path.join(this.root, `${operation.generationOperationId}-${index}.${extension}`);
    const temporaryPath = `${localPath}.tmp`;
    writeFileSync(temporaryPath, asset.bytes);
    renameSync(temporaryPath, localPath);
    return { localPath, reference: localPath };
  }
}

export type VisualProductionResult =
  | { status: "completed"; operation: GenerationOperation; assets: AssetMetadata[] }
  | { status: "failed" | "unknown-result"; operation?: GenerationOperation; reason: string };

function nowIso(): string {
  return new Date().toISOString();
}

export class VisualProductionService {
  private readonly adapter: VisualGenerationAdapter;
  private readonly writer: VisualAssetWriter;
  private readonly operations: GenerationOperationService;

  constructor(
    adapter: VisualGenerationAdapter,
    writer: VisualAssetWriter = new LocalVisualAssetWriter(),
    operations = new GenerationOperationService(),
  ) {
    this.adapter = adapter;
    this.writer = writer;
    this.operations = operations;
  }

  async execute(operationId: string, repository: GenerationOperationRepository, now = nowIso()): Promise<VisualProductionResult> {
    const current = repository.getGenerationOperation(operationId);
    if (!current) return { status: "failed", reason: "Visual generation operation was not found." };
    if (current.operationType !== "visual") return { status: "failed", operation: current, reason: "Generation operation is not a visual operation." };
    if (current.status !== "queued") return { status: "failed", operation: current, reason: `Visual generation operation is ${current.status} and cannot be executed.` };

    const brief = repository.getProductionBrief(current.productionBriefId);
    if (!brief || brief.proposalId !== current.proposalId || brief.agentId !== "A-014") {
      return { status: "failed", operation: current, reason: "Referenced Production Brief is missing or does not belong to A-014." };
    }
    if (current.sceneSequence === undefined) return { status: "failed", operation: current, reason: "Visual generation operation has no scene sequence." };
    const scene = brief?.visualPlan.find((candidate) => candidate.sequence === current.sceneSequence && candidate.description.trim());
    if (brief.productionReadiness !== "ready" || !scene) {
      return { status: "failed", operation: current, reason: "Production Brief is not ready and does not contain a visual plan." };
    }
    if (!this.adapter.isConfigured()) {
      return { status: "failed", operation: current, reason: "Visual generation provider configuration is missing." };
    }

    const claimed = this.operations.claim(operationId, repository, now);
    if (claimed.status !== "updated") return { status: "failed", reason: claimed.reason };

    let outcome: VisualGenerationOutcome;
    try {
      outcome = await this.adapter.generate({
        productionBriefId: brief.productionBriefId,
        proposalId: brief.proposalId,
        sceneSequence: current.sceneSequence,
        sceneDescription: scene.description,
        targetPlatform: brief.targetPlatform,
        aspectRatio: brief.aspectRatio,
        visualPlan: brief.visualPlan,
      });
    } catch {
      outcome = { status: "unknown-result", reason: "Visual provider execution raised an ambiguous error; the result is unknown." };
    }
    if (outcome.status === "failed") {
      const failed = this.operations.fail(operationId, outcome.reason, repository, nowIso());
      return failed.status === "updated" ? { status: "failed", operation: failed.operation, reason: outcome.reason } : { status: "failed", reason: outcome.reason };
    }
    if (outcome.status === "unknown-result") {
      const unknown = this.operations.markUnknown(operationId, outcome.reason, repository, nowIso());
      return unknown.status === "updated" ? { status: "unknown-result", operation: unknown.operation, reason: outcome.reason } : { status: "unknown-result", reason: outcome.reason };
    }
    if (outcome.assets.length === 0) {
      const failed = this.operations.fail(operationId, "Visual provider returned no assets.", repository, nowIso());
      return failed.status === "updated" ? { status: "failed", operation: failed.operation, reason: "Visual provider returned no assets." } : { status: "failed", reason: "Visual provider returned no assets." };
    }

    const metadata: AssetMetadata[] = [];
    try {
      for (const [index, asset] of outcome.assets.entries()) {
        if (asset.bytes.byteLength === 0) throw new Error("Visual provider returned an empty asset.");
        const written = this.writer.write(claimed.operation, asset, index);
        metadata.push({
          assetId: `asset-${operationId}-${index}`,
          generationOperationId: operationId,
          productionBriefId: current.productionBriefId,
          proposalId: current.proposalId,
          assetType: asset.assetType,
          status: "available",
          localPath: written.localPath,
          reference: written.reference,
          ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
          ...(typeof asset.durationSeconds === "number" ? { durationSeconds: asset.durationSeconds } : {}),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    } catch {
      const unknown = this.operations.markUnknown(operationId, "Visual provider returned assets, but local asset persistence failed; the external result is unknown.", repository, nowIso());
      return unknown.status === "updated" ? { status: "unknown-result", operation: unknown.operation, reason: unknown.reason } : { status: "unknown-result", reason: unknown.reason };
    }
    const mapping: VisualSceneAssetMapping = {
      mappingId: `scene-asset-${operationId}`,
      productionBriefId: current.productionBriefId,
      proposalId: current.proposalId,
      generationOperationId: operationId,
      sceneSequence: current.sceneSequence,
      assetId: metadata[0].assetId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const completed = this.operations.complete(operationId, metadata, repository, nowIso(), [mapping]);
    return completed.status === "updated"
      ? { status: "completed", operation: completed.operation, assets: metadata }
      : { status: "unknown-result", reason: "Visual assets were persisted but operation completion could not be recorded; the result is unknown." };
  }
}
