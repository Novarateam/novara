import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { InstitutionalKnowledgeApplication, InstitutionalKnowledgeProposal } from "./types.ts";

export type InstitutionalKnowledgeReconciliation = { status: "not-applied" | "applied" | "conflict" | "unknown-result"; currentContentHash: string; baseContentHash: string; proposedContentHash: string; reason: string };
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const folders = new Set(["Company", "Strategy", "Decisions", "Agents", "Projects", "Integrations"]);
function canonicalTarget(targetPath: string, vaultRoot: string): string {
  if (path.isAbsolute(targetPath)) throw new Error("Target path must be relative.");
  const normalized = targetPath.replace(/\\/g, "/"); const [folder] = normalized.split("/");
  if (!folders.has(folder) || !/\.(md|markdown)$/i.test(normalized)) throw new Error("Target must be an allowlisted institutional Markdown note.");
  const root = realpathSync(vaultRoot); const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`) || !statSync(resolved).isFile()) throw new Error("Target institutional note was not found.");
  const actual = realpathSync(resolved); if (!actual.startsWith(`${root}${path.sep}`)) throw new Error("Target path resolves outside the canonical vault.");
  return actual;
}
export function reconcileInstitutionalKnowledge(proposal: InstitutionalKnowledgeProposal, application: InstitutionalKnowledgeApplication | undefined, vaultRoot = path.resolve(process.cwd(), "Novara")): InstitutionalKnowledgeReconciliation {
  const target = canonicalTarget(proposal.targetPath, vaultRoot); const currentContentHash = hash(readFileSync(target, "utf8")); const proposedContentHash = hash(proposal.proposedContent);
  if (currentContentHash === proposal.baseContentHash) return { status: "not-applied", currentContentHash, baseContentHash: proposal.baseContentHash, proposedContentHash, reason: "Current note still matches the approved proposal baseline." };
  if (currentContentHash === proposedContentHash) return { status: "applied", currentContentHash, baseContentHash: proposal.baseContentHash, proposedContentHash, reason: "Current note matches the exact proposed content." };
  return { status: application?.status === "unknown-result" ? "unknown-result" : "conflict", currentContentHash, baseContentHash: proposal.baseContentHash, proposedContentHash, reason: "Current note matches neither baseline nor proposed content." };
}