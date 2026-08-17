import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRuntime } from "./runtime.ts";
import type { ActionRequest, AgentDefinition } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-execution-"));
const statePath = path.join(storageRoot, "state.json");

function definition(id: string, capabilities: string[]): AgentDefinition {
  return {
    id, name: id, version: "1.0", status: "observed", mission: "Execution test agent.", description: "Bounded execution test agent.",
    capabilities, allowedInputs: ["persisted operation data"], expectedOutputs: ["internal deterministic result"], authorityLevel: "delegate",
    approvalRequirements: [], limitations: ["No external execution."], declaredPerformanceSignals: [{ id: "internal_execution", description: "Runs bounded local operations." }], executionState: "implemented",
  };
}

const source = definition("EX-SOURCE", ["analysis", "publication", "authority_review"]);
const claimer = definition("EX-CLAIMER", ["analysis", "publication", "authority_review"]);
const definitions = [source, claimer];

function openRuntime(): AgentRuntime {
  const runtime = new AgentRuntime({ storageRoot });
  for (const agent of definitions) runtime.registerAgent(agent);
  return runtime;
}

let runtime = openRuntime();

function action(actionId: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId, agentId: "EX-SOURCE", actionType: "research", capability: "analysis", purpose: `Internal analysis ${actionId}`,
    target: "internal data", scope: "company", impactLevel: "low", requestedAt: new Date().toISOString(),
    operation: "analyse_text", operationInput: { text: "Novara builds durable systems." }, ...overrides,
  };
}

function queueAndClaim(actionRequest: ActionRequest, approvalId?: string): string {
  assert.ok(["allowed", "approval-required"].includes(runtime.evaluateAction(actionRequest).status));
  const effectiveApprovalId = approvalId ?? runtime.listApprovalRequests().find((approval) => approval.actionId === actionRequest.actionId)?.approvalId;
  if (effectiveApprovalId) runtime.approveAction({ approvalId: effectiveApprovalId, approverId: "guido" });
  const handoff = runtime.handoffTask({ actionId: actionRequest.actionId, approvalId: effectiveApprovalId, taskId: `task-${actionRequest.actionId}` });
  assert.equal(handoff.status, "created");
  assert.equal(runtime.claimTask({ taskId: handoff.task!.id, claimingAgentId: "EX-CLAIMER" }).status, "claimed");
  return handoff.task!.id;
}

function mutateState(mutator: (state: any) => void): void {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  mutator(state);
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  runtime = openRuntime();
}

const allowedTask = queueAndClaim(action("allowed"));
const allowedResult = runtime.attemptExecution({ taskId: allowedTask });
assert.equal(allowedResult.status, "completed", "claimed allowed task should execute internally");
assert.deepEqual(allowedResult.task?.result, { operation: "analyse_text", output: { characters: 30, words: 4, lines: 1 } }, "analyse_text result should be deterministic");
assert.equal(allowedResult.task?.status, "completed");
assert.ok(allowedResult.task?.execution?.attemptedAt);
assert.ok(allowedResult.task?.completedAt);
assert.equal(runtime.attemptExecution({ taskId: allowedTask }).status, "rejected", "completed task cannot execute twice");

const approvalAction = action("approved", { actionType: "publish", capability: "publication", target: "external channel", scope: "external", impactLevel: "high", operation: "score_opportunity", operationInput: { audienceValue: 80, potential: 70, timing: 60, evidence: 50, novaraFit: 90, differentiation: 40, feasibility: 80, learningValue: 100 } });
const approvedTask = queueAndClaim(approvalAction);
assert.equal(runtime.attemptExecution({ taskId: approvedTask }).status, "completed", "matching approved approval should authorize bounded execution");

const queuedAction = action("queued");
runtime.evaluateAction(queuedAction);
const queuedHandoff = runtime.handoffTask({ actionId: queuedAction.actionId, taskId: "task-queued" });
assert.equal(runtime.attemptExecution({ taskId: queuedHandoff.task!.id }).status, "rejected", "queued task cannot execute");
assert.equal(runtime.attemptExecution({ taskId: "missing" }).status, "rejected", "missing task must reject");

const malformedTask = queueAndClaim(action("malformed"));
mutateState((state) => { delete state.tasks.find((task: any) => task.id === malformedTask).claim; });
assert.equal(runtime.attemptExecution({ taskId: malformedTask }).status, "rejected", "malformed claimed task must reject");

const deniedTask = queueAndClaim(action("fresh-denied", { capability: "authority_review" }));
mutateState((state) => { const entry = state.permissionDecisions.find((item: any) => item.action.actionId === "fresh-denied"); entry.action.actionType = "modify_authority"; entry.action.targetAgentId = "EX-SOURCE"; });
assert.equal(runtime.attemptExecution({ taskId: deniedTask }).status, "rejected", "fresh denial must block executor");

