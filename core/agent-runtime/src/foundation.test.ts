import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRegistry, createAgentProfile } from "./agent-registry.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CoordinationService } from "./coordination.ts";
import { DecisionMemory } from "./decision-memory.ts";
import { RuntimeRepository, type RuntimeStore } from "./persistence.ts";
import { AgentRuntime } from "./runtime.ts";
import type { AgentDefinition, AgentProfile, AuditEvent, RuntimeSnapshot } from "./types.ts";

function emptySnapshot(): RuntimeSnapshot {
  return {
    agents: [],
    departments: [],
    tasks: [],
    messages: [],
    memory: [],
    memoryScopes: [],
    memoryScopeBindings: [],
    permissionPolicies: [],
    companyState: {
      objectives: [], priorities: [], activeWork: [], opportunities: [], risks: [], pendingDecisions: [], lastUpdated: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  };
}

class TestStore implements RuntimeStore {
  private snapshot: RuntimeSnapshot = emptySnapshot();
  readonly auditEvents: AuditEvent[] = [];

  loadSnapshot(): RuntimeSnapshot {
    return this.snapshot;
  }

  saveSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    this.snapshot = snapshot;
    return snapshot;
  }

  appendAuditEvent(event: AuditEvent): void {
    this.auditEvents.push(event);
  }
}

function definition(id: string, capability: string, overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id,
    name: id,
    version: "1.0",
    status: "observed",
    mission: "Test agent mission.",
    description: "Test agent description.",
    capabilities: [capability],
    allowedInputs: ["test input"],
    expectedOutputs: ["test output"],
    authorityLevel: "recommend",
    approvalRequirements: [],
    limitations: ["test limitation"],
    declaredPerformanceSignals: [{ id: "quality", description: "Test quality signal." }],
    executionState: "implemented",
    ...overrides,
  };
}

const store = new TestStore();
const repository = new RuntimeRepository(store);
const registry = new AgentRegistry(repository, (agentDefinition, existing) =>
  createAgentProfile(agentDefinition, existing, [`scope-agent-${agentDefinition.id}`, "scope-company"]),
);
const activeAgent = definition("T-001", "research");
const plannedAgent = definition("T-002", "trend_monitoring", { status: "planned", executionState: "planned" });

registry.register(activeAgent);
registry.register(plannedAgent);
assert.equal(registry.get("T-001")?.id, "T-001", "valid registration should be retrievable");
assert.throws(() => registry.register(activeAgent), /already registered/, "duplicate IDs must fail");
assert.throws(() => registry.register({ ...definition("T-003", "research"), description: "" }), /description/, "invalid definitions must fail");
assert.equal(registry.findEligibleCandidates({ requiredCapability: "research" }).length, 1, "matching executable capability should be eligible");
assert.equal(registry.findEligibleCandidates({ requiredCapability: "trend_monitoring" }).length, 0, "planned agents must not be executable candidates");

const coordination = new CoordinationService(registry, () => undefined);
assert.equal(
  coordination.requestRouting({ id: "route-1", objective: "Research a claim", requiredCapability: "research" }).status,
  "routed",
  "coordination should route an eligible capability without agent IDs",
);
assert.equal(
  coordination.requestRouting({ id: "route-2", objective: "Monitor trends", requiredCapability: "trend_monitoring" }).status,
  "no-eligible-agent",
  "coordination should reject unavailable planned capability execution",
);
const approvalAgent = definition("T-004", "controlled_action", {
  authorityLevel: "execute_with_approval",
  approvalRequirements: [{ action: "execution", required: true, reason: "Approval required for test." }],
});
registry.register(approvalAgent);
assert.equal(
  coordination.requestRouting({ id: "route-3", objective: "Perform controlled action", requiredCapability: "controlled_action", requiresExecution: true }).status,
  "approval-required",
  "coordination must preserve approval requirements",
);

