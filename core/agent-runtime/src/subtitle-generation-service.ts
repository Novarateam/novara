import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GenerationOperationService, type GenerationOperationRepository } from "./generation-operation-service.ts";
import type { AssetMetadata, GenerationOperation, NarrationAlignment, NarrationAlignmentWord } from "./types.ts";

const SRT_MIME = "application/x-subrip";
const VTT_MIME = "text/vtt";

export interface SubtitleGenerationRepository extends GenerationOperationRepository {
  getNarrationAlignmentByOperation(generationOperationId: string): NarrationAlignment | undefined;
}

export interface SubtitleAssetWriter {
  write(operation: GenerationOperation, srt: string, vtt: string): { srtPath: string; vttPath: string };
}

export class LocalSubtitleAssetWriter implements SubtitleAssetWriter {
  private readonly root: string;

  constructor(root = path.resolve(process.cwd(), ".novara/runtime/assets")) {
    this.root = root;
  }

  write(operation: GenerationOperation, srt: string, vtt: string): { srtPath: string; vttPath: string } {
    mkdirSync(this.root, { recursive: true });
    const srtPath = path.join(this.root, `${operation.generationOperationId}.srt`);
    const vttPath = path.join(this.root, `${operation.generationOperationId}.vtt`);
    const srtTemporaryPath = `${srtPath}.tmp`;
    const vttTemporaryPath = `${vttPath}.tmp`;
    writeFileSync(srtTemporaryPath, srt, "utf8");
    try {
      writeFileSync(vttTemporaryPath, vtt, "utf8");
      renameSync(srtTemporaryPath, srtPath);
      try {
        renameSync(vttTemporaryPath, vttPath);
      } catch (error) {
        if (existsSync(srtPath)) unlinkSync(srtPath);
        throw error;
      }
    } finally {
      if (existsSync(srtTemporaryPath)) unlinkSync(srtTemporaryPath);
      if (existsSync(vttTemporaryPath)) unlinkSync(vttTemporaryPath);
    }
    return { srtPath, vttPath };
  }
}

export interface SubtitleCue { text: string; start: number; end: number; }

function isValidWord(word: NarrationAlignmentWord): boolean {
  return typeof word.text === "string" && word.text.length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end) && word.start >= 0 && word.end >= word.start && Number.isFinite(word.loss);
}

