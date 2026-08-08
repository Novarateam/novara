import { Agent } from "./agent";
import { AgentDefinition, AgentTask } from "./types";

export class AgentRuntime {
  private agents = new Map<string, Agent>();

  registerAgent(definition: AgentDefinition): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent already registered: ${definition.id}`);
    }

    this.agents.set(definition.id, new Agent(definition));
  }

  execute(agentId: string, task: AgentTask) {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return agent.execute(task);
  }

  listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values()).map(
      (agent) => agent.definition
    );
  }
}
