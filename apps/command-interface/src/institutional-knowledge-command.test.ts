import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { FileRuntimeStore, RuntimeRepository } from "../../../core/agent-runtime/src/persistence.ts";
import { handleInstitutionalKnowledgeCommand } from "./institutional-knowledge-command.ts";
import { LocalInstitutionalKnowledgeAccessService } from "./institutional-knowledge-access-service.ts";

const workspace = mkdtempSync(path.join(tmpdir(), "novara-institutional-workspace-"));
const root = path.join(workspace, "Novara");
const note = path.join(root, "Company", "Vision.md");
mkdirSync(path.dirname(note), { recursive: true });
mkdirSync(path.join(root, "Strategy"), { recursive: true });
writeFileSync(note, "# Vision\nOriginal\n", "utf8");
const before = readFileSync(note, "utf8");
const hash = createHash("sha256").update(before).digest("hex");
const repository = new RuntimeRepository(new FileRuntimeStore(mkdtempSync(path.join(tmpdir(), "novara-institutional-runtime-"))));
const rules = [{ identity: "guido", credential: "knowledge-key", operations: ["createProposal", "listProposals", "getProposal", "reviewProposal"] as const }];
const access = new LocalInstitutionalKnowledgeAccessService(rules as any);
const command = (body: any, credential: string | undefined = "knowledge-key") => handleInstitutionalKnowledgeCommand(body, credential, repository, access);
const manifest = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => { const full = path.join(folder, entry.name); const stat = lstatSync(full); return stat.isSymbolicLink() ? [`${entry.name}:link`] : entry.isDirectory() ? manifest(full).map((child) => `${entry.name}/${child}`) : [`${entry.name}:${createHash("sha256").update(readFileSync(full)).digest("hex")}`]; }).sort();

const originalCwd = process.cwd(); process.chdir(workspace);
const repoRoot = root;
const target = "Company/Vision.md";
const vaultBefore = manifest(repoRoot);
const created = command({ operation: "createProposal", targetPath: target, proposedContent: "# Vision\nProposed\n", rationale: "Clarify vision", evidenceReferences: ["decision-1"] });
assert.equal(created.status, "ok"); if (created.status !== "ok") throw new Error(created.reason);
assert.equal(created.data.proposerId, "guido"); assert.equal(created.data.proposerType, "human"); assert.equal(created.data.baseContentHash, hash);
assert.equal(readFileSync(path.join(repoRoot, target), "utf8"), before, "proposal must not write the canonical note");
assert.deepEqual(manifest(repoRoot), vaultBefore, "proposal must not change any canonical vault byte or file");
for (const invalidTarget of ["../.git/config", path.join(repoRoot, target), "Company/Missing.md", ".obsidian/app.json", ".git/config.md", ".novara/state.md", "node_modules/x.md", "Other/Note.md", "Company/Vision.txt"]) {
	const proposalCount = repository.listInstitutionalKnowledgeProposals().length;
	const rejected = command({ operation: "createProposal", targetPath: invalidTarget, proposedContent: "x", rationale: "x" });
	assert.equal(rejected.status, "invalid-request", `Expected ${invalidTarget} to reject, got ${JSON.stringify(rejected)}`);
	assert.equal(repository.listInstitutionalKnowledgeProposals().length, proposalCount);
	assert.deepEqual(manifest(repoRoot), vaultBefore);
}
assert.equal(handleInstitutionalKnowledgeCommand({ operation: "createProposal", targetPath: target, proposedContent: "x", rationale: "x" }, undefined, repository, access).status, "invalid-request");
assert.equal(command({ operation: "createProposal", targetPath: target, proposedContent: "x", rationale: "x" }, "wrong-key").status, "invalid-request");
const approved = command({ operation: "reviewProposal", proposalId: created.data.proposalId, decision: "approved" });
assert.equal(approved.status, "ok"); assert.equal(approved.data.reviewerId, "guido"); assert.equal(readFileSync(path.join(repoRoot, target), "utf8"), before);
assert.deepEqual(manifest(repoRoot), vaultBefore, "approval must not change any canonical vault byte or file");
assert.equal(command({ operation: "reviewProposal", proposalId: created.data.proposalId, decision: "rejected" }).status, "invalid-request");
assert.equal(repository.getInstitutionalKnowledgeReviewByProposal(created.data.proposalId)?.decision, "approved");
assert.equal(repository.listInstitutionalKnowledgeProposals().length, 1);
const outside = path.join(workspace, "outside.md"); writeFileSync(outside, "outside", "utf8");
let escapeTarget = "Strategy/escape.md";
let escapeMechanism = "symlink";
try {
	symlinkSync(outside, path.join(repoRoot, "Strategy", "escape.md"), "file");
} catch (symlinkError) {
	const outsideDirectory = path.join(workspace, "outside-directory"); mkdirSync(outsideDirectory, { recursive: true });
	writeFileSync(path.join(outsideDirectory, "outside.md"), "outside", "utf8");
	try { symlinkSync(outsideDirectory, path.join(repoRoot, "Strategy", "escape"), "junction"); escapeTarget = "Strategy/escape/outside.md"; escapeMechanism = "junction"; }
	catch (junctionError) { throw new Error(`No genuine filesystem escape fixture is available. Symlink: ${(symlinkError as Error).code}; junction: ${(junctionError as Error).code}`); }
}
const escapeManifest = manifest(repoRoot);
const proposalCount = repository.listInstitutionalKnowledgeProposals().length;
assert.equal(command({ operation: "createProposal", targetPath: escapeTarget, proposedContent: "x", rationale: "x" }).status, "invalid-request");
assert.equal(repository.listInstitutionalKnowledgeProposals().length, proposalCount);
assert.equal(readFileSync(escapeMechanism === "symlink" ? outside : path.join(workspace, "outside-directory", "outside.md"), "utf8"), "outside");
assert.deepEqual(manifest(repoRoot), escapeManifest, "filesystem escape attempt must not modify the canonical vault");
console.log(`Filesystem escape fixture executed using ${escapeMechanism}.`);
process.chdir(originalCwd);
console.log("Institutional knowledge command tests passed.");