const escalationTask = queueAndClaim(action("fresh-escalation", { capability: "authority_review" }));
mutateState((state) => { state.permissionDecisions.find((item: any) => item.action.actionId === "fresh-escalation").action.actionType = "unknown_action"; });
assert.equal(runtime.attemptExecution({ taskId: escalationTask }).status, "rejected", "fresh escalation must block executor");

function approvalBlocked(status: "pending" | "rejected" | "expired") {
  const request = action(`approval-${status}`, { actionType: "publish", capability: "publication", target: "external", scope: "external", impactLevel: "high" });
  runtime.evaluateAction(request);
  const approvalId = runtime.listApprovalRequests().find((approval) => approval.actionId === request.actionId)!.approvalId;
  runtime.approveAction({ approvalId, approverId: "guido" });
  const handoff = runtime.handoffTask({ actionId: request.actionId, approvalId, taskId: `task-${request.actionId}` });
  runtime.claimTask({ taskId: handoff.task!.id, claimingAgentId: "EX-CLAIMER" });
  mutateState((state) => { state.approvalRequests.find((approval: any) => approval.approvalId === approvalId).status = status; });
  assert.equal(runtime.attemptExecution({ taskId: handoff.task!.id }).status, "rejected", `${status} approval must block executor`);
}
approvalBlocked("pending");
approvalBlocked("rejected");
approvalBlocked("expired");

const missingApprovalRequest = action("missing-approval", { actionType: "publish", capability: "publication", target: "external", scope: "external", impactLevel: "high" });
runtime.evaluateAction(missingApprovalRequest);
const missingApprovalId = runtime.listApprovalRequests().find((approval) => approval.actionId === missingApprovalRequest.actionId)!.approvalId;
runtime.approveAction({ approvalId: missingApprovalId, approverId: "guido" });
const missingApprovalHandoff = runtime.handoffTask({ actionId: missingApprovalRequest.actionId, approvalId: missingApprovalId, taskId: "task-missing-approval" });
runtime.claimTask({ taskId: missingApprovalHandoff.task!.id, claimingAgentId: "EX-CLAIMER" });
mutateState((state) => { state.approvalRequests = state.approvalRequests.filter((approval: any) => approval.approvalId !== missingApprovalId); });
assert.equal(runtime.attemptExecution({ taskId: missingApprovalHandoff.task!.id }).status, "rejected", "missing approval must block executor");

const mismatchRequest = action("mismatch", { actionType: "publish", capability: "publication", target: "external", scope: "external", impactLevel: "high" });
runtime.evaluateAction(mismatchRequest);
const mismatchApprovalId = runtime.listApprovalRequests().find((approval) => approval.actionId === mismatchRequest.actionId)!.approvalId;
runtime.approveAction({ approvalId: mismatchApprovalId, approverId: "guido" });
const mismatchHandoff = runtime.handoffTask({ actionId: mismatchRequest.actionId, approvalId: mismatchApprovalId, taskId: "task-mismatch" });
runtime.claimTask({ taskId: mismatchHandoff.task!.id, claimingAgentId: "EX-CLAIMER" });
mutateState((state) => { state.approvalRequests.find((approval: any) => approval.approvalId === mismatchApprovalId).actionId = "other-action"; });
assert.equal(runtime.attemptExecution({ taskId: mismatchHandoff.task!.id }).status, "rejected", "mismatched approval must block executor");

const unknownTask = queueAndClaim(action("unknown-operation", { operation: "unknown_operation" }));
assert.equal(runtime.attemptExecution({ taskId: unknownTask }).status, "rejected", "unknown operation must reject before executor attempt");

const failureTask = queueAndClaim(action("failure", { operation: "analyse_text", operationInput: {} }));
const failure = runtime.attemptExecution({ taskId: failureTask });
assert.equal(failure.status, "failed", "bounded operation failure must persist safely");
assert.equal(failure.task?.status, "failed");
assert.ok(failure.task?.execution?.failedAt);

runtime = openRuntime();
const persisted = JSON.parse(readFileSync(statePath, "utf8"));
assert.equal(persisted.tasks.find((task: any) => task.id === allowedTask).status, "completed", "execution result must persist across reload");
const sourceText = readFileSync(new URL("./execution-attempt-service.ts", import.meta.url), "utf8");
assert.doesNotMatch(sourceText, /node:|fetch\(|child_process|exec\(|spawn\(|process\.|http|https/, "bounded executor source must contain no network, process, or shell access");
const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
for (const event of ["task.execution_attempted", "task.execution_authorized", "task.execution_rejected", "task.execution_completed", "task.execution_failed"]) assert.match(auditLog, new RegExp(event.replace(".", "\\.")));

console.log("Bounded execution attempt tests passed.");