import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRuntime } from "./runtime.ts";
import type { ActionRequest, AgentDefinition } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-permission-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) {
  runtime.registerAgent(definition);
}

const permissionTestAgent: AgentDefinition = {
  id: "P-001",
  name: "permission-test-agent",
  version: "1.0",
  status: "observed",
  mission: "Exercise permission policy tests.",
  description: "Active test-only agent with declared capabilities for permission evaluation.",
  capabilities: ["safe_research", "publication", "financial_review", "code_review", "authority_review", "agent_administration", "system_review"],
  allowedInputs: ["test actions"],
  expectedOutputs: ["permission decisions"],
  authorityLevel: "delegate",
  approvalRequirements: [],
  limitations: ["No action is actually executed."],
  declaredPerformanceSignals: [{ id: "policy_compliance", description: "Respects permission decisions." }],
  executionState: "implemented",
};
runtime.registerAgent(permissionTestAgent);

function action(actionId: string, actionType: string, capability: string, overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    actionId,
    agentId: "P-001",
    actionType,
    capability,
    purpose: `Test ${actionType}`,
    target: "test-target",
    scope: "company",
    impactLevel: "low",
    requestedAt: new Date().toISOString(),
    ...overrides,
  };
}

assert.equal(runtime.evaluateAction(action("permission-read", "research", "safe_research")).status, "allowed", "eligible safe research should be allowed");
assert.equal(
  runtime.evaluateAction({ ...action("permission-planned", "research", "research"), agentId: "A-003" }).status,
  "denied",
  "planned agents must be denied",
);

for (const [actionType, capability] of [
  ["publish", "publication"],
  ["spend_money", "financial_review"],
  ["modify_code", "code_review"],
]) {
  const decision = runtime.evaluateAction(action(`permission-${actionType}`, actionType, capability, { impactLevel: "high" }));
  assert.equal(decision.status, "approval-required", `${actionType} must require human approval`);
  assert.equal(decision.approval?.status, "pending", `${actionType} approval must remain pending`);
}

assert.equal(
  runtime.evaluateAction(action("permission-self-authority", "modify_authority", "authority_review", { targetAgentId: "P-001", target: "P-001" })).status,
  "denied",
  "agents must not modify their own authority",
);
assert.equal(
  runtime.evaluateAction(action("permission-create-agent", "manage_agents", "agent_administration", { purpose: "Create and activate a new agent" })).status,
  "denied",
  "agents must not autonomously create or activate agents",
);
assert.equal(
  runtime.evaluateAction(action("permission-engine", "modify_system", "system_review", { target: "permission-engine" })).status,
  "denied",
  "agents must not modify the permission engine",
);
assert.equal(
  runtime.evaluateAction({ ...action("permission-unknown", "research", "safe_research"), agentId: "unknown-agent" }).status,
  "denied",
  "unregistered agents must be denied",
);

const approvals = runtime.listApprovalRequests();
assert.equal(approvals.length, 3, "approval-required actions must create persisted pending approval records");
assert.ok(approvals.every((approval) => approval.status === "pending"), "no approval record may be auto-approved");
const restoredRuntime = new AgentRuntime({ storageRoot });
assert.equal(restoredRuntime.listApprovalRequests().length, 3, "pending approvals must survive runtime reload");

console.log("Permission engine tests passed.");