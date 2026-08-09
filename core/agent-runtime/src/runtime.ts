import { Agent } from "./agent.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import type {
  AgentDefinition,
  AgentTask,
  CompanyMemoryEntry,
  CompanyState,
} from "./types.ts";

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

    const execution = agent.execute(task);

    if (agentId === "A-002") {
      const output = execution.result.output as
        | {
            structuredResult?: {
              title?: string;
              summary?: string;
              confidence?: number;
              source?: string;
            };
          }
        | undefined;
      const structuredResult = output?.structuredResult;

      if (structuredResult) {
        const evidenceEntry: CompanyMemoryEntry = {
          id: `mem-${task.id}-${agentId}`,
          type: "evidence",
          content: {
            objective: task.objective,
            structuredResult,
            note:
              "A-002 produced a structured opportunity signal that should be treated as evidence, not verified knowledge.",
          },
          source: `A-002/${task.id}`,
          timestamp: new Date().toISOString(),
          confidence: structuredResult.confidence ?? 0.5,
          authority: "recommend",
          status: "proposed",
        };

        this.memory.add(evidenceEntry);

        const stateUpdate: Partial<CompanyState> = {
          objectives: task.objective ? [task.objective] : [],
          priorities: ["Capture A-002 opportunity signal"],
          activeWork: ["A-002 opportunity discovery"],
          opportunities: structuredResult.title ? [structuredResult.title] : [],
          risks: ["Opportunity remains unverified"],
          pendingDecisions: ["Whether to pursue the proposed opportunity"],
        };

        this.state.updateState(stateUpdate);
      }
    }

    return execution;
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
