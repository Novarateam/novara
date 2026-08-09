import type {
  AuthorityLevel,
  CompanyMemoryEntry,
  CompanyMemoryStatus,
  CompanyMemoryType,
} from "./types.ts";

export class CompanyMemory {
  private entries = new Map<string, CompanyMemoryEntry>();

  add(entry: CompanyMemoryEntry): CompanyMemoryEntry {
    this.validate(entry);
    this.entries.set(entry.id, { ...entry });
    return this.entries.get(entry.id)!;
  }

  get(id: string): CompanyMemoryEntry | undefined {
    return this.entries.get(id);
  }

  list(): CompanyMemoryEntry[] {
    return Array.from(this.entries.values());
  }

  listByType(type: CompanyMemoryType): CompanyMemoryEntry[] {
    return this.list().filter((entry) => entry.type === type);
  }

  private validate(entry: CompanyMemoryEntry): void {
    if (!entry || typeof entry !== "object") {
      throw new Error("Memory entry must be an object.");
    }

    const requiredFields: Array<keyof CompanyMemoryEntry> = [
      "id",
      "type",
      "content",
      "source",
      "timestamp",
      "confidence",
      "authority",
      "status",
    ];

    for (const field of requiredFields) {
      const value = entry[field];
      if (value === undefined || value === null) {
        throw new Error(`Memory entry is missing required field: ${field}`);
      }
    }

    if (typeof entry.id !== "string" || entry.id.trim().length === 0) {
      throw new Error("Memory entry id must be a non-empty string.");
    }

    if (typeof entry.source !== "string" || entry.source.trim().length === 0) {
      throw new Error("Memory entry source must be a non-empty string.");
    }

    if (typeof entry.timestamp !== "string" || entry.timestamp.trim().length === 0) {
      throw new Error("Memory entry timestamp must be a non-empty string.");
    }

    if (typeof entry.confidence !== "number" || Number.isNaN(entry.confidence)) {
      throw new Error("Memory entry confidence must be a number.");
    }

    if (entry.confidence < 0 || entry.confidence > 1) {
      throw new Error("Memory entry confidence must be between 0 and 1.");
    }

    if (!this.isValidType(entry.type)) {
      throw new Error(`Invalid memory type: ${entry.type}`);
    }

    if (!this.isValidStatus(entry.status)) {
      throw new Error(`Invalid memory status: ${entry.status}`);
    }

    if (!this.isValidAuthority(entry.authority)) {
      throw new Error(`Invalid memory authority: ${entry.authority}`);
    }

    if (!this.hasUsableContent(entry.content)) {
      throw new Error("Memory entry content must be present.");
    }
  }

  private isValidType(type: CompanyMemoryType): boolean {
    return [
      "objective",
      "decision",
      "knowledge",
      "evidence",
      "experiment",
      "learning",
    ].includes(type);
  }

  private isValidStatus(status: CompanyMemoryStatus): boolean {
    return ["proposed", "verified", "superseded"].includes(status);
  }

  private isValidAuthority(authority: AuthorityLevel): boolean {
    return [
      "observe",
      "recommend",
      "execute_with_approval",
      "autonomous",
      "delegate",
    ].includes(authority);
  }

  private hasUsableContent(content: unknown): boolean {
    if (content === undefined || content === null) {
      return false;
    }

    if (typeof content === "string") {
      return content.trim().length > 0;
    }

    if (typeof content === "object") {
      return Object.keys(content as Record<string, unknown>).length > 0;
    }

    return true;
  }
}
