import type {
  CompanyMemoryEntry,
  ContentReviewDecisionRecord,
  ContentReviewDecisionResult,
  RecordContentReviewDecisionRequest,
} from "./types.ts";

// Must match the Content Agent's id (core/agent-runtime/src/agent.ts / runtime.ts).
const CONTENT_AGENT_ID = "A-014";
const MAX_REASON_LENGTH = 500;
const allowedDecisions = new Set(["approved", "rejected"]);

export type ContentProposalStatus = "proposed" | "approved" | "rejected";

export interface ContentProposalSummary {
  proposalId: string;
  agentId: string;
  objective: string;
  structuredResult: Record<string, unknown>;
  createdAt: string;
  status: ContentProposalStatus;
  decision?: ContentReviewDecisionRecord;
}

/** True only for evidence produced by the Content Agent's specialist execution path. */
export function isContentProposalEntry(entry: CompanyMemoryEntry): boolean {
  return entry.type === "evidence" && typeof entry.source === "string" && entry.source.startsWith(`${CONTENT_AGENT_ID}/`);
}

function toProposalSummary(entry: CompanyMemoryEntry, decision: ContentReviewDecisionRecord | undefined): ContentProposalSummary {
  const content = (entry.content ?? {}) as Record<string, unknown>;
  const structuredResult = (content.structuredResult ?? {}) as Record<string, unknown>;
  const objective = typeof content.objective === "string" ? content.objective : "";

  return {
    proposalId: entry.id,
    agentId: CONTENT_AGENT_ID,
    objective,
    structuredResult,
    createdAt: entry.timestamp,
    status: decision ? decision.decision : "proposed",
    decision,
  };
}

export interface ContentReviewReadStore {
  listMemory(): CompanyMemoryEntry[];
  getContentReviewDecisionByProposal(proposalId: string): ContentReviewDecisionRecord | undefined;
}

/** Read-only listing/lookup of Content Agent proposals. Never creates tasks, calls the AI provider, or mutates anything. */
export class ContentReviewReadService {
  private readonly store: ContentReviewReadStore;

  constructor(store: ContentReviewReadStore) {
    this.store = store;
  }

  listProposals(): ContentProposalSummary[] {
    return this.store
      .listMemory()
      .filter(isContentProposalEntry)
      .map((entry) => toProposalSummary(entry, this.store.getContentReviewDecisionByProposal(entry.id)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.proposalId.localeCompare(left.proposalId));
  }

  getProposal(proposalId: string): ContentProposalSummary | undefined {
    const entry = this.store.listMemory().find((candidate) => candidate.id === proposalId && isContentProposalEntry(candidate));
    return entry ? toProposalSummary(entry, this.store.getContentReviewDecisionByProposal(entry.id)) : undefined;
  }
}

export interface ContentReviewDecisionStore {
  getMemoryEntry(proposalId: string): CompanyMemoryEntry | undefined;
  getContentReviewDecisionByProposal(proposalId: string): ContentReviewDecisionRecord | undefined;
}

/**
 * Records an immutable, exactly-once human decision on a specific Content Agent proposal.
 *
 * Duplicate/conflicting decision rule (documented, smallest safe model): once a proposal has
 * ANY recorded decision, every subsequent decision attempt for that same proposalId is
 * rejected - including a repeat of the same decision. A decision, once recorded, is final.
 */
export class ContentReviewDecisionService {
  private readonly store: ContentReviewDecisionStore;

  constructor(store: ContentReviewDecisionStore) {
    this.store = store;
  }

  record(request: RecordContentReviewDecisionRequest): ContentReviewDecisionResult {
    const decisionId = String(request.decisionId ?? "").trim();
    const proposalId = String(request.proposalId ?? "").trim();
    const agentId = String(request.agentId ?? "").trim();
    const reviewerId = String(request.reviewerId ?? "").trim();
    const decision = String(request.decision ?? "").trim();
    const reason = request.reason?.trim() || undefined;

    if (!decisionId || !proposalId || !agentId || !reviewerId) {
      return { status: "rejected", reason: "decisionId, proposalId, agentId, and reviewerId are required." };
    }
    if (!allowedDecisions.has(decision)) {
      return { status: "rejected", reason: "Invalid content review decision; must be \"approved\" or \"rejected\"." };
    }
    if (reason && reason.length > MAX_REASON_LENGTH) {
      return { status: "rejected", reason: `Reason/comment must be ${MAX_REASON_LENGTH} characters or fewer.` };
    }

    const entry = this.store.getMemoryEntry(proposalId);
    if (!entry || !isContentProposalEntry(entry)) {
      return { status: "rejected", reason: "Referenced content proposal was not found." };
    }
    if (agentId !== CONTENT_AGENT_ID) {
      return { status: "rejected", reason: "Referenced agentId does not match the Content Agent." };
    }

    const existingDecision = this.store.getContentReviewDecisionByProposal(proposalId);
    if (existingDecision) {
      return { status: "rejected", reason: `This proposal already has a recorded review decision (${existingDecision.decision}).` };
    }

    return {
      status: "created",
      record: {
        decisionId,
        proposalId,
        agentId,
        reviewerId,
        decision: decision as RecordContentReviewDecisionRequest["decision"],
        reason,
        recordedAt: new Date().toISOString(),
      },
    };
  }
}
