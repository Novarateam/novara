import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GenerationOperationService, type GenerationOperationRepository } from "./generation-operation-service.ts";
import { ElevenLabsNarrationAdapter } from "./elevenlabs-narration-adapter.ts";
import type { AssetMetadata, GenerationOperation } from "./types.ts";

export interface NarrationAssetWriter {
  write(operation: GenerationOperation, bytes: Uint8Array, mimeType: string): { localPath: string; reference: string };
}

export class LocalNarrationAssetWriter implements NarrationAssetWriter {
  private readonly root: string;

  constructor(root = path.resolve(process.cwd(), ".novara/runtime/assets")) {
    this.root = path.resolve(root);
  }

  write(operation: GenerationOperation, bytes: Uint8Array, mimeType: string): { localPath: string; reference: string } {
    mkdirSync(this.root, { recursive: true });
    const localPath = path.join(this.root, `${operation.generationOperationId}.mp3`);
    const temporaryPath = `${localPath}.tmp`;
    writeFileSync(temporaryPath, bytes);
    renameSync(temporaryPath, localPath);
    return { localPath, reference: localPath };
  }
}

export type NarrationExecutionResult =
  | { status: "completed"; operation: GenerationOperation; asset: AssetMetadata }
  | { status: "failed" | "unknown-result"; operation?: GenerationOperation; reason: string };

function nowIso(): string {
  return new Date().toISOString();
}

export class ElevenLabsNarrationService {
  private readonly adapter: ElevenLabsNarrationAdapter;
  private readonly writer: NarrationAssetWriter;
  private readonly operations: GenerationOperationService;

  constructor(
    adapter = new ElevenLabsNarrationAdapter(),
    writer = new LocalNarrationAssetWriter(),
    operations = new GenerationOperationService(),
  ) {
    this.adapter = adapter;
    this.writer = writer;
    this.operations = operations;
  }

  async execute(
    operationId: string,
    repository: GenerationOperationRepository,
    now = nowIso(),
  ): Promise<NarrationExecutionResult> {
    const current = repository.getGenerationOperation(operationId);
    if (!current) return { status: "failed", reason: "Generation operation was not found." };
    if (current.operationType !== "narration") return { status: "failed", reason: "Generation operation is not a narration operation." };
    if (current.status !== "queued") return { status: "failed", operation: current, reason: `Generation operation is ${current.status} and cannot be executed.` };

    const brief = repository.getProductionBrief(current.productionBriefId);
    if (!brief || brief.proposalId !== current.proposalId || brief.agentId !== "A-014") {
      return { status: "failed", operation: current, reason: "Referenced Production Brief is missing or does not belong to A-014." };
    }
    if (brief.productionReadiness !== "ready" || !brief.narrationScript?.trim()) {
      return { status: "failed", operation: current, reason: "Production Brief is not ready and does not contain valid narration text." };
    }
    if (!this.adapter.isConfigured()) {
      return { status: "failed", operation: current, reason: "ElevenLabs narration configuration is missing." };
    }

    const claimed = this.operations.claim(operationId, repository, now);
    if (claimed.status !== "updated") return { status: "failed", reason: claimed.reason };

    const outcome = await this.adapter.generate(brief.narrationScript);
    if (outcome.status === "failed") {
      const failed = this.operations.fail(operationId, outcome.reason, repository, nowIso());
      return failed.status === "updated" ? { status: "failed", operation: failed.operation, reason: outcome.reason } : { status: "failed", reason: outcome.reason };
    }
    if (outcome.status === "unknown-result") {
      const unknown = this.operations.markUnknown(operationId, outcome.reason, repository, nowIso());
      return unknown.status === "updated" ? { status: "unknown-result", operation: unknown.operation, reason: outcome.reason } : { status: "unknown-result", reason: outcome.reason };
    }

    let written: { localPath: string; reference: string };
    try {
      written = this.writer.write(claimed.operation, outcome.bytes, outcome.mimeType);
    } catch {
      const unknown = this.operations.markUnknown(operationId, "ElevenLabs returned audio, but local audio persistence failed; the external result is unknown.", repository, nowIso());
      return unknown.status === "updated" ? { status: "unknown-result", operation: unknown.operation, reason: unknown.reason } : { status: "unknown-result", reason: unknown.reason };
    }

    const asset: AssetMetadata = {
      assetId: `asset-${operationId}`,
      generationOperationId: claimed.operation.generationOperationId,
      productionBriefId: claimed.operation.productionBriefId,
      proposalId: claimed.operation.proposalId,
      assetType: "audio",
      status: "available",
      localPath: written.localPath,
      reference: written.reference,
      mimeType: outcome.mimeType,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    const completed = this.operations.complete(operationId, [asset], repository, nowIso());
    return completed.status === "updated"
      ? { status: "completed", operation: completed.operation, asset }
      : { status: "unknown-result", reason: "Audio was persisted but the generation completion could not be durably recorded; the result is unknown." };
  }
}