const memory = new CompanyMemory();
const decisions = new DecisionMemory(() => memory.list(), (entry) => memory.add(entry));
const storedDecision = decisions.store({
  decision: {
    decisionId: "decision-1",
    title: "Use bounded routing",
    owner: "CEO",
    alternativesConsidered: ["Keep direct routing"],
    rationale: "Preserves extensibility and authority controls.",
    supportingEvidenceIds: ["evidence-1"],
    approvalState: "approved",
    revisitable: true,
  },
  source: "foundation-test",
  authority: "recommend",
});
assert.deepEqual(decisions.get("decision-1"), storedDecision, "structured decisions must persist and be retrievable");
assert.equal(decisions.get("decision-1")?.supportingEvidenceIds[0], "evidence-1", "decision metadata must be retained");

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-foundation-"));
const runtime = new AgentRuntime({ storageRoot });
for (const agentDefinition of getAgentDefinitions()) {
  runtime.registerAgent(agentDefinition);
}
assert.equal(runtime.listAgents().length, 15, "registered planned agents should remain visible in the organization");

runtime.storeMemory({
  entry: {
    id: "metricool-evidence-novara-socials-growth",
    type: "evidence",
    content: {
      source: "Metricool MCP",
      opportunity: "Novara Socials growth sprint",
      summary: "The account has no published posts, no scheduled posts, and no measurable audience baseline yet.",
      signals: ["zero posts", "zero followers", "no scheduled posts"],
    },
    source: "Metricool MCP",
    timestamp: new Date().toISOString(),
    confidence: 0.42,
    authority: "recommend",
    status: "proposed",
  },
});

const objectiveFlow = runtime.runChiefObjectiveFlow("Novara Socials growth sprint");
assert.equal(objectiveFlow.objective, "Novara Socials growth sprint", "the CEO objective should flow through unchanged");
assert.equal(objectiveFlow.delegatedAgentId, "A-003", "Hermes should delegate the evidence-heavy objective to A-003");
assert.equal(objectiveFlow.delegatedAgentName, "research", "the delegated specialist should be identified by role");
assert.ok(objectiveFlow.evidenceUsed.length > 0, "the flow should surface the evidence used by A-002");
assert.equal(objectiveFlow.opportunityStatus, "insufficient evidence", "insufficient evidence should be reported explicitly");
assert.ok(objectiveFlow.pendingDecision, "insufficient evidence should leave a pending decision");
assert.match(objectiveFlow.recommendation, /insufficient/i, "A-003 should explain why the evidence is insufficient");

assert.equal(
  runtime.requestCoordination({ id: "route-4", objective: "Evaluate opportunity", requiredCapability: "opportunity_analysis" }).status,
  "routed",
  "runtime should expose generic Brain coordination",
);
const runtimeDecision = runtime.storeDecision({
  decision: {
    decisionId: "brain-decision-1",
    title: "Keep execution bounded",
    owner: "CEO",
    alternativesConsidered: ["Allow autonomous execution"],
    rationale: "Autonomy must be earned through demonstrated performance.",
    supportingEvidenceIds: [],
    approvalState: "approved",
    revisitable: true,
  },
  source: "foundation-test",
  authority: "recommend",
});
assert.deepEqual(runtime.getBrain().getDecision("brain-decision-1"), runtimeDecision, "Brain must expose persisted decision memory");
assert.equal(
  runtime.execute("A-001", { id: "compatibility-task", objective: "Preserve existing bounded execution" }).result.status,
  "completed",
  "existing runtime execution must remain functional",
);

const legacyStorageRoot = mkdtempSync(path.join(tmpdir(), "novara-legacy-"));
const legacySnapshot = emptySnapshot();
legacySnapshot.agents = [{
  id: "legacy-agent",
  name: "legacy",
  version: "0.1",
  status: "planned",
  mission: "Legacy agent.",
  departmentId: null,
  toolIds: [],
  memoryScopeIds: [],
  metrics: {},
  workload: { activeTaskIds: [], queueDepth: 0 },
  authority: "recommend",
  limits: { maxConcurrentTasks: 1, maxTaskCost: null },
  performance: { completedTasks: 0, failedTasks: 0, escalatedTasks: 0 },
  cost: { currency: "USD", total: 0 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as AgentProfile];
writeFileSync(path.join(legacyStorageRoot, "state.json"), JSON.stringify({ version: 1, ...legacySnapshot }), "utf8");
const legacyRuntime = new AgentRuntime({ storageRoot: legacyStorageRoot });
legacyRuntime.registerAgent(definition("legacy-agent", "research"));
assert.equal(legacyRuntime.listAgents()[0]?.description, "Test agent description.", "legacy snapshots must load and accept an expanded definition");

console.log("Novara Brain foundation tests passed.");