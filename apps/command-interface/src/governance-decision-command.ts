import { HumanGovernanceDecisionService } from "../../../core/agent-runtime/src/human-governance-decision-service.ts";
import { FileRuntimeStore, RuntimeRepository, createStableId } from "../../../core/agent-runtime/src/persistence.ts";
import type { HumanGovernanceDecisionResult, RecordHumanGovernanceDecisionRequest } from "../../../core/agent-runtime/src/types.ts";

export interface GovernanceDecisionStore {
  getTrustPerformanceReport(reportId: string): ReturnType<RuntimeRepository["getTrustPerformanceReport"]>;
  createHumanGovernanceDecision: RuntimeRepository["createHumanGovernanceDecision"];
  appendAuditEvent: RuntimeRepository["appendAuditEvent"];
}

export function createDefaultGovernanceDecisionStore(): GovernanceDecisionStore {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    getTrustPerformanceReport: (reportId) => repository.getTrustPerformanceReport(reportId),
    createHumanGovernanceDecision: (record) => repository.createHumanGovernanceDecision(record),
    appendAuditEvent: (event) => repository.appendAuditEvent(event),
  };
}

export function handleGovernanceDecisionCommand(request: Omit<RecordHumanGovernanceDecisionRequest, "decisionId"> & { decisionId?: string }, store: GovernanceDecisionStore = createDefaultGovernanceDecisionStore()): HumanGovernanceDecisionResult {
  const service = new HumanGovernanceDecisionService((reportId) => store.getTrustPerformanceReport(reportId));
  const result = service.record({ ...request, decisionId: request.decisionId?.trim() || createStableId("governance") });
  if (result.status === "created") {
    store.createHumanGovernanceDecision(result.record);
    store.appendAuditEvent({ actorId: result.record.reviewerId, type: "governance.decision_recorded", message: "Recorded immutable human governance decision.", payload: { decisionId: result.record.decisionId, agentId: result.record.agentId, trustReportId: result.record.trustReportId, reviewerId: result.record.reviewerId, decision: result.record.decision, recordedAt: result.record.recordedAt } });
  } else {
    store.appendAuditEvent({ actorId: request.reviewerId?.trim() || "human", type: "governance.decision_rejected", message: "Rejected human governance decision.", payload: { agentId: request.agentId, trustReportId: request.trustReportId, decision: request.decision, reason: result.reason } });
  }
  return result;
}