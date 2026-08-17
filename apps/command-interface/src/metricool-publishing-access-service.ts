export type MetricoolPublishingOperation = "publishQueueEntry";

export interface MetricoolPublishingAccessRule {
  identity: string;
  credential: string;
  operations: MetricoolPublishingOperation[];
}

export type MetricoolPublishingAccessResult =
  | { status: "authorized"; identity: string }
  | { status: "authentication-rejected"; reason: string }
  | { status: "authorization-rejected"; identity: string; reason: string };

function isOperation(value: unknown): value is MetricoolPublishingOperation {
  return value === "publishQueueEntry";
}

export function loadLocalMetricoolPublishingAccessRules(value = process.env.NOVARA_METRICOOL_PUBLISHING_ACCESS): MetricoolPublishingAccessRule[] {
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

export class LocalMetricoolPublishingAccessService {
  private readonly rules: MetricoolPublishingAccessRule[];

  constructor(rules: MetricoolPublishingAccessRule[]) {
    this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] }));
  }

  authorize(operation: MetricoolPublishingOperation | undefined, credential: string | undefined): MetricoolPublishingAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Metricool publishing authentication is required." };
    const rule = this.rules.find((candidate) => candidate.credential === credential);
    if (!rule) return { status: "authentication-rejected", reason: "Metricool publishing authentication was rejected." };
    if (!rule.operations.includes(operation)) return { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for Metricool publishing." };
    return { status: "authorized", identity: rule.identity };
  }
}
