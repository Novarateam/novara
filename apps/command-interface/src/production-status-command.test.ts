import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GenerationOperationService } from "../../../core/agent-runtime/src/generation-operation-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import type { AssetMetadata, CompanyMemoryEntry, ContentReviewDecisionRecord, NarrationAlignment, ProductionBrief } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService } from "./production-execution-access-service.ts";
import { deriveProductionControlSummary, handleProductionStatusCommand } from "./production-status-command.ts";

const proposal: CompanyMemoryEntry = { id: "proposal-production-status-A-014", type: "evidence", source: "A-014/status-test", timestamp: "2026-08-13T00:00:00.000Z", confidence: 0.9, authority: "recommend", status: "proposed", content: { structuredResult: { platform: "instagram", humanReviewRequired: true } } };
const brief: ProductionBrief = { productionBriefId: "brief-production-status", proposalId: proposal.id, agentId: "A-014", productionPlanVersion: "1", targetPlatform: "instagram", contentScript: "Content", narrationScript: "Narration", visualPlan: [{ sequence: 1, description: "Scene", durationSeconds: 2 }], requiredMediaType: "short-form-video", aspectRatio: "9:16", targetDurationSeconds: 2, captionRequirements: { burnedIn: true, language: "en" }, productionReadiness: "ready", missingRequirements: [], createdAt: proposal.timestamp, updatedAt: proposal.timestamp };
const access = new LocalProductionExecutionAccessService([{ identity: "human", credential: "status-key", operations: ["readProductionStatus"] }]);

function complete(repository: RuntimeRepository, operationId: string, assets: AssetMetadata[] = [], alignment?: NarrationAlignment, mappings = []) {
  const service = new GenerationOperationService();
  assert.equal(service.claim(operationId, repository).status, "updated");
  assert.equal(service.complete(operationId, assets, repository, proposal.timestamp, mappings, alignment).status, "updated");
}

function asset(operationId: string, suffix: string, assetType: AssetMetadata["assetType"], mimeType: string): AssetMetadata {
  return { assetId: `asset-${suffix}`, generationOperationId: operationId, productionBriefId: brief.productionBriefId, proposalId: proposal.id, assetType, status: "available", localPath: `C:/status/${suffix}`, reference: `C:/status/${suffix}`, mimeType, createdAt: proposal.timestamp, updatedAt: proposal.timestamp, ...(assetType === "video" ? { durationSeconds: 2 } : {}) };
}

const root = mkdtempSync(path.join(tmpdir(), "novara-production-status-"));
const repository = new RuntimeRepository(new FileRuntimeStore(root));
repository.upsertMemory(proposal);
repository.createContentReviewDecision({ decisionId: "decision-production-status", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: proposal.timestamp } as ContentReviewDecisionRecord);
repository.upsertProductionBrief(brief);
assert.ok(repository.createProductionApproval({ approvalId: "approval-production-status", proposalId: proposal.id, productionBriefId: brief.productionBriefId, reviewerId: "human", decision: "approved-for-production", recordedAt: proposal.timestamp }));
const operations = new GenerationOperationService();

