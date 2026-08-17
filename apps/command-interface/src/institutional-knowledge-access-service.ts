export type InstitutionalKnowledgeOperation = "createProposal" | "listProposals" | "getProposal" | "reviewProposal";
export interface LocalInstitutionalKnowledgeAccessRule { identity: string; credential: string; operations: InstitutionalKnowledgeOperation[]; }
export type InstitutionalKnowledgeAccessResult = { status: "authorized"; identity: string } | { status: "authentication-rejected"; reason: string } | { status: "authorization-rejected"; identity: string; reason: string };
const operations = new Set<InstitutionalKnowledgeOperation>(["createProposal", "listProposals", "getProposal", "reviewProposal"]);
export function loadLocalInstitutionalKnowledgeAccessRules(value = process.env.NOVARA_INSTITUTIONAL_KNOWLEDGE_LOCAL_ACCESS): LocalInstitutionalKnowledgeAccessRule[] {
  try { const parsed = JSON.parse(value ?? "[]") as unknown; return Array.isArray(parsed) ? parsed.flatMap((entry) => { const raw = entry as Record<string, unknown>; const identity = typeof raw?.identity === "string" ? raw.identity.trim() : ""; const credential = typeof raw?.credential === "string" ? raw.credential : ""; const allowed = Array.isArray(raw?.operations) ? raw.operations.filter((operation): operation is InstitutionalKnowledgeOperation => typeof operation === "string" && operations.has(operation as InstitutionalKnowledgeOperation)) : []; return identity && credential && allowed.length ? [{ identity, credential, operations: allowed }] : []; }) : []; } catch { return []; }
}
export class LocalInstitutionalKnowledgeAccessService {
  private readonly rules: LocalInstitutionalKnowledgeAccessRule[];
  constructor(rules: LocalInstitutionalKnowledgeAccessRule[]) { this.rules = rules.map((rule) => ({ ...rule, operations: [...rule.operations] })); }
  authorize(operation: InstitutionalKnowledgeOperation | undefined, credential: string | undefined): InstitutionalKnowledgeAccessResult {
    if (!operation || !credential?.trim()) return { status: "authentication-rejected", reason: "Institutional knowledge authentication is required." };
    const rule = this.rules.find((entry) => entry.credential === credential); if (!rule) return { status: "authentication-rejected", reason: "Institutional knowledge authentication was rejected." };
    return rule.operations.includes(operation) ? { status: "authorized", identity: rule.identity } : { status: "authorization-rejected", identity: rule.identity, reason: "Authenticated caller is not authorized for this institutional knowledge operation." };
  }
}