import { isContentProposalEntry } from "./content-review-service.ts";
import type {
  CompanyMemoryEntry,
  ContentReviewDecisionRecord,
  PublishingQueueEnqueueResult,
  PublishingQueueEntry,
} from "./types.ts";

// Must match the Content Agent's id (core/agent-runtime/src/agent.ts / runtime.ts).
const CONTENT_AGENT_ID = "A-014";

export interface PublishingQueueReadStore {
  listPublishingQueueEntries(): PublishingQueueEntry[];
  getPublishingQueueEntry(queueEntryId: string): PublishingQueueEntry | undefined;
}

/** Read-only listing/lookup of durable queue entries. Never mutates anything. */
export class PublishingQueueReadService {
  private readonly store: PublishingQueueReadStore;

  constructor(store: PublishingQueueReadStore) {
    this.store = store;
  }

  listEntries(): PublishingQueueEntry[] {
    return this.store
      .listPublishingQueueEntries()
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.queueEntryId.localeCompare(left.queueEntryId));
  }

  getEntry(queueEntryId: string): PublishingQueueEntry | undefined {
    return this.store.getPublishingQueueEntry(queueEntryId);
  }
}

export interface PublishingQueueEnqueueStore {
  getMemoryEntry(proposalId: string): CompanyMemoryEntry | undefined;
  getContentReviewDecisionByProposal(proposalId: string): ContentReviewDecisionRecord | undefined;
  getPublishingQueueEntryByProposal(proposalId: string): PublishingQueueEntry | undefined;
}

export interface EnqueueProposalRequest {
  queueEntryId: string;
  proposalId: string;
  agentId: string;
}

/**
 * Creates a durable publishing-queue entry from an already-approved Content Review decision.
 *
 * Eligibility rule: no decision -> not eligible; rejected decision -> not eligible;
 * approved decision -> eligible. This service never contacts any external social platform
 * or publishing API, any external service, an AI provider, or another specialist; it only
 * reads existing durable state and (on success) appends one new queue record. It never
 * mutates the original proposal.
 *
 * Duplicate rule (documented, consistent with the Content Review decision boundary):
 * exactly one queue entry per proposalId. A repeated enqueue attempt is rejected clearly,
 * referencing the existing queue entry, rather than silently creating a duplicate.
 */
export class PublishingQueueEnqueueService {
  private readonly store: PublishingQueueEnqueueStore;

  constructor(store: PublishingQueueEnqueueStore) {
    this.store = store;
  }

  enqueue(request: EnqueueProposalRequest): PublishingQueueEnqueueResult {
    const queueEntryId = String(request.queueEntryId ?? "").trim();
    const proposalId = String(request.proposalId ?? "").trim();
    const agentId = String(request.agentId ?? "").trim();

    if (!queueEntryId || !proposalId || !agentId) {
      return { status: "rejected", reason: "queueEntryId, proposalId, and agentId are required." };
    }
    if (agentId !== CONTENT_AGENT_ID) {
      return { status: "rejected", reason: "Referenced agentId does not match the Content Agent." };
    }

    const entry = this.store.getMemoryEntry(proposalId);
    if (!entry || !isContentProposalEntry(entry)) {
      return { status: "rejected", reason: "Referenced content proposal was not found." };
    }

    const decision = this.store.getContentReviewDecisionByProposal(proposalId);
    if (!decision) {
      return { status: "rejected", reason: "This proposal has no recorded review decision yet and is not eligible." };
    }
    if (decision.decision !== "approved") {
      return { status: "rejected", reason: `This proposal was ${decision.decision} and is not eligible for the publishing queue.` };
    }

    const existingEntry = this.store.getPublishingQueueEntryByProposal(proposalId);
    if (existingEntry) {
      return { status: "rejected", reason: `This proposal is already queued (queueEntryId: ${existingEntry.queueEntryId}).` };
    }

    const now = new Date().toISOString();
    return {
      status: "created",
      entry: {
        queueEntryId,
        proposalId,
        agentId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      },
    };
  }
}
