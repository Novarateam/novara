import { AgentRuntime } from "./runtime.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import type { CompanyMemoryEntry, CompanyState } from "./types.ts";

const runtime = new AgentRuntime();
const memory = new CompanyMemory();
const stateStore = new CompanyStateStore();

runtime.registerAgent({
  id: "A-001",
  name: "architect",
  version: "0.1",
  status: "planned",
  mission: "Coordinate the initial Novara structure and objective framing.",
  authority: "recommend",
});

runtime.registerAgent({
  id: "A-002",
  name: "opportunity",
  version: "0.1",
  status: "observed",
  mission: "Find opportunities to create valuable attention.",
  authority: "recommend",
});

const objective = "Create a durable social attention engine for Novara.";

const a001Result = runtime.execute("A-001", {
  id: "TASK-001",
  objective,
  input: {
    focus: "CEO objective framing",
  },
});

const a002Result = runtime.execute("A-002", {
  id: "TASK-002",
  objective,
  input: {
    focus: "Opportunity discovery",
  },
});

const opportunitySignal = (a002Result.result.output as { structuredResult?: { title?: string; summary?: string; confidence?: number; source?: string } })?.structuredResult;

const evidenceEntry: CompanyMemoryEntry = {
  id: `mem-${Date.now()}`,
  type: "evidence",
  content: {
    objective,
    structuredResult: opportunitySignal,
    note: "A-002 produced a structured opportunity signal that should be treated as evidence, not verified knowledge.",
  },
  source: `A-002/${a002Result.result.taskId}`,
  timestamp: new Date().toISOString(),
  confidence: opportunitySignal?.confidence ?? 0.5,
  authority: "recommend",
  status: "proposed",
};

memory.add(evidenceEntry);

const stateUpdate: Partial<CompanyState> = {
  objectives: [objective],
  priorities: ["Clarify CEO objective", "Capture A-002 opportunity signal"],
  activeWork: ["A-001 objective framing", "A-002 opportunity discovery"],
  opportunities: [opportunitySignal?.title ?? "Structured opportunity signal"],
  risks: ["Opportunity remains unverified"],
  pendingDecisions: ["Whether to pursue the proposed opportunity"],
};

stateStore.updateState(stateUpdate);

console.log("\n--- NOVARA AGENT RUNTIME TEST ---\n");
console.log("Registered agents:");
console.log(runtime.listAgents());
console.log("\nA-001 result:");
console.log(a001Result.result);
console.log("\nA-002 result:");
console.log(a002Result.result);
console.log("\n--- COMPANY MEMORY ---");
console.log(memory.list());
console.log("\n--- COMPANY STATE ---");
console.log(stateStore.getState());
console.log("\n--- VERIFICATION DEMO ---");
const retrieved = memory.get(evidenceEntry.id);
console.log("memory created/retrieved:", Boolean(retrieved));

try {
  memory.add({
    ...evidenceEntry,
    id: "invalid-conf",
    confidence: 1.2,
  });
} catch (error) {
  console.log("invalid confidence rejected:", (error as Error).message);
}

console.log("company state updated:", stateStore.getState().lastUpdated !== undefined);
console.log("existing A-001/A-002 execution still works:", Boolean(a001Result.result && a002Result.result));
console.log("\n--- TEST COMPLETE ---\n");
