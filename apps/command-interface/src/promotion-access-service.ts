export type PromotionOperation = "createPromotionProposal" | "confirmPromotion" | "applyPromotion";

export interface LocalPromotionAccessRule {
  identity: string;
  credential: string;
  operations: PromotionOperation[];
}

export type PromotionAccessResult =
  | { status: "authorized"; identity: string }
  | { status: "authentication-rejected"; reason: string }
  | { status: "authorization-rejected"; identity: string; reason: string };

function isPromotionOperation(value: unknown): value is PromotionOperation {
  return value === "createPromotionProposal" || value === "confirmPromotion" || value === "applyPromotion";
}

export function loadLocalPromotionAccessRules(value = process.env.NOVARA_PROMOTION_LOCAL_ACCESS): LocalPromotionAccessRule[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const rule = entry as Record<string, unknown>;
      const identity = typeof rule.identity === "string" ? rule.identity.trim() : "";
      const credential = typeof rule.credential === "string" ? rule.credential : "";
      const operations = Array.isArray(rule.operations) ? rule.operations.filter(isPromotionOperation) : [];
      return identity && credential && operations.length ? [{ identity, credential, operations }] : [];
    });
  } catch {
    return [];
  }
}

export class LocalPromotionAccessService {
  private readonly rules: LocalPromotionAccessRule[];

  constructor(rules: LocalPromotionAccessRule[]) {
    this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] }));
  }

  authorize(operation: PromotionOperation | undefined, credential: string | undefined): PromotionAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Promotion authentication is required." };
    const rule = this.rules.find((entry) => entry.credential === credential);
    if (!rule) return { status: "authentication-rejected", reason: "Promotion authentication was rejected." };
    if (!rule.operations.includes(operation)) return { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for this promotion operation." };
    return { status: "authorized", identity: rule.identity };
  }
}