const visual = operations.createVisualOperation(brief, repository, 1); assert.equal(visual.status, "created");
const image = asset(visual.operation.generationOperationId, "image", "image", "image/png");
complete(repository, visual.operation.generationOperationId, [image], undefined, [{ mappingId: "mapping-status", productionBriefId: brief.productionBriefId, proposalId: proposal.id, generationOperationId: visual.operation.generationOperationId, sceneSequence: 1, assetId: image.assetId, createdAt: proposal.timestamp, updatedAt: proposal.timestamp }]);
const narration = operations.createNarrationOperation(brief, repository); assert.equal(narration.status, "created");
const audio = asset(narration.operation.generationOperationId, "audio", "audio", "audio/mpeg"); complete(repository, narration.operation.generationOperationId, [audio]);
const alignmentOperation = operations.createAlignmentOperation(brief, repository); assert.equal(alignmentOperation.status, "created");
const alignment: NarrationAlignment = { alignmentId: "alignment-status", generationOperationId: alignmentOperation.operation.generationOperationId, productionBriefId: brief.productionBriefId, proposalId: proposal.id, narrationAssetId: audio.assetId, narrationText: brief.narrationScript!, source: "elevenlabs-forced-alignment", characters: [{ text: "N", start: 0, end: 0.1 }], words: [{ text: "Narration", start: 0, end: 1, loss: 0.01 }], loss: 0.01, createdAt: proposal.timestamp, updatedAt: proposal.timestamp }; complete(repository, alignmentOperation.operation.generationOperationId, [], alignment);
const subtitles = operations.createSubtitleOperation(brief, repository); assert.equal(subtitles.status, "created"); complete(repository, subtitles.operation.generationOperationId, [asset(subtitles.operation.generationOperationId, "subtitles.srt", "subtitle", "application/x-subrip"), asset(subtitles.operation.generationOperationId, "subtitles.vtt", "subtitle", "text/vtt")]);
const video = operations.createVideoOperation(brief, repository); assert.equal(video.status, "created"); complete(repository, video.operation.generationOperationId, [asset(video.operation.generationOperationId, "video.mp4", "video", "video/mp4")]);

const statePath = path.join(root, "state.json"); const auditPath = path.join(root, "audit.log");
const stateBefore = readFileSync(statePath, "utf8"); const auditBefore = existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "";
const response = handleProductionStatusCommand({ operation: "readProductionStatus", proposalId: proposal.id }, "status-key", repository, access);
assert.equal(response.status, "ok");
if (response.status === "ok") {
  assert.equal(response.data.contentReviewDecision?.decision, "approved");
  assert.equal(response.data.productionBrief?.productionBriefId, brief.productionBriefId);
  assert.equal(response.data.productionApproval?.decision, "approved-for-production");
  assert.equal(response.data.stages.visuals.operations[0].generationOperationId, visual.operation.generationOperationId);
  assert.equal(response.data.stages.visuals.sceneMappings[0].assetId, image.assetId);
  assert.equal(response.data.stages.narration.assets[0].assetId, audio.assetId);
  assert.equal(response.data.stages.alignment.record?.alignmentId, alignment.alignmentId);
  assert.deepEqual(response.data.stages.subtitles.assets.map((entry) => entry.mimeType).sort(), ["application/x-subrip", "text/vtt"]);
  assert.equal(response.data.stages.video.assets[0].mimeType, "video/mp4");
  assert.equal(response.data.summary.overallStatus, "completed");
  assert.equal(response.data.summary.blockingStage, null);
  const { summary: _summary, ...raw } = response.data;
  const readyToProduce = structuredClone(raw);
  readyToProduce.stages.visuals = { operations: [], sceneMappings: [], assets: [] };
  readyToProduce.stages.narration = { operation: undefined, assets: [] };
  readyToProduce.stages.alignment = { operation: undefined, record: undefined };
  readyToProduce.stages.subtitles = { operation: undefined, assets: [] };
  readyToProduce.stages.video = { operation: undefined, assets: [] };
  assert.equal(deriveProductionControlSummary(readyToProduce).overallStatus, "ready-to-produce");
  const awaitingApproval = structuredClone(raw);
  awaitingApproval.productionApproval = undefined;
  const awaitingApprovalSummary = deriveProductionControlSummary(awaitingApproval);
  assert.equal(awaitingApprovalSummary.overallStatus, "awaiting-production-approval");
  assert.equal(awaitingApprovalSummary.blockingStage, "production-brief");
  const rejected = structuredClone(raw);
  rejected.productionApproval = { ...rejected.productionApproval!, decision: "rejected-for-production" };
  const rejectedSummary = deriveProductionControlSummary(rejected);
  assert.equal(rejectedSummary.overallStatus, "rejected-for-production");
  assert.equal(rejectedSummary.blockingStage, "production-brief");
  const inProgress = structuredClone(raw);
  inProgress.stages.visuals.operations[0].status = "generating";
  const inProgressSummary = deriveProductionControlSummary(inProgress);
  assert.equal(inProgressSummary.overallStatus, "in-progress");
  assert.equal(inProgressSummary.blockingStage, "visual");
  const failed = structuredClone(raw);
  failed.stages.narration.operation!.status = "failed";
  failed.stages.narration.operation!.failureReason = "Provider rejected narration.";
  const failedSummary = deriveProductionControlSummary(failed);
  assert.equal(failedSummary.overallStatus, "failed");
  assert.equal(failedSummary.blockingStage, "narration");
  const unknown = structuredClone(raw);
  unknown.stages.alignment.operation!.status = "unknown-result";
  unknown.stages.alignment.operation!.unknownReason = "Alignment connection dropped.";
  const unknownSummary = deriveProductionControlSummary(unknown);
  assert.equal(unknownSummary.overallStatus, "unknown-result");
  assert.equal(unknownSummary.blockingStage, "alignment");
  const blocked = structuredClone(raw);
  blocked.stages.subtitles.assets = blocked.stages.subtitles.assets.filter((entry) => entry.mimeType !== "text/vtt");
  const blockedSummary = deriveProductionControlSummary(blocked);
  assert.equal(blockedSummary.overallStatus, "blocked");
  assert.equal(blockedSummary.blockingStage, "subtitle");
  const notReady = structuredClone(raw);
  notReady.productionBrief = { ...notReady.productionBrief!, productionReadiness: "not-ready", missingRequirements: ["narrationScript"] };
  const notReadySummary = deriveProductionControlSummary(notReady);
  assert.equal(notReadySummary.overallStatus, "not-ready");
  assert.equal(notReadySummary.blockingStage, "production-brief");
}
assert.equal(readFileSync(statePath, "utf8"), stateBefore, "status reads must not mutate persisted state");
assert.equal(existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "", auditBefore, "status reads must not append audit events");
assert.equal(handleProductionStatusCommand({ operation: "readProductionStatus", proposalId: proposal.id }, undefined, repository, access).status, "invalid-request");
assert.equal(handleProductionStatusCommand({ operation: "readProductionStatus", proposalId: "missing" }, "status-key", repository, access).status, "not-found");
assert.equal(handleProductionStatusCommand({ operation: "readProductionStatus" }, "status-key", repository, access).status, "invalid-request");

