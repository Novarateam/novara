import { AgentRuntime } from "./runtime";

const runtime = new AgentRuntime();

runtime.registerAgent({
  id: "A-002",
  name: "opportunity",
  version: "0.1",
  status: "observed",
  mission: "Find opportunities to create valuable attention.",
  authority: "recommend",
});

const result = runtime.execute("A-002", {
  id: "TASK-001",
  objective:
    "Find an opportunity to create valuable attention for Novara Socials.",
});

console.log("\n--- NOVARA AGENT RUNTIME TEST ---\n");

console.log("Registered agents:");
console.log(runtime.listAgents());

console.log("\nResult:");
console.log(result.result);

console.log("\nPerformance event:");
console.log(result.event);

console.log("\n--- TEST COMPLETE ---\n");
