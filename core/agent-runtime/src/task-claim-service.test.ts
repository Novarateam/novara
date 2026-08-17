import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRuntime } from "./runtime.ts";
import type { ActionRequest, AgentDefinition } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-claim-"));
const statePath = path.join(storageRoot, "state.json");

function definition(id: string, capabilities: string[], overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id,
    name: id,
    version: "1.0",
    status: "observed",
    mission: "Claim test agent.",
    description: "Active test-only claim agent.",
    capabilities,
    allowedInputs: ["claim tests"],
    expectedOutputs: ["claimed tasks"],
    authorityLevel: "delegate",
    approvalRequirements: [],
    limitations: ["No execution."],
    declaredPerformanceSignals: [{ id: "claim_compliance", description: "Claims only authorized tasks." }],
    executionState: "implemented",
    ...overrides,
  };
}

const source = definition("CL-SOURCE", ["safe_research", "publication", "authority_review"]);
const claimer = definition("CL-READY", ["safe_research", "publication", "authority_review"]);
const noCapability = definition("CL-NO-CAP", ["other"]);
const inactive = definition("CL-INACTIVE", ["safe_research"], { status: "planned", executionState: "planned" });
const notImplemented = definition("CL-NOT-IMPLEMENTED", ["safe_research"], { executionState: "planned" });
const capacityFull = definition("CL-CAPACITY", ["safe_research"]);
const definitions = [source, claimer, noCapability, inactive, notImplemented, capacityFull];

function openRuntime(): AgentRuntime {
  const runtime = new AgentRuntime({ storageRoot });
  for (const agent of definitions) {
    runtime.registerAgent(agent);
  }
  return runtime;
}

let runtime = openRuntime();

