import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRuntime } from "./runtime.ts";
import type { ActionRequest, AgentDefinition } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-approval-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) {
  runtime.registerAgent(definition);
}

const approvalTestAgent: AgentDefinition = {
  id: "AP-001",
  name: "approval-test-agent",
  version: "1.0",
  status: "observed",
  mission: "Exercise human approval decisions.",
  description: "Active test-only agent for approval API coverage.",
  capabilities: ["publication"],
  allowedInputs: ["approval tests"],
  expectedOutputs: ["approval records"],
  authorityLevel: "delegate",
  approvalRequirements: [],
  limitations: ["No action is executed."],
  declaredPerformanceSignals: [{ id: "approval_compliance", description: "Respects human approval decisions." }],
  executionState: "implemented",
};
runtime.registerAgent(approvalTestAgent);

function pendingAction(actionId: string): ActionRequest {
  return {
    actionId,
    agentId: "AP-001",
    actionType: "publish",
    capability: "publication",
    purpose: "Publish approved material",
    target: "external channel",
    scope: "external",
    impactLevel: "high",
    requestedAt: new Date().toISOString(),
  };
}

function createPendingApproval(actionId: string): string {
  const decision = runtime.evaluateAction(pendingAction(actionId));
  assert.equal(decision.status, "approval-required", "high-impact action must create a pending approval");
  assert.equal(decision.approval?.status, "pending", "approval must begin pending");
  return decision.approval!.approvalId;
}

const approvedId = createPendingApproval("approval-approve");
const approved = runtime.approveAction({ approvalId: approvedId, approverId: "guido", reason: "Reviewed and approved." });
assert.equal(approved.status, "approved", "pending approval should be approvable");
assert.equal(approved.approval?.approvedBy, "guido", "approver identity must be retained");
assert.equal(approved.approval?.reason, "Reviewed and approved.", "approval reason must be retained");
assert.ok(approved.approval?.decidedAt, "approval timestamp must be retained");
assert.equal(runtime.rejectAction({ approvalId: approvedId, approverId: "guido" }).status, "already-decided", "approved request cannot be rejected");

const rejectedId = createPendingApproval("approval-reject");
const rejected = runtime.rejectAction({ approvalId: rejectedId, approverId: "guido", reason: "Not ready for release." });
assert.equal(rejected.status, "rejected", "pending approval should be rejectable");
assert.equal(rejected.approval?.approvedBy, "guido", "rejecting approver identity must be retained");
assert.equal(runtime.approveAction({ approvalId: rejectedId, approverId: "guido" }).status, "already-decided", "rejected request cannot be approved");

assert.equal(runtime.approveAction({ approvalId: "missing", approverId: "guido" }).status, "not-found", "missing approval IDs must not create records");

const expiredId = createPendingApproval("approval-expired");
const stateFilePath = path.join(storageRoot, "state.json");
const stateDocument = JSON.parse(readFileSync(stateFilePath, "utf8")) as { approvalRequests: Array<{ approvalId: string; expiresAt?: string }> };
const pendingExpired = stateDocument.approvalRequests.find((approval) => approval.approvalId === expiredId)!;
pendingExpired.expiresAt = new Date(Date.now() - 1_000).toISOString();
writeFileSync(stateFilePath, JSON.stringify(stateDocument, null, 2), "utf8");
const expiryRuntime = new AgentRuntime({ storageRoot });
const expiredDecision = expiryRuntime.approveAction({ approvalId: expiredId, approverId: "guido" });
assert.equal(expiredDecision.status, "expired", "expired approval cannot be approved");

const reloaded = new AgentRuntime({ storageRoot });
const persistedApproved = reloaded.listApprovalRequests().find((approval) => approval.approvalId === approvedId);
const persistedRejected = reloaded.listApprovalRequests().find((approval) => approval.approvalId === rejectedId);
assert.equal(persistedApproved?.status, "approved", "approval state must persist after reload");
assert.equal(persistedRejected?.status, "rejected", "rejection state must persist after reload");
assert.equal(reloaded.listApprovalRequests().find((approval) => approval.approvalId === expiredId)?.status, "expired", "expiry state must persist after reload");

const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(auditLog, /approval\.approved/, "approved decisions must be audited");
assert.match(auditLog, /approval\.rejected/, "rejected decisions must be audited");
assert.match(auditLog, /approval\.expired/, "expired decisions must be audited");
assert.match(auditLog, /approval\.decision_rejected/, "invalid second decisions must be audited");
assert.equal(reloaded.getBrain().getCompanyKnowledge().state.activeWork.length, 0, "approval must not execute a task or action");

console.log("Approval service tests passed.");