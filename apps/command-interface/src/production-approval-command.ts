import { randomUUID } from "node:crypto";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import type { ProductionApprovalDecision, ProductionApprovalRecord } from "../../../core/agent-runtime/src/types.ts";
import { LocalProductionExecutionAccessService, loadLocalProductionExecutionAccessRules } from "./production-execution-access-service.ts";

export type ProductionApprovalCommand = { operation: "decideProductionApproval"; proposalId?: string; productionBriefId?: string; decision?: ProductionApprovalDecision; reason?: string };
export type ProductionApprovalCommandResponse =
  | { status: "ok"; operation: "decideProductionApproval"; result: { status: "created" | "existing" | "conflict" | "rejected"; record?: ProductionApprovalRecord; reason?: string } }
  | { status: "invalid-request"; reason: string };

function defaultRepository(): RuntimeRepository { return new RuntimeRepository(new FileRuntimeStore()); }

export function handleProductionApprovalCommand(
  command: Partial<ProductionApprovalCommand>,
  credential: string | undefined,
  repository: RuntimeRepository = defaultRepository(),
  access = new LocalProductionExecutionAccessService(loadLocalProductionExecutionAccessRules()),
): ProductionApprovalCommandResponse {
  const accessResult = access.authorize(command.operation, credential);
  if (accessResult.status !== "authorized") return { status: "invalid-request", reason: accessResult.reason };
  const proposalId = command.proposalId?.trim(); const productionBriefId = command.productionBriefId?.trim(); const decision = command.decision;
  if (!proposalId || !productionBriefId || (decision !== "approved-for-production" && decision !== "rejected-for-production")) return { status: "invalid-request", reason: "proposalId, productionBriefId, and a valid production decision are required." };
  const brief = repository.getProductionBrief(productionBriefId);
  const currentBrief = repository.getProductionBriefByProposal(proposalId);
  const review = repository.getContentReviewDecisionByProposal(proposalId);
  if (!brief || brief.proposalId !== proposalId || brief.agentId !== "A-014" || brief.productionReadiness !== "ready" || currentBrief?.productionBriefId !== brief.productionBriefId) return { status: "ok", operation: "decideProductionApproval", result: { status: "rejected", reason: "The current ready A-014 Production Brief is required." } };
  if (!review || review.agentId !== "A-014" || review.decision !== "approved") return { status: "ok", operation: "decideProductionApproval", result: { status: "rejected", reason: "An approved Content Review decision is required before production approval." } };
  const existing = repository.getProductionApprovalByBrief(productionBriefId);
  if (existing) return { status: "ok", operation: "decideProductionApproval", result: existing.decision === decision ? { status: "existing", record: existing } : { status: "conflict", record: existing, reason: `Production is already ${existing.decision}.` } };
  const record: ProductionApprovalRecord = { approvalId: `production-approval-${randomUUID()}`, proposalId, productionBriefId, reviewerId: accessResult.identity, decision, ...(command.reason?.trim() ? { reason: command.reason.trim() } : {}), recordedAt: new Date().toISOString() };
  const created = repository.createProductionApproval(record);
  if (created) return { status: "ok", operation: "decideProductionApproval", result: { status: "created", record: created } };
  const concurrent = repository.getProductionApprovalByBrief(productionBriefId);
  return { status: "ok", operation: "decideProductionApproval", result: concurrent?.decision === decision ? { status: "existing", record: concurrent } : { status: "conflict", record: concurrent, reason: "A conflicting production decision was recorded concurrently." } };
}