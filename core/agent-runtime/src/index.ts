import { AgentRuntime } from "./runtime.ts";

const runtime = new AgentRuntime();
const memory = runtime.getMemory();
const stateStore = runtime.getState();

runtime.registerAgent({
  id: "A-001",
  name: "architect",
  version: "0.1",
  status: "planned",
  mission: "Coordinate the initial Novara structure and objective framing.",
  authority: "delegate",
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

const a002Result = a001Result.delegatedExecution
  ? a001Result.delegatedExecution
  : runtime.execute("A-002", {
      id: "TASK-002",
      objective,
      input: {
        focus: "Opportunity discovery",
      },
    });

runtime.storeMemory({
  entry: {
    id: "mem-verified-knowledge",
    type: "knowledge",
    content: {
      note: "A verified opportunity pattern is now available for later coordination.",
    },
    source: "runtime/demo",
    timestamp: new Date().toISOString(),
    confidence: 0.95,
    authority: "recommend",
    status: "verified",
  },
});

runtime.storeMemory({
  entry: {
    id: "mem-superseded-evidence",
    type: "evidence",
    content: {
      note: "A superseded opportunity signal should be treated as historical context.",
    },
    source: "runtime/demo",
    timestamp: new Date().toISOString(),
    confidence: 0.35,
    authority: "recommend",
    status: "superseded",
  },
});

const a001FollowUpResult = runtime.execute("A-001", {
  id: "TASK-003",
  objective,
  input: {
    focus: "Review prior opportunity evidence",
  },
});

const opportunitySignal = (a002Result.result.output as { structuredResult?: { title?: string; summary?: string; confidence?: number; source?: string } })?.structuredResult;

console.log("\n--- NOVARA AGENT RUNTIME TEST ---\n");
console.log("Registered agents:");
console.log(runtime.listAgents());

const stored = runtime.storeMemory({
  entry: {
    id: "mem-runtime-store",
    type: "learning",
    content: {
      note: "Runtime memory store capability is available.",
    },
    source: "runtime/demo",
    timestamp: new Date().toISOString(),
    confidence: 0.9,
    authority: "recommend",
    status: "proposed",
  },
});

console.log("\nStored memory via runtime capability:");
console.log(stored.entry);
console.log("\nA-001 result:");
console.log(a001Result.result);
console.log("\nA-002 result:");
console.log(a002Result.result);
console.log("\nA-001 follow-up result:");
console.log(a001FollowUpResult.result);
console.log("\n--- COMPANY MEMORY ---");
console.log(memory.list());
console.log("\n--- COMPANY STATE ---");
console.log(stateStore.getState());
console.log("\n--- VERIFICATION DEMO ---");
const createdEntry = memory.list()[0];
const retrieved = createdEntry ? memory.get(createdEntry.id) : undefined;
console.log("memory created/retrieved:", Boolean(retrieved));

try {
  memory.add({
    ...createdEntry,
    id: "invalid-conf",
    confidence: 1.2,
  });
} catch (error) {
  console.log("invalid confidence rejected:", (error as Error).message);
}

console.log("company state updated:", stateStore.getState().lastUpdated !== undefined);
console.log("existing A-001/A-002 execution still works:", Boolean(a001Result.result && a002Result.result));
console.log("\n--- TEST COMPLETE ---\n");
