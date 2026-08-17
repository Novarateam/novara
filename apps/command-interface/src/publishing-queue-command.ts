import {
  PublishingQueueEnqueueService,
  PublishingQueueReadService,
  type PublishingQueueEnqueueStore,
  type PublishingQueueReadStore,
} from "../../../core/agent-runtime/src/publishing-queue-service.ts";
import { FileRuntimeStore, RuntimeRepository, createStableId } from "../../../core/agent-runtime/src/persistence.ts";
import type { PublishingQueueEnqueueResult } from "../../../core/agent-runtime/src/types.ts";
import {
  LocalPublishingQueueAccessService,
  loadLocalPublishingQueueAccessRules,
  type PublishingQueueOperation,
} from "./publishing-queue-access-service.ts";

const CONTENT_AGENT_ID = "A-014";

export type PublishingQueueReadCommand = {
  operation: "listEntries" | "getEntry";
  queueEntryId?: string;
};

export type PublishingQueueReadResponse =
  | { status: "ok"; operation: PublishingQueueReadCommand["operation"]; data: unknown }
  | { status: "invalid-request"; reason: string };

function defaultReadStore(): PublishingQueueReadStore {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    listPublishingQueueEntries: () => repository.listPublishingQueueEntries(),
    getPublishingQueueEntry: (queueEntryId) => repository.getPublishingQueueEntry(queueEntryId),
  };
}

/** Pure read path: never enqueues, executes A-014, or mutates queue state. */
export function handlePublishingQueueReadCommand(
  command: Partial<PublishingQueueReadCommand>,
  store: PublishingQueueReadStore = defaultReadStore(),
): PublishingQueueReadResponse {
  const operation = command.operation;
  if (operation !== "listEntries" && operation !== "getEntry") {
    return { status: "invalid-request", reason: "Unsupported publishing queue read operation." };
  }

  const service = new PublishingQueueReadService(store);
  if (operation === "listEntries") {
    return { status: "ok", operation, data: service.listEntries() };
  }

  const queueEntryId = command.queueEntryId?.trim();
  if (!queueEntryId) {
    return { status: "invalid-request", reason: "queueEntryId is required." };
  }
  const entry = service.getEntry(queueEntryId);
  return entry
    ? { status: "ok", operation, data: entry }
    : { status: "invalid-request", reason: "Publishing queue entry was not found." };
}

export type PublishingQueueEnqueueCommand = {
  operation: PublishingQueueOperation;
  proposalId?: string;
};

export type PublishingQueueEnqueueCommandResponse =
  | { status: "ok"; operation: PublishingQueueOperation; result: PublishingQueueEnqueueResult }
  | { status: "invalid-request"; reason: string };

export interface PublishingQueueEnqueueWorkflow extends PublishingQueueEnqueueStore {
  createPublishingQueueEntry: RuntimeRepository["createPublishingQueueEntry"];
  appendAuditEvent: RuntimeRepository["appendAuditEvent"];
}

function defaultWorkflow(): PublishingQueueEnqueueWorkflow {
  const repository = new RuntimeRepository(new FileRuntimeStore());
  return {
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
    getPublishingQueueEntryByProposal: (proposalId) => repository.getPublishingQueueEntryByProposal(proposalId),
    createPublishingQueueEntry: (entry) => repository.createPublishingQueueEntry(entry),
    appendAuditEvent: (event) => repository.appendAuditEvent(event),
  };
}

/** The only path that may create a publishing queue entry. Requires local access authorization. */
export function handlePublishingQueueEnqueueCommand(
  command: Partial<PublishingQueueEnqueueCommand>,
  credential: string | undefined,
  workflow: PublishingQueueEnqueueWorkflow = defaultWorkflow(),
  access = new LocalPublishingQueueAccessService(loadLocalPublishingQueueAccessRules()),
): PublishingQueueEnqueueCommandResponse {
  const operation = command.operation;
  const accessResult = access.authorize(operation, credential);
  if (accessResult.status !== "authorized") {
    workflow.appendAuditEvent({
      actorId: accessResult.status === "authorization-rejected" ? accessResult.identity : "unauthenticated",
      type: accessResult.status === "authentication-rejected" ? "publishing_queue.authentication_rejected" : "publishing_queue.authorization_rejected",
      message: "Rejected publishing queue access.",
      payload: { operation, reason: accessResult.reason },
    });
    return { status: "invalid-request", reason: accessResult.reason };
  }

  if (operation !== "enqueueProposal") {
    return { status: "invalid-request", reason: "Unsupported publishing queue operation." };
  }

  const proposalId = command.proposalId?.trim();
  if (!proposalId) {
    return { status: "invalid-request", reason: "proposalId is required." };
  }

  const service = new PublishingQueueEnqueueService(workflow);
  const result = service.enqueue({
    queueEntryId: createStableId("publishing-queue"),
    proposalId,
    agentId: CONTENT_AGENT_ID,
  });

  if (result.status === "created") {
    workflow.createPublishingQueueEntry(result.entry);
    workflow.appendAuditEvent({
      actorId: accessResult.identity,
      type: "publishing_queue.entry_created",
      message: "Created publishing queue entry.",
      payload: {
        queueEntryId: result.entry.queueEntryId,
        proposalId: result.entry.proposalId,
        agentId: result.entry.agentId,
        status: result.entry.status,
        createdAt: result.entry.createdAt,
      },
    });
  } else {
    workflow.appendAuditEvent({
      actorId: accessResult.identity,
      type: "publishing_queue.enqueue_rejected",
      message: "Rejected publishing queue enqueue attempt.",
      payload: { proposalId, reason: result.reason },
    });
  }

  return { status: "ok", operation, result };
}
