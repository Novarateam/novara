import { isContentProposalEntry } from "./content-review-service.ts";
import { checkMetricoolReadiness, type CheckMetricoolReadinessOptions } from "./metricool-adapter.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, PublishingQueueEntry } from "./types.ts";

// Must match the Content Agent's id (core/agent-runtime/src/agent.ts / runtime.ts).
const CONTENT_AGENT_ID = "A-014";

export interface MetricoolPreflightStore {
  getPublishingQueueEntry(queueEntryId: string): PublishingQueueEntry | undefined;
  getMemoryEntry(proposalId: string): CompanyMemoryEntry | undefined;
  getContentReviewDecisionByProposal(proposalId: string): ContentReviewDecisionRecord | undefined;
}

export type MetricoolPreflightResult =
  | { status: "validation-failed"; reason: string }
  | { status: "not-configured" }
  | { status: "unavailable"; reason: string }
  | { status: "ready"; queueEntryId: string; proposalId: string };

/**
 * Validates that a specific PublishingQueueEntry is genuinely eligible for a future,
 * separately-approved publish, then checks (but does not perform) the external Metricool
 * connection. This never bypasses PublishingQueueService/ContentReviewService, never creates
 * a queue entry, never mutates a proposal or decision, and never publishes anything - no
 * publishing action exists in this module or anywhere in this phase.
 */
export class MetricoolPreflightService {
  private readonly store: MetricoolPreflightStore;
  private readonly readiness: (options?: CheckMetricoolReadinessOptions) => ReturnType<typeof checkMetricoolReadiness>;

  constructor(store: MetricoolPreflightStore, readiness: (options?: CheckMetricoolReadinessOptions) => ReturnType<typeof checkMetricoolReadiness> = checkMetricoolReadiness) {
    this.store = store;
    this.readiness = readiness;
  }

  async preflight(queueEntryId: string, readinessOptions?: CheckMetricoolReadinessOptions): Promise<MetricoolPreflightResult> {
    const trimmedId = String(queueEntryId ?? "").trim();
    if (!trimmedId) {
      return { status: "validation-failed", reason: "queueEntryId is required." };
    }

    const entry = this.store.getPublishingQueueEntry(trimmedId);
    if (!entry) {
      return { status: "validation-failed", reason: "Publishing queue entry was not found." };
    }
    if (entry.status !== "queued") {
      return { status: "validation-failed", reason: `Queue entry status is "${entry.status}", not "queued".` };
    }
    if (entry.agentId !== CONTENT_AGENT_ID) {
      return { status: "validation-failed", reason: "Queue entry does not reference the Content Agent." };
    }

    const proposal = this.store.getMemoryEntry(entry.proposalId);
    if (!proposal || !isContentProposalEntry(proposal)) {
      return { status: "validation-failed", reason: "Referenced content proposal was not found or is not valid content evidence." };
    }

    const decision = this.store.getContentReviewDecisionByProposal(entry.proposalId);
    if (!decision || decision.decision !== "approved") {
      return { status: "validation-failed", reason: "Referenced proposal was not approved through Content Review." };
    }

    const readiness = await this.readiness(readinessOptions);
    if (readiness.state === "not-configured") {
      return { status: "not-configured" };
    }
    if (readiness.state === "unavailable") {
      return { status: "unavailable", reason: readiness.reason };
    }

    return { status: "ready", queueEntryId: trimmedId, proposalId: entry.proposalId };
  }
}
