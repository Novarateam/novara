import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "../../../core/agent-runtime/src/agent.ts";
import { AgentRuntime } from "../../../core/agent-runtime/src/runtime.ts";
import { routeHermesRequest } from "./hermes-routing.ts";

const runtime = new AgentRuntime({ storageRoot: mkdtempSync(path.join(tmpdir(), "novara-hermes-routing-")) });
for (const definition of getAgentDefinitions()) {
  runtime.registerAgent(definition);
}

const opportunity = routeHermesRequest(runtime, "Evaluate the current opportunity", "hermes-route-opportunity");
assert.equal(opportunity?.routing.status, "routed", "opportunity requests should route through the registry");
assert.equal(opportunity?.routing.proposal?.capability, "opportunity_analysis", "opportunity routing should use capability matching");
assert.match(opportunity?.answer ?? "", /no specialist was executed automatically/i, "routing must not execute a specialist");

for (const [question, requestId] of [
  ["Research the current market", "hermes-route-research"],
  ["Check platform policy updates", "hermes-route-policy"],
  ["Validate this output for quality", "hermes-route-quality"],
]) {
  const response = routeHermesRequest(runtime, question, requestId);
  assert.equal(response?.routing.status, "no-eligible-agent", `${question} should not execute a planned agent`);
  assert.match(response?.answer ?? "", /no implemented eligible agent/i, `${question} should explain the unavailable capability`);
}

const trend = routeHermesRequest(runtime, "Monitor relevant trends", "hermes-route-trend");
assert.equal(trend?.routing.status, "routed", "Trend Monitor should route through the implemented capability");
assert.equal(trend?.routing.proposal?.capability, "trend_monitoring");
assert.match(trend?.answer ?? "", /no specialist was executed automatically/i, "routing must remain non-executing");

const rejected = routeHermesRequest(runtime, "Assess an unknown operational need", "hermes-route-rejected");
assert.equal(rejected?.routing.status, "rejected", "unclassified work requests should return a typed rejection");
assert.equal(routeHermesRequest(runtime, "What changed?", "hermes-route-briefing"), undefined, "briefing questions must retain existing handling");

console.log("Hermes command routing tests passed.");