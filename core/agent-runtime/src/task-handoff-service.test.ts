import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRuntime } from "./runtime.ts";
import type { ActionRequest, AgentDefinition } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-handoff-"));

const handoffAgent: AgentDefinition = {
  id: "HO-001",
  name: "handoff-test-agent",
  version: "1.0",
  status: "observed",
  mission: "Exercise permission-gated task handoff.",
  description: "Active test-only agent for task handoff coverage.",
  capabilities: ["safe_research", "publication"],
  allowedInputs: ["handoff tests"],
  expectedOutputs: ["queued task records"],
  authorityLevel: "delegate",
  approvalRequirements: [],
  limitations: ["No task is executed."],
  declaredPerformanceSignals: [{ id: "handoff_compliance", description: "Creates tasks only after authorization." }],
  executionState: "implemented",
};

function createRuntime(): AgentRuntime {
  const runtime = new AgentRuntime({ storageRoot });
  runtime.registerAgent(handoffAgent);
  return runtime;
}

const runtime = createRuntime();

function action(actionId: string, actionType: string, capability: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId,
    agentId: "HO-001",
    actionType,
    capability,
    purpose: `Task handoff for ${actionType}`,
    target: actionType === "publish" ? "external channel" : "internal research workspace",
    scope: actionType === "publish" ? "external" : "company",
    impactLevel: actionType === "publish" ? "high" : "low",
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function approvalRequired(actionId: string) {
  const decision = runtime.evaluateAction(action(actionId, "publish", "publication"));
  assert.equal(decision.status, "approval-required", "publish must require approval");
  return decision.approval!.approvalId;
}

const allowedAction = action("handoff-allowed", "research", "safe_research");
assert.equal(runtime.evaluateAction(allowedAction).status, "allowed", "safe action must be allowed");
const allowedHandoff = runtime.handoffTask({ actionId: allowedAction.actionId, taskId: "task-allowed" });
assert.equal(allowedHandoff.status, "created", "allowed action should create a task");
assert.equal(allowedHandoff.task?.status, "queued", "handoff task must be queued");
assert.equal(allowedHandoff.task?.startedAt, undefined, "handoff must not start a task");
assert.equal(allowedHandoff.task?.completedAt, undefined, "handoff must not complete a task");
assert.equal(allowedHandoff.task?.result, undefined, "handoff must not create an execution result");

const approvedActionId = "handoff-approved";
const approvedApprovalId = approvalRequired(approvedActionId);
assert.equal(runtime.approveAction({ approvalId: approvedApprovalId, approverId: "guido" }).status, "approved", "approval must be explicit");
const approvedHandoff = runtime.handoffTask({ actionId: approvedActionId, approvalId: approvedApprovalId, taskId: "task-approved" });
assert.equal(approvedHandoff.status, "created", "approved action should create a task");
assert.equal(approvedHandoff.task?.handoff?.approvalId, approvedApprovalId, "task should retain approval reference");

const pendingActionId = "handoff-pending";
assert.equal(runtime.handoffTask({ actionId: pendingActionId, approvalId: approvalRequired(pendingActionId), taskId: "task-pending" }).status, "rejected", "pending approval cannot hand off");

const rejectedActionId = "handoff-rejected";
const rejectedApprovalId = approvalRequired(rejectedActionId);
assert.equal(runtime.rejectAction({ approvalId: rejectedApprovalId, approverId: "guido" }).status, "rejected", "approval should reject explicitly");
assert.equal(runtime.handoffTask({ actionId: rejectedActionId, approvalId: rejectedApprovalId, taskId: "task-rejected" }).status, "rejected", "rejected approval cannot hand off");

const mismatchApprovedId = approvalRequired("handoff-mismatch-approved");
runtime.approveAction({ approvalId: mismatchApprovedId, approverId: "guido" });
const mismatchActionId = "handoff-mismatch-target";
approvalRequired(mismatchActionId);
assert.match(runtime.handoffTask({ actionId: mismatchActionId, approvalId: mismatchApprovedId, taskId: "task-mismatch" }).reason, /different action/, "approval must belong to the same action");

assert.equal(runtime.handoffTask({ actionId: approvedActionId, approvalId: "missing", taskId: "task-missing-approval" }).status, "rejected", "missing approval cannot hand off approval-required action");

const deniedAction = action("handoff-denied", "research", "undeclared_capability");
assert.equal(runtime.evaluateAction(deniedAction).status, "denied", "undeclared capability should be denied");
assert.equal(runtime.handoffTask({ actionId: deniedAction.actionId, taskId: "task-denied" }).status, "rejected", "denied action cannot hand off");
assert.equal(runtime.handoffTask({ actionId: "missing-permission", taskId: "task-missing-permission" }).status, "rejected", "missing permission evidence cannot hand off");

const expiredActionId = "handoff-expired";
const expiredApprovalId = approvalRequired(expiredActionId);
const stateFilePath = path.join(storageRoot, "state.json");
const stateDocument = JSON.parse(readFileSync(stateFilePath, "utf8")) as { approvalRequests: Array<{ approvalId: string; expiresAt?: string }> };
stateDocument.approvalRequests.find((approval) => approval.approvalId === expiredApprovalId)!.expiresAt = new Date(Date.now() - 1_000).toISOString();
writeFileSync(stateFilePath, JSON.stringify(stateDocument, null, 2), "utf8");
const expiryRuntime = createRuntime();
assert.equal(expiryRuntime.approveAction({ approvalId: expiredApprovalId, approverId: "guido" }).status, "expired", "expired approval must not approve");
assert.equal(expiryRuntime.handoffTask({ actionId: expiredActionId, approvalId: expiredApprovalId, taskId: "task-expired" }).status, "rejected", "expired approval cannot hand off");

const reloaded = createRuntime();
const persistedTask = reloaded.getCompanyBrief().state;
assert.ok(persistedTask, "runtime reload should remain available");
const persistedSnapshot = JSON.parse(readFileSync(stateFilePath, "utf8")) as { tasks: Array<{ id: string; status: string; completedAt?: string; result?: unknown }> };
assert.equal(persistedSnapshot.tasks.find((task) => task.id === "task-allowed")?.status, "queued", "handoff task must persist after reload");
assert.equal(persistedSnapshot.tasks.find((task) => task.id === "task-approved")?.completedAt, undefined, "persisted handoff task must not be completed");
assert.equal(persistedSnapshot.tasks.find((task) => task.id === "task-approved")?.result, undefined, "persisted handoff task must not execute");

const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(auditLog, /task\.created/, "successful handoff must be audited");
assert.match(auditLog, /task\.handoff_rejected/, "rejected handoff must be audited");
assert.doesNotMatch(auditLog, /task\.started|task\.completed/, "handoff must not produce execution audit events");

console.log("Task handoff tests passed.");