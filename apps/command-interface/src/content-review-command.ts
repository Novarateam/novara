import {
  ContentReviewDecisionService,
  ContentReviewReadService,
  type ContentReviewReadStore,
  type ContentReviewDecisionStore,
} from "../../../core/agent-runtime/src/content-review-service.ts";
import { FileRuntimeStore, RuntimeRepository, createStableId } from "../../../core/agent-runtime/src/persistence.ts";
import type { ContentReviewDecisionResult } from "../../../core/agent-runtime/src/types.ts";
import {
  LocalContentReviewAccessService,
  loadLocalContentReviewAccessRules,
  type ContentReviewOperation,
} from "./content-review-access-service.ts";

const CONTENT_AGENT_ID = "A-014";

export type ContentReviewReadCommand = {
  operation: "listProposals" | "getProposal";
  proposalId?: string;
};

export type ContentReviewReadResponse =
  | { status: "ok"; operation: ContentReviewReadCommand["operation"]; data: unknown }
  | { status: "invalid-request"; reason: string };

function defaultReadStore(): ContentReviewReadStore {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    listMemory: () => repository.getSnapshot().memory,
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
  };
}

/** Pure read path: never creates tasks, calls the AI provider, or mutates review state. */
export function handleContentReviewReadCommand(
  command: Partial<ContentReviewReadCommand>,
  store: ContentReviewReadStore = defaultReadStore(),
): ContentReviewReadResponse {
  const operation = command.operation;
  if (operation !== "listProposals" && operation !== "getProposal") {
    return { status: "invalid-request", reason: "Unsupported content review read operation." };
  }

  const service = new ContentReviewReadService(store);
  if (operation === "listProposals") {
    return { status: "ok", operation, data: service.listProposals() };
  }

  const proposalId = command.proposalId?.trim();
  if (!proposalId) {
    return { status: "invalid-request", reason: "proposalId is required." };
  }
  const proposal = service.getProposal(proposalId);
  return proposal
    ? { status: "ok", operation, data: proposal }
    : { status: "invalid-request", reason: "Content proposal was not found." };
}

export type ContentReviewDecisionCommand = {
  operation: ContentReviewOperation;
  proposalId?: string;
  reason?: string;
};

export type ContentReviewDecisionCommandResponse =
  | { status: "ok"; operation: ContentReviewOperation; result: ContentReviewDecisionResult }
  | { status: "invalid-request"; reason: string };

export interface ContentReviewDecisionWorkflow extends ContentReviewDecisionStore {
  createContentReviewDecision: RuntimeRepository["createContentReviewDecision"];
  appendAuditEvent: RuntimeRepository["appendAuditEvent"];
}

function defaultWorkflow(): ContentReviewDecisionWorkflow {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
    createContentReviewDecision: (record) => repository.createContentReviewDecision(record),
    appendAuditEvent: (event) => repository.appendAuditEvent(event),
  };
}

const operationToDecision = {
  approveProposal: "approved",
  rejectProposal: "rejected",
} as const;

/** The only path that may change content review state. Requires local access authorization. */
export function handleContentReviewDecisionCommand(
  command: Partial<ContentReviewDecisionCommand>,
  credential: string | undefined,
  workflow: ContentReviewDecisionWorkflow = defaultWorkflow(),
  access = new LocalContentReviewAccessService(loadLocalContentReviewAccessRules()),
): ContentReviewDecisionCommandResponse {
  const operation = command.operation;
  const accessResult = access.authorize(operation, credential);
  if (accessResult.status !== "authorized") {
    workflow.appendAuditEvent({
      actorId: accessResult.status === "authorization-rejected" ? accessResult.identity : "unauthenticated",
      type: accessResult.status === "authentication-rejected" ? "content_review.authentication_rejected" : "content_review.authorization_rejected",
      message: "Rejected content review access.",
      payload: { operation, reason: accessResult.reason },
    });
    return { status: "invalid-request", reason: accessResult.reason };
  }

  if (operation !== "approveProposal" && operation !== "rejectProposal") {
    return { status: "invalid-request", reason: "Unsupported content review operation." };
  }

  const proposalId = command.proposalId?.trim();
  if (!proposalId) {
    return { status: "invalid-request", reason: "proposalId is required." };
  }

  const service = new ContentReviewDecisionService(workflow);
  const result = service.record({
    decisionId: createStableId("content-review"),
    proposalId,
    agentId: CONTENT_AGENT_ID,
    reviewerId: accessResult.identity,
    decision: operationToDecision[operation],
    reason: command.reason,
  });

  if (result.status === "created") {
    workflow.createContentReviewDecision(result.record);
    workflow.appendAuditEvent({
      actorId: result.record.reviewerId,
      type: "content_review.decision_recorded",
      message: "Recorded content review decision.",
      payload: {
        decisionId: result.record.decisionId,
        proposalId: result.record.proposalId,
        agentId: result.record.agentId,
        reviewerId: result.record.reviewerId,
        decision: result.record.decision,
        recordedAt: result.record.recordedAt,
      },
    });
  } else {
    workflow.appendAuditEvent({
      actorId: accessResult.identity,
      type: "content_review.decision_rejected",
      message: "Rejected content review decision.",
      payload: { proposalId, operation, reason: result.reason },
    });
  }

  return { status: "ok", operation, result };
}
