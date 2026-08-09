import { Agent } from "./agent.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentTask,
  CompanyMemoryEntry,
  CompanyState,
  StoreMemoryRequest,
  StoreMemoryResponse,
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

    const context: AgentExecutionContext = {
      memory: this.memory.list(),
      state: this.state.getState(),
    };

    const contextualTask: AgentTask = {
      ...task,
      input:
        typeof task.input === "object" && task.input !== null
          ? { ...(task.input as Record<string, unknown>), context }
          : { context },
    };

    const execution = agent.execute(contextualTask);

    if (agentId === "A-001") {
      const output = execution.result.output as
        | {
            directorDecision?: {
              selectedAgent?: string;
              delegatedTask?: string;
            };
          }
        | undefined;
      const directorDecision = output?.directorDecision;

      if (directorDecision?.selectedAgent === "A-002") {
        const delegatedTask: AgentTask = {
          id: `${task.id}-delegate`,
          objective: task.objective,
          input: {
            focus: directorDecision.delegatedTask ?? "Opportunity discovery",
            sourceDecision: directorDecision,
          },
        };

        const specialist = this.agents.get("A-002");

        if (specialist) {
          const specialistExecution = specialist.execute({
            ...delegatedTask,
            input: {
              ...(typeof delegatedTask.input === "object" && delegatedTask.input !== null
                ? (delegatedTask.input as Record<string, unknown>)
                : {}),
              context: {
                memory: this.memory.list(),
                state: this.state.getState(),
              },
            },
          });

          const output = specialistExecution.result.output as
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
              id: `mem-${task.id}-A-002`,
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

          return {
            ...execution,
            delegatedExecution: specialistExecution,
          };
        }
      }
    }

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

  storeMemory(request: StoreMemoryRequest): StoreMemoryResponse {
    const entry = this.memory.add(request.entry);
    return { entry };
  }
}
