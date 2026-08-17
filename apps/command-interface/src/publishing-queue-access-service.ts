export type PublishingQueueOperation = "enqueueProposal";

export interface LocalPublishingQueueAccessRule {
  identity: string;
  credential: string;
  operations: PublishingQueueOperation[];
}

export type PublishingQueueAccessResult =
  | { status: "authorized"; identity: string }
  | { status: "authentication-rejected"; reason: string }
  | { status: "authorization-rejected"; identity: string; reason: string };

function isPublishingQueueOperation(value: unknown): value is PublishingQueueOperation {
  return value === "enqueueProposal";
}

export function loadLocalPublishingQueueAccessRules(value = process.env.NOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS): LocalPublishingQueueAccessRule[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const rule = entry as Record<string, unknown>;
      const identity = typeof rule.identity === "string" ? rule.identity.trim() : "";
      const credential = typeof rule.credential === "string" ? rule.credential : "";
      const operations = Array.isArray(rule.operations) ? rule.operations.filter(isPublishingQueueOperation) : [];
      return identity && credential && operations.length ? [{ identity, credential, operations }] : [];
    });
  } catch {
    return [];
  }
}

export class LocalPublishingQueueAccessService {
  private readonly rules: LocalPublishingQueueAccessRule[];

  constructor(rules: LocalPublishingQueueAccessRule[]) {
    this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] }));
  }

  authorize(operation: PublishingQueueOperation | undefined, credential: string | undefined): PublishingQueueAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Publishing queue authentication is required." };
    const rule = this.rules.find((entry) => entry.credential === credential);
    if (!rule) return { status: "authentication-rejected", reason: "Publishing queue authentication was rejected." };
    if (!rule.operations.includes(operation)) return { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for this publishing queue operation." };
    return { status: "authorized", identity: rule.identity };
  }
}