export function deriveSubtitleCues(alignment: NarrationAlignment): SubtitleCue[] | null {
  if (!alignment.narrationText || !Array.isArray(alignment.words) || alignment.words.length === 0) return null;
  const words = alignment.words;
  if (words.some((word, index) => !isValidWord(word) || (index > 0 && word.start < words[index - 1].end))) return null;
  const cues: SubtitleCue[] = [];
  let group: NarrationAlignmentWord[] = [];
  for (const word of words) {
    group.push(word);
    if (/[.!?]["')\]]*$/.test(word.text)) {
      cues.push({ text: group.map((item) => item.text).join(" "), start: group[0].start, end: group[group.length - 1].end });
      group = [];
    }
  }
  if (group.length) cues.push({ text: group.map((item) => item.text).join(" "), start: group[0].start, end: group[group.length - 1].end });
  return cues.every((cue, index) => cue.text.length > 0 && cue.end >= cue.start && (index === 0 || cue.start >= cues[index - 1].end)) ? cues : null;
}

function formatTimestamp(seconds: number, separator: "," | "."): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secondsPart = Math.floor((milliseconds % 60_000) / 1000);
  const millisecondsPart = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}${separator}${String(millisecondsPart).padStart(3, "0")}`;
}

export function renderSrt(cues: SubtitleCue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${formatTimestamp(cue.start, ",")} --> ${formatTimestamp(cue.end, ",")}\n${cue.text}`).join("\n\n")}\n`;
}

export function renderVtt(cues: SubtitleCue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${formatTimestamp(cue.start, ".")} --> ${formatTimestamp(cue.end, ".")}\n${cue.text}`).join("\n\n")}\n`;
}

export type SubtitleGenerationResult =
  | { status: "completed"; operation: GenerationOperation; assets: [AssetMetadata, AssetMetadata] }
  | { status: "failed" | "unknown-result"; operation?: GenerationOperation; reason: string };

export class SubtitleGenerationService {
  private readonly writer: SubtitleAssetWriter;
  private readonly operations: GenerationOperationService;

  constructor(writer: SubtitleAssetWriter = new LocalSubtitleAssetWriter(), operations = new GenerationOperationService()) {
    this.writer = writer;
    this.operations = operations;
  }

  execute(operationId: string, repository: SubtitleGenerationRepository, now = new Date().toISOString()): SubtitleGenerationResult {
    const operation = repository.getGenerationOperation(operationId);
    if (!operation) return { status: "failed", reason: "Subtitle generation operation was not found." };
    if (operation.operationType !== "subtitle") return { status: "failed", operation, reason: "Generation operation is not a subtitle operation." };
    if (operation.status !== "queued") return { status: "failed", operation, reason: `Subtitle generation operation is ${operation.status} and cannot be executed.` };
    const brief = repository.getProductionBrief(operation.productionBriefId);
    if (!brief || brief.agentId !== "A-014" || brief.proposalId !== operation.proposalId || brief.productionReadiness !== "ready" || !brief.narrationScript?.trim()) return { status: "failed", operation, reason: "Referenced ready A-014 Production Brief is missing or invalid." };
    const alignmentOperation = repository.getGenerationOperationByBrief(operation.productionBriefId, "alignment");
    const alignment = alignmentOperation ? repository.getNarrationAlignmentByOperation(alignmentOperation.generationOperationId) : undefined;
    if (!alignment || !alignmentOperation || alignmentOperation.status !== "completed" || alignment.productionBriefId !== operation.productionBriefId || alignment.proposalId !== operation.proposalId || alignment.narrationText !== brief.narrationScript) return { status: "failed", operation, reason: "A matching completed NarrationAlignment with the exact narration text is required." };
    const narrationOperation = repository.getGenerationOperationByBrief(operation.productionBriefId, "narration");
    if (!narrationOperation || narrationOperation.status !== "completed" || !narrationOperation.resultAssetIds.includes(alignment.narrationAssetId)) return { status: "failed", operation, reason: "A completed narration operation matching the alignment is required." };
    const narrationAsset = repository.getAsset(alignment.narrationAssetId);
    if (!narrationAsset || narrationAsset.assetType !== "audio" || narrationAsset.status !== "available" || narrationAsset.productionBriefId !== operation.productionBriefId || narrationAsset.proposalId !== operation.proposalId || !narrationAsset.localPath) return { status: "failed", operation, reason: "A matching completed narration audio asset is required." };
    const cues = deriveSubtitleCues(alignment);
    if (!cues) return { status: "failed", operation, reason: "NarrationAlignment word timings are malformed, overlapping, missing, or non-monotonic." };
    const claimed = this.operations.claim(operationId, repository, now);
    if (claimed.status !== "updated") return { status: "failed", reason: claimed.reason };
    let files: { srtPath: string; vttPath: string };
    try { files = this.writer.write(claimed.operation, renderSrt(cues), renderVtt(cues)); } catch {
      const unknown = this.operations.markUnknown(operationId, "Subtitle file persistence failed after the operation was claimed; the local result is unknown.", repository, new Date().toISOString());
      return { status: "unknown-result", operation: unknown.status === "updated" ? unknown.operation : undefined, reason: "Subtitle file persistence failed after the operation was claimed; the local result is unknown." };
    }
    const timestamp = new Date().toISOString();
    const assets: [AssetMetadata, AssetMetadata] = [
      { assetId: `asset-${operationId}-srt`, generationOperationId: operationId, productionBriefId: operation.productionBriefId, proposalId: operation.proposalId, assetType: "subtitle", status: "available", localPath: files.srtPath, reference: files.srtPath, mimeType: SRT_MIME, createdAt: timestamp, updatedAt: timestamp },
      { assetId: `asset-${operationId}-vtt`, generationOperationId: operationId, productionBriefId: operation.productionBriefId, proposalId: operation.proposalId, assetType: "subtitle", status: "available", localPath: files.vttPath, reference: files.vttPath, mimeType: VTT_MIME, createdAt: timestamp, updatedAt: timestamp },
    ];
    const completed = this.operations.complete(operationId, assets, repository, timestamp);
    return completed.status === "updated" ? { status: "completed", operation: completed.operation, assets } : { status: "unknown-result", reason: "Subtitle files were written but operation completion could not be durably persisted; the result is unknown." };
  }
}