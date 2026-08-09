import { AgentRuntime } from "../runtime.ts";
import { getAgentDefinitions } from "../agent.ts";
import { startMcpServer } from "./server.ts";

async function main() {
  const runtime = new AgentRuntime();

  for (const definition of getAgentDefinitions()) {
    runtime.registerAgent(definition);
  }

  await startMcpServer(runtime);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
