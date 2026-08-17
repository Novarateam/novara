export type ProductionExecutionOperation = "produceApprovedContent" | "readProductionStatus" | "decideProductionApproval" | "normalizeProductionBrief";

export interface LocalProductionExecutionAccessRule {
  identity: string;
  credential: string;
  operations: ProductionExecutionOperation[];
}

export type ProductionExecutionAccessResult =
  | { status: "authorized"; identity: string }
  | { status: "authentication-rejected"; reason: string }
  | { status: "authorization-rejected"; identity: string; reason: string };

function isOperation(value: unknown): value is ProductionExecutionOperation {
  return value === "produceApprovedContent" || value === "readProductionStatus" || value === "decideProductionApproval" || value === "normalizeProductionBrief";
}

export function loadLocalProductionExecutionAccessRules(value = process.env.NOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS): LocalProductionExecutionAccessRule[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const raw = item as Record<string, unknown>;
      const identity = typeof raw.identity === "string" ? raw.identity.trim() : "";
      const credential = typeof raw.credential === "string" ? raw.credential : "";
      const operations = Array.isArray(raw.operations) ? raw.operations.filter(isOperation) : [];
      return identity && credential && operations.length ? [{ identity, credential, operations }] : [];
    });
  } catch {
    return [];
  }
}

export class LocalProductionExecutionAccessService {
  private readonly rules: LocalProductionExecutionAccessRule[];

  constructor(rules: LocalProductionExecutionAccessRule[]) {
    this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] }));
  }

  authorize(operation: ProductionExecutionOperation | undefined, credential: string | undefined): ProductionExecutionAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Production execution authentication is required." };
    const rule = this.rules.find((candidate) => candidate.credential === credential);
    if (!rule) return { status: "authentication-rejected", reason: "Production execution authentication was rejected." };
    if (!rule.operations.includes(operation)) return { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for production execution." };
    return { status: "authorized", identity: rule.identity };
  }
}