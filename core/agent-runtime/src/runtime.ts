import { Agent } from "./agent.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import type { AgentDefinition, AgentTask } from "./types.ts";

export class AgentRuntime {
  private agents = new Map<string, Agent>();
  private readonly memory: CompanyMemory;
  private readonly state: CompanyStateStore;

  constructor() {
    this.memory = new CompanyMemory();
    this.state = new CompanyStateStore();
  }

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

  getMemory(): CompanyMemory {
    return this.memory;
  }

  getState(): CompanyStateStore {
    return this.state;
  }
}
