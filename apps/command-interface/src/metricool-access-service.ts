export type MetricoolOperation = "preflightQueueEntry";

export interface LocalMetricoolAccessRule {
  identity: string;
  credential: string;
  operations: MetricoolOperation[];
}

export type MetricoolAccessResult =
  | { status: "authorized"; identity: string }
  | { status: "authentication-rejected"; reason: string }
  | { status: "authorization-rejected"; identity: string; reason: string };

function isMetricoolOperation(value: unknown): value is MetricoolOperation {
  return value === "preflightQueueEntry";
}

export function loadLocalMetricoolAccessRules(value = process.env.NOVARA_METRICOOL_LOCAL_ACCESS): LocalMetricoolAccessRule[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const rule = entry as Record<string, unknown>;
      const identity = typeof rule.identity === "string" ? rule.identity.trim() : "";
      const credential = typeof rule.credential === "string" ? rule.credential : "";
      const operations = Array.isArray(rule.operations) ? rule.operations.filter(isMetricoolOperation) : [];
      return identity && credential && operations.length ? [{ identity, credential, operations }] : [];
    });
  } catch {
    return [];
  }
}

export class LocalMetricoolAccessService {
  private readonly rules: LocalMetricoolAccessRule[];

  constructor(rules: LocalMetricoolAccessRule[]) {
    this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] }));
  }

  authorize(operation: MetricoolOperation | undefined, credential: string | undefined): MetricoolAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Metricool authentication is required." };
    const rule = this.rules.find((entry) => entry.credential === credential);
    if (!rule) return { status: "authentication-rejected", reason: "Metricool authentication was rejected." };
    if (!rule.operations.includes(operation)) return { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for this Metricool operation." };
    return { status: "authorized", identity: rule.identity };
  }
}
