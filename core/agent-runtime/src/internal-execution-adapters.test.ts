import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AgentRuntime } from "./runtime.ts";
import { getInternalExecutionAdapter, listInternalExecutionAdapters, runBoundedInternalOperation } from "./internal-execution-adapters.ts";
import type { ActionRequest, AgentDefinition } from "./types.ts";

assert.deepEqual(runBoundedInternalOperation("analyse_text", { text: "one two" }).output, { characters: 7, words: 2, lines: 1 });
assert.deepEqual(runBoundedInternalOperation("score_opportunity", { audienceValue: 100, potential: 100, timing: 100, evidence: 100, novaraFit: 100, differentiation: 100, feasibility: 100, learningValue: 100 }).output, { score: 100, recommendation: "recommend" });
assert.deepEqual(runBoundedInternalOperation("validate_data", { data: { title: "ok" }, requiredFields: ["title"] }).output, { valid: true, missingFields: [] });

assert.equal(runBoundedInternalOperation("analyse_trend", { values: [10, 15, 20] }).output.direction, "rising");
assert.equal(runBoundedInternalOperation("analyse_trend", { values: [20, 15, 10] }).output.direction, "falling");
assert.equal(runBoundedInternalOperation("analyse_trend", { values: [10, 10, 10] }).output.direction, "stable");
assert.equal(runBoundedInternalOperation("analyse_trend", { values: [10] }).output.direction, "insufficient-data");
assert.deepEqual(runBoundedInternalOperation("analyse_trend", { values: [10, 15, 20] }), runBoundedInternalOperation("analyse_trend", { values: [10, 15, 20] }), "trend results must be deterministic");

const policyAdded = runBoundedInternalOperation("check_policy_update", { previous: ["A"], current: ["A", "B"] }).output;
assert.deepEqual(policyAdded.addedItems, ["B"]);
const policyRemoved = runBoundedInternalOperation("check_policy_update", { previous: ["A", "B"], current: ["A"] }).output;
assert.deepEqual(policyRemoved.removedItems, ["B"]);
const policyChanged = runBoundedInternalOperation("check_policy_update", { previous: [{ id: "a", text: "old" }], current: [{ id: "a", text: "new" }] }).output;
assert.equal(policyChanged.meaningfulChanges, true);
assert.equal(policyChanged.importance, "high");
assert.equal(runBoundedInternalOperation("check_policy_update", { previous: ["A"], current: ["A"] }).output.meaningfulChanges, false);

assert.equal(runBoundedInternalOperation("quality_check", { data: {}, requiredFields: ["title"] }).output.pass, false);
assert.equal(runBoundedInternalOperation("quality_check", { data: { tags: ["a", "a"] }, uniqueFields: ["tags"] }).output.pass, false);
assert.equal(runBoundedInternalOperation("quality_check", { data: { status: "bad" }, allowedValues: { status: ["good"] } }).output.pass, false);
assert.equal(runBoundedInternalOperation("quality_check", { data: { title: "ok", status: "good", tags: ["a", "b"] }, requiredFields: ["title"], allowedValues: { status: ["good"] }, uniqueFields: ["tags"] }).output.pass, true);

assert.equal(getInternalExecutionAdapter("unknown_operation"), undefined, "unknown operations must not route");
assert.throws(() => runBoundedInternalOperation("unknown_operation", {}), /Unsupported/);
assert.equal(getInternalExecutionAdapter("analyse_trend")?.requiredCapability, "trend_monitoring");
assert.equal(getInternalExecutionAdapter("check_policy_update")?.requiredCapability, "policy_monitoring");
assert.equal(getInternalExecutionAdapter("quality_check")?.requiredCapability, "quality_assurance");
assert.equal(listInternalExecutionAdapters().filter((adapter) => adapter.operation === "analyse_trend").length, 1, "operations must route to one explicit adapter");

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-adapter-mismatch-"));
const runtime = new AgentRuntime({ storageRoot });
const source: AgentDefinition = { id: "AD-SOURCE", name: "source", version: "1", status: "observed", mission: "test", description: "test", capabilities: ["analysis"], allowedInputs: ["input"], expectedOutputs: ["output"], authorityLevel: "delegate", approvalRequirements: [], limitations: ["internal"], declaredPerformanceSignals: [], executionState: "implemented" };
const claimer: AgentDefinition = { ...source, id: "AD-CLAIMER", name: "claimer" };
runtime.registerAgent(source);
runtime.registerAgent(claimer);
const mismatchAction: ActionRequest = { actionId: "adapter-mismatch", agentId: "AD-SOURCE", actionType: "research", capability: "analysis", purpose: "test", target: "internal", scope: "company", impactLevel: "low", requestedAt: new Date().toISOString(), operation: "analyse_trend", operationInput: { values: [1, 2] } };
runtime.evaluateAction(mismatchAction);
const handoff = runtime.handoffTask({ actionId: mismatchAction.actionId, taskId: "adapter-mismatch-task" });
runtime.claimTask({ taskId: handoff.task!.id, claimingAgentId: "AD-CLAIMER" });
assert.equal(runtime.attemptExecution({ taskId: handoff.task!.id }).status, "rejected", "capability mismatch must reject before adapter execution");

const adapterSource = readFileSync(new URL("./internal-execution-adapters.ts", import.meta.url), "utf8");
assert.doesNotMatch(adapterSource, /node:|fetch\(|child_process|exec\(|spawn\(|process\.|http|https|readFile|writeFile/, "adapters must expose no network, process, shell, or filesystem interface");

console.log("Internal execution adapter tests passed.");