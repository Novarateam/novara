import type {
  CompanyMemoryEntry,
  DecisionRecord,
  StoreDecisionRequest,
} from "./types.ts";

function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<DecisionRecord>;
  return typeof record.decisionId === "string" && typeof record.title === "string" && typeof record.owner === "string" &&
    Array.isArray(record.alternativesConsidered) && typeof record.rationale === "string" &&
    Array.isArray(record.supportingEvidenceIds) && typeof record.approvalState === "string" &&
    typeof record.createdAt === "string" && typeof record.updatedAt === "string" && typeof record.revisitable === "boolean";
}

export class DecisionMemory {
  private readonly listMemory: () => CompanyMemoryEntry[];
  private readonly storeMemory: (entry: CompanyMemoryEntry, scopeIds?: string[]) => CompanyMemoryEntry;

  constructor(listMemory: () => CompanyMemoryEntry[], storeMemory: (entry: CompanyMemoryEntry, scopeIds?: string[]) => CompanyMemoryEntry) {
    this.listMemory = listMemory;
    this.storeMemory = storeMemory;
  }

  store(request: StoreDecisionRequest): DecisionRecord {
    const now = new Date().toISOString();
    const decision: DecisionRecord = {
      ...request.decision,
      createdAt: request.decision.createdAt ?? now,
      updatedAt: request.decision.updatedAt ?? now,
    };
    if (!isDecisionRecord(decision) || !decision.decisionId.trim() || !decision.title.trim() || !decision.owner.trim() || !decision.rationale.trim()) {
      throw new Error("Decision records require id, title, owner, rationale, alternatives, evidence references, approval state, and revisitable metadata.");
    }

    this.storeMemory({
      id: `decision-${decision.decisionId}`,
      type: "decision",
      content: decision,
      source: request.source,
      timestamp: decision.updatedAt,
      confidence: request.confidence ?? 1,
      authority: request.authority,
      status: decision.approvalState === "superseded" ? "superseded" : decision.approvalState === "approved" ? "verified" : "proposed",
    }, request.scopeIds);
    return decision;
  }

  get(decisionId: string): DecisionRecord | undefined {
    return this.list().find((decision) => decision.decisionId === decisionId);
  }

  list(): DecisionRecord[] {
    return this.listMemory()
      .filter((entry) => entry.type === "decision" && isDecisionRecord(entry.content))
      .map((entry) => entry.content as DecisionRecord)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}