function action(actionId: string, actionType = "research", capability = "safe_research", overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId,
    agentId: "CL-SOURCE",
    actionType,
    capability,
    purpose: `Claim readiness for ${actionId}`,
    target: actionType === "publish" ? "external channel" : "internal workspace",
    scope: actionType === "publish" ? "external" : "company",
    impactLevel: actionType === "publish" ? "high" : "low",
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

function queueAllowed(actionId: string, capability = "safe_research"): string {
  assert.equal(runtime.evaluateAction(action(actionId, "research", capability)).status, "allowed");
  const handoff = runtime.handoffTask({ actionId, taskId: `task-${actionId}` });
  assert.equal(handoff.status, "created");
  return handoff.task!.id;
}

function queueApproved(actionId: string): { taskId: string; approvalId: string } {
  const decision = runtime.evaluateAction(action(actionId, "publish", "publication"));
  assert.equal(decision.status, "approval-required");
  const approvalId = decision.approval!.approvalId;
  assert.equal(runtime.approveAction({ approvalId, approverId: "guido" }).status, "approved");
  const handoff = runtime.handoffTask({ actionId, approvalId, taskId: `task-${actionId}` });
  assert.equal(handoff.status, "created");
  return { taskId: handoff.task!.id, approvalId };
}

function mutateState(mutator: (state: any) => void): void {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  mutator(state);
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  runtime = openRuntime();
}

const allowedTaskId = queueAllowed("allowed");
const allowedClaim = runtime.claimTask({ taskId: allowedTaskId, claimingAgentId: "CL-READY" });
assert.equal(allowedClaim.status, "claimed", "eligible agent should claim allowed task");
assert.equal(allowedClaim.task?.status, "claimed");
assert.equal(allowedClaim.task?.assignedAgentId, "CL-READY");
assert.ok(allowedClaim.task?.claim?.claimedAt);
assert.ok(allowedClaim.task?.claim?.executionReadyAt);
assert.equal(allowedClaim.task?.startedAt, undefined);
assert.equal(allowedClaim.task?.completedAt, undefined);
assert.equal(allowedClaim.task?.result, undefined);
assert.equal(allowedClaim.task?.error, undefined);
assert.equal(runtime.claimTask({ taskId: allowedTaskId, claimingAgentId: "CL-READY" }).status, "rejected", "claimed task cannot be claimed twice");
assert.equal(runtime.claimTask({ taskId: "missing", claimingAgentId: "CL-READY" }).status, "rejected", "missing task must reject");

const approvalTask = queueApproved("approved");
assert.equal(runtime.claimTask({ taskId: approvalTask.taskId, claimingAgentId: "CL-READY" }).status, "claimed", "matching approved approval should claim");

const noCapTask = queueAllowed("no-cap");
assert.equal(runtime.claimTask({ taskId: noCapTask, claimingAgentId: "CL-NO-CAP" }).status, "rejected", "agent without capability must reject");
assert.equal(runtime.claimTask({ taskId: noCapTask, claimingAgentId: "CL-INACTIVE" }).status, "rejected", "inactive agent must reject");
assert.equal(runtime.claimTask({ taskId: noCapTask, claimingAgentId: "CL-NOT-IMPLEMENTED" }).status, "rejected", "unimplemented agent must reject");
assert.equal(runtime.claimTask({ taskId: noCapTask, claimingAgentId: "missing-agent" }).status, "rejected", "missing agent must reject");

const capacityTask = queueAllowed("capacity");
mutateState((state) => {
  state.agents.find((agent: any) => agent.id === "CL-CAPACITY").workload.activeTaskIds = ["already-active"];
  state.agents.find((agent: any) => agent.id === "CL-CAPACITY").workload.queueDepth = 1;
});
assert.equal(runtime.claimTask({ taskId: capacityTask, claimingAgentId: "CL-CAPACITY" }).status, "rejected", "capacity-ineligible agent must reject");

const missingPermissionTask = queueAllowed("missing-permission");
mutateState((state) => { state.permissionDecisions = state.permissionDecisions.filter((entry: any) => entry.action.actionId !== "missing-permission"); });
assert.equal(runtime.claimTask({ taskId: missingPermissionTask, claimingAgentId: "CL-READY" }).status, "rejected", "missing permission evidence must reject");

const malformedTask = queueAllowed("malformed");
mutateState((state) => { state.tasks.find((task: any) => task.id === malformedTask).result = { invalid: true }; });
assert.equal(runtime.claimTask({ taskId: malformedTask, claimingAgentId: "CL-READY" }).status, "rejected", "malformed queued task must reject");

const deniedTask = queueAllowed("fresh-denied", "authority_review");
mutateState((state) => {
  const decision = state.permissionDecisions.find((entry: any) => entry.action.actionId === "fresh-denied");
  decision.action.actionType = "modify_authority";
  decision.action.targetAgentId = "CL-SOURCE";
});
assert.equal(runtime.claimTask({ taskId: deniedTask, claimingAgentId: "CL-READY" }).status, "rejected", "fresh permission denial must block claim");

const escalatedTask = queueAllowed("fresh-escalated", "authority_review");
mutateState((state) => { state.permissionDecisions.find((entry: any) => entry.action.actionId === "fresh-escalated").action.actionType = "unrecognized_action"; });
assert.equal(runtime.claimTask({ taskId: escalatedTask, claimingAgentId: "CL-READY" }).status, "rejected", "fresh escalation must block claim");

function approvalStateRejects(status: "pending" | "rejected" | "expired") {
  const actionId = `approval-${status}`;
  const approval = queueApproved(actionId);
  mutateState((state) => { state.approvalRequests.find((entry: any) => entry.approvalId === approval.approvalId).status = status; });
  assert.equal(runtime.claimTask({ taskId: approval.taskId, claimingAgentId: "CL-READY" }).status, "rejected", `${status} approval must block claim`);
}
approvalStateRejects("pending");
approvalStateRejects("rejected");
approvalStateRejects("expired");

const mismatched = queueApproved("approval-mismatch");
mutateState((state) => { state.approvalRequests.find((entry: any) => entry.approvalId === mismatched.approvalId).actionId = "other-action"; });
assert.equal(runtime.claimTask({ taskId: mismatched.taskId, claimingAgentId: "CL-READY" }).status, "rejected", "mismatched approval must reject");

const persistedTask = queueAllowed("persisted");
assert.equal(runtime.claimTask({ taskId: persistedTask, claimingAgentId: "CL-READY" }).status, "claimed");
runtime = openRuntime();
const persisted = JSON.parse(readFileSync(statePath, "utf8"));
assert.equal(persisted.tasks.find((task: any) => task.id === persistedTask).status, "claimed", "claim must persist after reload");

const auditLog = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
assert.match(auditLog, /task\.claimed/, "successful claim must be audited");
assert.match(auditLog, /task\.execution_ready/, "execution readiness must be audited");
assert.match(auditLog, /task\.claim_rejected/, "rejected claim must be audited");
assert.doesNotMatch(auditLog, /task\.started|task\.completed|task\.failed/, "claim must not produce execution audit events");

console.log("Task claim readiness tests passed.");