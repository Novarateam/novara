export type ContentReviewOperation = "approveProposal" | "rejectProposal";

export interface LocalContentReviewAccessRule {
  identity: string;
  credential: string;
  operations: ContentReviewOperation[];
}

export type ContentReviewAccessResult =
  | { status: "authorized"; identity: string }
  | { status: "authentication-rejected"; reason: string }
  | { status: "authorization-rejected"; identity: string; reason: string };

function isContentReviewOperation(value: unknown): value is ContentReviewOperation {
  return value === "approveProposal" || value === "rejectProposal";
}

export function loadLocalContentReviewAccessRules(value = process.env.NOVARA_CONTENT_REVIEW_LOCAL_ACCESS): LocalContentReviewAccessRule[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const rule = entry as Record<string, unknown>;
      const identity = typeof rule.identity === "string" ? rule.identity.trim() : "";
      const credential = typeof rule.credential === "string" ? rule.credential : "";
      const operations = Array.isArray(rule.operations) ? rule.operations.filter(isContentReviewOperation) : [];
      return identity && credential && operations.length ? [{ identity, credential, operations }] : [];
    });
  } catch {
    return [];
  }
}

export class LocalContentReviewAccessService {
  private readonly rules: LocalContentReviewAccessRule[];

  constructor(rules: LocalContentReviewAccessRule[]) {
    this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] }));
  }

  authorize(operation: ContentReviewOperation | undefined, credential: string | undefined): ContentReviewAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Content review authentication is required." };
    const rule = this.rules.find((entry) => entry.credential === credential);
    if (!rule) return { status: "authentication-rejected", reason: "Content review authentication was rejected." };
    if (!rule.operations.includes(operation)) return { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for this content review operation." };
    return { status: "authorized", identity: rule.identity };
  }
}