// An approval remains historical when a newer immutable brief is current; status must not reuse it.
{
  const revisionRoot = mkdtempSync(path.join(tmpdir(), "novara-production-status-revision-"));
  const revisionRepository = new RuntimeRepository(new FileRuntimeStore(revisionRoot));
  const firstBrief: ProductionBrief = { ...brief, productionBriefId: "brief-production-status-r1", revision: 1 };
  const secondBrief: ProductionBrief = { ...firstBrief, productionBriefId: "brief-production-status-r2", revision: 2, narrationScript: "Changed narration", updatedAt: "2026-08-14T00:00:00.000Z" };
  revisionRepository.upsertMemory(proposal);
  revisionRepository.createContentReviewDecision({ decisionId: "decision-production-status-revision", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: proposal.timestamp } as ContentReviewDecisionRecord);
  assert.ok(revisionRepository.createProductionBrief(firstBrief));
  assert.ok(revisionRepository.createProductionApproval({ approvalId: "approval-production-status-r1", proposalId: proposal.id, productionBriefId: firstBrief.productionBriefId, reviewerId: "human", decision: "approved-for-production", recordedAt: proposal.timestamp }));
  assert.ok(revisionRepository.createProductionBrief(secondBrief));
  const revisionResponse = handleProductionStatusCommand({ operation: "readProductionStatus", proposalId: proposal.id }, "status-key", revisionRepository, access);
  assert.equal(revisionResponse.status, "ok");
  if (revisionResponse.status === "ok") {
    assert.equal(revisionResponse.data.productionBrief?.productionBriefId, secondBrief.productionBriefId);
    assert.equal(revisionResponse.data.productionApproval, undefined);
    assert.equal(revisionResponse.data.summary.overallStatus, "awaiting-production-approval");
  }
  assert.equal(revisionRepository.getProductionApprovalByBrief(firstBrief.productionBriefId)?.decision, "approved-for-production", "the historical approval must not be deleted or overwritten");
}
console.log("Production status command tests passed.");