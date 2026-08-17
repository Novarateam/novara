import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { LocalInstitutionalKnowledgeAccessService, loadLocalInstitutionalKnowledgeAccessRules, type InstitutionalKnowledgeOperation } from "./institutional-knowledge-access-service.ts";

const ALLOWED_FOLDERS = new Set(["Company", "Strategy", "Decisions", "Agents", "Projects", "Integrations"]);
export type InstitutionalKnowledgeCommand = { operation: InstitutionalKnowledgeOperation; proposalId?: string; targetPath?: string; proposedContent?: string; rationale?: string; evidenceReferences?: string[]; decision?: "approved" | "rejected"; reason?: string };

function vaultRoot() { return path.resolve(process.cwd(), "Novara"); }
function targetFile(targetPath: string) {
  if (path.isAbsolute(targetPath)) throw new Error("Target path must be relative.");
  const normalized = targetPath.replace(/\\/g, "/"); const [folder] = normalized.split("/");
  if (!ALLOWED_FOLDERS.has(folder) || !/\.(md|markdown)$/i.test(normalized)) throw new Error("Target must be an existing Markdown note in an allowlisted institutional folder.");
  const root = realpathSync(vaultRoot()); const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`) || !statSync(resolved).isFile()) throw new Error("Target institutional note was not found.");
  const actual = realpathSync(resolved); if (!actual.startsWith(`${root}${path.sep}`)) throw new Error("Target path resolves outside the canonical vault.");
  return { normalized, resolved: actual };
}
const hash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

export function handleInstitutionalKnowledgeCommand(command: Partial<InstitutionalKnowledgeCommand>, credential: string | undefined, repository = new RuntimeRepository(new FileRuntimeStore()), access = new LocalInstitutionalKnowledgeAccessService(loadLocalInstitutionalKnowledgeAccessRules())) {
  const operation = command.operation; if (!operation || !["createProposal", "listProposals", "getProposal", "reviewProposal"].includes(operation)) return { status: "invalid-request" as const, reason: "Unsupported institutional knowledge operation." };
  const accessResult = access.authorize(operation, credential); if (accessResult.status !== "authorized") return { status: "invalid-request" as const, reason: accessResult.reason }; const identity = accessResult.identity;
  if (operation === "listProposals") return { status: "ok" as const, operation, data: repository.listInstitutionalKnowledgeProposals().map((proposal) => ({ proposal, review: repository.getInstitutionalKnowledgeReviewByProposal(proposal.proposalId) })) };
  const proposalId = command.proposalId?.trim();
  if (operation === "getProposal") return proposalId ? { status: "ok" as const, operation, data: repository.getInstitutionalKnowledgeProposal(proposalId) } : { status: "invalid-request" as const, reason: "proposalId is required." };
  if (operation === "createProposal") {
    const targetPath = command.targetPath?.trim(); const proposedContent = command.proposedContent; const rationale = command.rationale?.trim();
    if (!targetPath || typeof proposedContent !== "string" || !rationale) return { status: "invalid-request" as const, reason: "targetPath, proposedContent, and rationale are required." };
    try { const target = targetFile(targetPath); const baseline = readFileSync(target.resolved, "utf8"); const proposal = { proposalId: `institutional-knowledge-${randomUUID()}`, proposerType: "human" as const, proposerId: identity, targetPath: target.normalized, baseContentHash: hash(baseline), proposedContent, rationale, evidenceReferences: Array.isArray(command.evidenceReferences) ? command.evidenceReferences.filter((entry): entry is string => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [], createdAt: new Date().toISOString() }; const created = repository.createInstitutionalKnowledgeProposal(proposal); if (!created) return { status: "invalid-request" as const, reason: "Proposal could not be persisted." }; repository.appendAuditEvent({ actorId: identity, type: "institutional_knowledge.proposed", message: "Created institutional knowledge proposal.", payload: { proposalId: proposal.proposalId, targetPath: proposal.targetPath } }); return { status: "ok" as const, operation, data: proposal }; } catch (error) { return { status: "invalid-request" as const, reason: (error as Error).message }; }
  }
  if (!proposalId || (command.decision !== "approved" && command.decision !== "rejected")) return { status: "invalid-request" as const, reason: "proposalId and a valid review decision are required." };
  const review = repository.createInstitutionalKnowledgeReview({ reviewId: `institutional-knowledge-review-${randomUUID()}`, proposalId, reviewerId: identity, decision: command.decision, ...(command.reason?.trim() ? { reason: command.reason.trim() } : {}), reviewedAt: new Date().toISOString() });
  if (!review) return { status: "invalid-request" as const, reason: "Proposal was not found or already has a terminal review." };
  repository.appendAuditEvent({ actorId: identity, type: "institutional_knowledge.reviewed", message: "Recorded institutional knowledge review.", payload: { proposalId, decision: review.decision, reviewId: review.reviewId } });
  return { status: "ok" as const, operation, data: review };
}