import { readFileSync } from "node:fs";
import path from "node:path";
import { GenerationOperationService, type GenerationOperationRepository } from "./generation-operation-service.ts";
import { ElevenLabsForcedAlignmentAdapter } from "./elevenlabs-forced-alignment-adapter.ts";
import type { GenerationOperation, NarrationAlignment } from "./types.ts";

export type NarrationAlignmentExecutionResult =
  | { status: "completed"; operation: GenerationOperation; alignment: NarrationAlignment }
  | { status: "failed" | "unknown-result"; operation?: GenerationOperation; reason: string };

function nowIso(): string { return new Date().toISOString(); }

export class NarrationAlignmentService {
  private readonly adapter: ElevenLabsForcedAlignmentAdapter;
  private readonly operations: GenerationOperationService;

  constructor(
    adapter = new ElevenLabsForcedAlignmentAdapter(),
    operations = new GenerationOperationService(),
  ) {
    this.adapter = adapter;
    this.operations = operations;
  }

  async execute(operationId: string, repository: GenerationOperationRepository, now = nowIso()): Promise<NarrationAlignmentExecutionResult> {
    const current = repository.getGenerationOperation(operationId);
    if (!current) return { status: "failed", reason: "Generation operation was not found." };
    if (current.operationType !== "alignment") return { status: "failed", operation: current, reason: "Generation operation is not an alignment operation." };
    if (current.status !== "queued") return { status: "failed", operation: current, reason: `Generation operation is ${current.status} and cannot be executed.` };
    const brief = repository.getProductionBrief(current.productionBriefId);
    if (!brief || brief.proposalId !== current.proposalId || brief.agentId !== "A-014" || brief.productionReadiness !== "ready" || !brief.narrationScript?.trim()) {
      return { status: "failed", operation: current, reason: "Referenced ready Production Brief and exact narrationScript are required." };
    }
    const narrationOperation = repository.getGenerationOperationByBrief(current.productionBriefId, "narration");
    if (!narrationOperation || narrationOperation.status !== "completed" || narrationOperation.resultAssetIds.length !== 1) {
      return { status: "failed", operation: current, reason: "Exactly one completed narration operation is required before alignment." };
    }
    const narrationAsset = repository.getAsset(narrationOperation.resultAssetIds[0]);
    if (!narrationAsset?.localPath || narrationAsset.assetType !== "audio") return { status: "failed", operation: current, reason: "Completed narration audio must be locally readable." };
    if (!this.adapter.isConfigured()) return { status: "failed", operation: current, reason: "ElevenLabs forced alignment configuration is missing." };

    let audio: Uint8Array;
    try { audio = new Uint8Array(readFileSync(path.resolve(narrationAsset.localPath))); } catch { return { status: "failed", operation: current, reason: "Completed narration audio could not be read locally." }; }
    const claimed = this.operations.claim(operationId, repository, now);
    if (claimed.status !== "updated") return { status: "failed", reason: claimed.reason };
    const outcome = await this.adapter.align(audio, path.basename(narrationAsset.localPath), brief.narrationScript);
    if (outcome.status === "failed") {
      const failed = this.operations.fail(operationId, outcome.reason, repository, nowIso());
      return { status: "failed", operation: failed.status === "updated" ? failed.operation : undefined, reason: outcome.reason };
    }
    if (outcome.status === "unknown-result") {
      const unknown = this.operations.markUnknown(operationId, outcome.reason, repository, nowIso());
      return { status: "unknown-result", operation: unknown.status === "updated" ? unknown.operation : undefined, reason: outcome.reason };
    }
    const timestamp = nowIso();
    const alignment: NarrationAlignment = {
      alignmentId: `alignment-${operationId}`,
      generationOperationId: operationId,
      productionBriefId: current.productionBriefId,
      proposalId: current.proposalId,
      narrationAssetId: narrationAsset.assetId,
      narrationText: brief.narrationScript,
      source: "elevenlabs-forced-alignment",
      characters: outcome.alignment.characters,
      words: outcome.alignment.words,
      loss: outcome.alignment.loss,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const completed = this.operations.complete(operationId, [], repository, timestamp, [], alignment);
    return completed.status === "updated"
      ? { status: "completed", operation: completed.operation, alignment }
      : { status: "unknown-result", reason: "ElevenLabs alignment was returned but could not be durably recorded; the result is unknown." };
  }
}