import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRuntime } from "./runtime.ts";
import type { ActionRequest } from "./types.ts";

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-trend-agent-"));
const runtime = new AgentRuntime({ storageRoot });
for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

const trend = runtime.listAgents().find((agent) => agent.id === "A-012");
assert.equal(trend?.status, "observed", "Trend Monitor must be active under observation");
assert.equal(trend?.executionState, "implemented", "Trend Monitor must be implemented");
assert.ok(trend?.capabilities.includes("trend_monitoring"));
assert.equal(runtime.requestCoordination({ id: "trend-route", objective: "Analyse internal trend data", requiredCapability: "trend_monitoring" }).proposal?.agentId, "A-012", "routing must select Trend Monitor by capability");

function trendAction(actionId: string, values: unknown[]): ActionRequest {
  return {
    actionId,
    agentId: "A-012",
    actionType: "research",
    capability: "trend_monitoring",
    purpose: "Analyse supplied internal trend signals",
    target: "internal trend dataset",
    scope: "company",
    impactLevel: "low",
    requestedAt: new Date().toISOString(),
    operation: "analyse_trend",
    operationInput: { values },
  };
}

const valid = trendAction("trend-valid", [10, 15, 20, 25]);
assert.equal(runtime.evaluateAction(valid).status, "allowed");
const validHandoff = runtime.handoffTask({ actionId: valid.actionId, taskId: "trend-valid-task" });
assert.equal(validHandoff.status, "created");
assert.equal(runtime.claimTask({ taskId: validHandoff.task!.id, claimingAgentId: "A-012" }).status, "claimed");
const validExecution = runtime.attemptExecution({ taskId: validHandoff.task!.id });
assert.equal(validExecution.status, "completed");
const validOutput = validExecution.task?.result as { output?: Record<string, unknown> };
assert.deepEqual(validOutput.output?.direction, "rising");
assert.deepEqual(validOutput.output?.recommendation, "monitor-and-evaluate");
assert.deepEqual(validOutput.output?.valuesCount, 4);
assert.deepEqual(validOutput.output?.confidence, 0.8);

const unauthorized: ActionRequest = { ...valid, actionId: "trend-unauthorized", capability: "policy_monitoring", operation: "check_policy_update", operationInput: { previous: [], current: [] } };
assert.equal(runtime.evaluateAction(unauthorized).status, "denied", "Trend Monitor cannot use undeclared policy capability");
assert.equal(runtime.handoffTask({ actionId: unauthorized.actionId, taskId: "trend-unauthorized-task" }).status, "rejected");

const malformed = trendAction("trend-malformed", [10, "bad"]);
runtime.evaluateAction(malformed);
const malformedHandoff = runtime.handoffTask({ actionId: malformed.actionId, taskId: "trend-malformed-task" });
runtime.claimTask({ taskId: malformedHandoff.task!.id, claimingAgentId: "A-012" });
const malformedExecution = runtime.attemptExecution({ taskId: malformedHandoff.task!.id });
assert.equal(malformedExecution.status, "failed", "Malformed structured trend input must fail safely");

const snapshot = JSON.parse(readFileSync(path.join(storageRoot, "state.json"), "utf8"));
const profile = snapshot.agents.find((agent: any) => agent.id === "A-012");
assert.equal(profile.metrics.tasksReceived, 2);
assert.equal(profile.metrics.tasksCompleted, 1);
assert.equal(profile.metrics.tasksFailedOrRejected, 1);
assert.equal(profile.metrics.processedValuesTotal, 4);
assert.equal(profile.metrics.averageTrendConfidence, 0.8);
const adapterSource = readFileSync(new URL("./internal-execution-adapters.ts", import.meta.url), "utf8");
assert.doesNotMatch(adapterSource, /node:|fetch\(|child_process|exec\(|spawn\(|process\.|http|https|readFile|writeFile/, "Trend execution must remain internal with no external interface");

console.log("Trend Monitor agent tests passed.");