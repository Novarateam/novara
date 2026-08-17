import assert from "node:assert/strict";
import { handlePromotionCommand, type PromotionWorkflow } from "./promotion-command.ts";
import { LocalPromotionAccessService } from "./promotion-access-service.ts";
import type { AgentPromotionResult } from "../../../core/agent-runtime/src/types.ts";

const calls: Array<{ operation: string; input: unknown }> = [];
const workflow: PromotionWorkflow = {
  createPromotionProposal: (input) => { calls.push({ operation: "proposal", input }); return { status: "created", proposal: { ...input, promotionType: "observed-to-trusted", currentStatus: "observed", proposedStatus: "trusted", changedFields: ["status"], prohibitedFields: [], createdAt: "2026-01-01T00:00:00.000Z" } } as AgentPromotionResult; },
  confirmPromotion: (input) => { calls.push({ operation: "confirmation", input }); return { status: "confirmed", confirmation: { ...input, confirmation: "confirm-promotion", confirmedAt: "2026-01-01T00:00:00.000Z" } } as AgentPromotionResult; },
  applyPromotion: (input) => { calls.push({ operation: "apply", input }); return { status: "applied", promotion: { ...input, agentId: "A-012", trustReportId: "trust", governanceDecisionId: "governance", previousStatus: "observed", newStatus: "trusted", reviewerId: "guido", appliedAt: "2026-01-01T00:00:00.000Z" } } as AgentPromotionResult; },
  recordAccessAudit: () => undefined,
};
const access = new LocalPromotionAccessService([
  { identity: "proposer", credential: "proposal-key", operations: ["createPromotionProposal"] },
  { identity: "confirmer", credential: "confirm-key", operations: ["confirmPromotion"] },
  { identity: "applier", credential: "apply-key", operations: ["applyPromotion"] },
]);

const proposal = handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "p", agentId: "A-012", trustReportId: "trust", governanceDecisionId: "governance", promotionType: "observed-to-trusted", authorityLevel: "delegate" } as never, "proposal-key", workflow, access);
assert.equal(proposal.status, "ok");
assert.equal(calls[0].operation, "proposal");
assert.deepEqual(calls[0].input, { proposalId: "p", agentId: "A-012", trustReportId: "trust", governanceDecisionId: "governance", promotionType: "observed-to-trusted" }, "extra agent fields must not reach the workflow");
assert.equal(handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "", agentId: "A-012", trustReportId: "trust", governanceDecisionId: "governance", promotionType: "observed-to-trusted" }, "proposal-key", workflow, access).status, "invalid-request");
assert.equal(handlePromotionCommand({ operation: "unknown" as never }, "proposal-key", workflow, access).status, "invalid-request");
assert.equal(handlePromotionCommand({ operation: "applyPromotion", promotionId: "m", proposalId: "p", confirmationId: "c" }, "proposal-key", workflow, access).status, "invalid-request", "authorization must be operation-specific");
assert.equal(handlePromotionCommand({ operation: "createPromotionProposal", proposalId: "p", agentId: "A-012", trustReportId: "trust", governanceDecisionId: "governance", promotionType: "observed-to-trusted" }, undefined, workflow, access).status, "invalid-request", "missing credential must fail closed");
const confirmation = handlePromotionCommand({ operation: "confirmPromotion", confirmationId: "c", proposalId: "p", reviewerId: "impersonated", confirmation: "confirm-promotion" }, "confirm-key", workflow, access);
assert.equal(confirmation.status, "ok");
assert.deepEqual(calls[1].input, { confirmationId: "c", proposalId: "p", reviewerId: "confirmer", confirmation: "confirm-promotion" }, "authenticated identity must override body reviewerId");
const applied = handlePromotionCommand({ operation: "applyPromotion", promotionId: "m", proposalId: "p", confirmationId: "c" }, "apply-key", workflow, access);
assert.equal(applied.status, "ok");
assert.equal(calls.length, 3);
console.log("Promotion command tests passed.");