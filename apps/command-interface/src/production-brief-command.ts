import { isContentProposalEntry } from "../../../core/agent-runtime/src/content-review-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { normalizeAndPersistProductionBrief, type ProductionBriefNormalizationResult } from "../../../core/agent-runtime/src/production-brief-service.ts";
import { LocalProductionExecutionAccessService, loadLocalProductionExecutionAccessRules } from "./production-execution-access-service.ts";

export type ProductionBriefCommand = { operation: "normalizeProductionBrief"; proposalId?: string };
export type ProductionBriefCommandResponse =
  | { status: "ok"; operation: "normalizeProductionBrief"; result: ProductionBriefNormalizationResult | { status: "rejected"; reason: string } }
  | { status: "invalid-request"; reason: string };

function defaultRepository(): RuntimeRepository {
  return new RuntimeRepository(new FileRuntimeStore());
}

/** Explicit human boundary: persists only the deterministic current Production Brief revision. */
export function handleProductionBriefCommand(
  command: Partial<ProductionBriefCommand>,
  credential: string | undefined,
  repository: RuntimeRepository = defaultRepository(),
  access = new LocalProductionExecutionAccessService(loadLocalProductionExecutionAccessRules()),
): ProductionBriefCommandResponse {
  const accessResult = access.authorize(command.operation, credential);
  if (accessResult.status !== "authorized") return { status: "invalid-request", reason: accessResult.reason };
  if (command.operation !== "normalizeProductionBrief") return { status: "invalid-request", reason: "Unsupported Production Brief operation." };
  const proposalId = command.proposalId?.trim();
  if (!proposalId) return { status: "invalid-request", reason: "proposalId is required." };

  const proposal = repository.getSnapshot().memory.find((entry) => entry.id === proposalId);
  if (!proposal || !isContentProposalEntry(proposal)) {
    return { status: "ok", operation: command.operation, result: { status: "rejected", reason: "A valid A-014 content proposal is required." } };
  }
  const review = repository.getContentReviewDecisionByProposal(proposalId);
  if (!review || review.agentId !== "A-014" || review.decision !== "approved") {
    return { status: "ok", operation: command.operation, result: { status: "rejected", reason: "An approved Content Review decision is required before creating a Production Brief." } };
  }

  const result = normalizeAndPersistProductionBrief(proposal, repository);
  return result
    ? { status: "ok", operation: command.operation, result }
    : { status: "ok", operation: command.operation, result: { status: "rejected", reason: "The proposal could not be normalized as an A-014 Production Brief." } };
}