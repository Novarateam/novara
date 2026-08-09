import { Agent } from "./agent.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentTask,
  CompanyBrief,
  CompanyMemoryEntry,
  CompanyState,
  DirectorDecisionResponse,
  EscalationResponse,
  SpecialistExecutionResponse,
  StoreMemoryRequest,
  StoreMemoryResponse,
} from "./types.ts";

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

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

  private buildContext(): AgentExecutionContext {
    return {
      memory: this.memory.list(),
      state: this.state.getState(),
    };
  }

  private buildContextualTask(task: AgentTask): AgentTask {
    const context = this.buildContext();
    return {
      ...task,
      input:
        typeof task.input === "object" && task.input !== null
          ? { ...(task.input as Record<string, unknown>), context }
          : { context },
    };
  }

  private recordSpecialistEvidence(agentId: string, task: AgentTask, execution: { result: { output?: unknown } }) {
    if (agentId !== "A-002") {
      return;
    }

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
      const recommendationStatus =
        typeof structuredResult === "object" &&
        structuredResult !== null &&
        "recommendationStatus" in structuredResult &&
        (structuredResult as { recommendationStatus?: CompanyMemoryStatus }).recommendationStatus
          ? (structuredResult as { recommendationStatus?: CompanyMemoryStatus }).recommendationStatus
          : "proposed";

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
        status: recommendationStatus,
      };

      this.memory.add(evidenceEntry);

      const supportedByExternalEvidence =
        typeof structuredResult === "object" &&
        structuredResult !== null &&
        "supportedByExternalEvidence" in structuredResult
          ? Boolean((structuredResult as { supportedByExternalEvidence?: boolean }).supportedByExternalEvidence)
          : false;

      const unresolvedQuestions =
        typeof structuredResult === "object" &&
        structuredResult !== null &&
        "unresolvedQuestions" in structuredResult
          ? readStringArray((structuredResult as { unresolvedQuestions?: unknown }).unresolvedQuestions)
          : [];

      const stateUpdate: Partial<CompanyState> = {
        objectives: task.objective ? [task.objective] : [],
        priorities: supportedByExternalEvidence
          ? ["Advance the verified opportunity"]
          : ["Resolve missing evidence for the proposed opportunity"],
        activeWork: supportedByExternalEvidence
          ? ["A-002 opportunity execution"]
          : ["A-002 evidence review"],
        opportunities: structuredResult.title ? [structuredResult.title] : [],
        risks: supportedByExternalEvidence
          ? ["Opportunity requires disciplined execution"]
          : ["Opportunity remains proposed because external evidence is still insufficient"],
        pendingDecisions: unresolvedQuestions.length > 0
          ? unresolvedQuestions
          : supportedByExternalEvidence
            ? ["Confirm execution timing"]
            : ["Whether to pursue the proposed opportunity"],
      };

      this.state.updateState(stateUpdate);
    }
  }

  private executeInternal(agentId: string, task: AgentTask, options?: { autoDelegate?: boolean }) {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const contextualTask = this.buildContextualTask(task);
    const execution = agent.execute(contextualTask);

    if (options?.autoDelegate !== false && agentId === "A-001") {
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
            evidence: Array.isArray(output?.context?.priorOpportunityEvidence)
              ? output?.context?.priorOpportunityEvidence
              : [],
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
              context: this.buildContext(),
            },
          });

          this.recordSpecialistEvidence("A-002", delegatedTask, specialistExecution);

          return {
            ...execution,
            delegatedExecution: specialistExecution,
          };
        }
      }
    }

    if (agentId === "A-002") {
      this.recordSpecialistEvidence(agentId, task, execution);
    }

    return execution;
  }

  execute(agentId: string, task: AgentTask) {
    return this.executeInternal(agentId, task, { autoDelegate: true });
  }

  getCompanyBrief(): CompanyBrief {
    const state = this.state.getState();
    const memoryEntries = this.memory.list();
    const recentMemory = memoryEntries.slice(-3);

    return {
      objective: state.objectives[0] ?? null,
      state,
      memory: memoryEntries,
      recentMemory,
      risks: state.risks,
      opportunities: state.opportunities,
      pendingDecisions: state.pendingDecisions,
      summary: `Objective: ${state.objectives[0] ?? "none"}; active work: ${state.activeWork.join(", ") || "none"}; opportunities: ${state.opportunities.join(", ") || "none"}`,
    };
  }

  requestDirectorDecision(objective: string): DirectorDecisionResponse {
    const execution = this.executeInternal("A-001", {
      id: `director-${Date.now()}`,
      objective,
      input: {
        source: "mcp",
      },
    }, { autoDelegate: false });

    const output = execution.result.output as
      | {
          directorDecision?: {
            objective?: string;
            selectedAgent?: string;
            delegatedTask?: string;
            reason?: string;
          };
        }
      | undefined;

    return {
      objective,
      decision: output?.directorDecision
        ? {
            objective: output.directorDecision.objective ?? objective,
            selectedAgent: output.directorDecision.selectedAgent ?? "",
            delegatedTask: output.directorDecision.delegatedTask ?? "",
            reason: output.directorDecision.reason ?? "",
          }
        : null,
      output: execution.result.output,
      taskId: execution.result.taskId,
    };
  }

  executeSpecialist(agentId: string, task: AgentTask): SpecialistExecutionResponse {
    if (agentId !== "A-002") {
      throw new Error("Only A-002 is currently allowed through the MCP interface.");
    }

    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.definition.authority !== "recommend") {
      throw new Error("Specialist authority is not permitted for MCP execution.");
    }

    const execution = this.executeInternal(agentId, task, { autoDelegate: false });

    return {
      agentId,
      taskId: execution.result.taskId,
      result: execution.result,
    };
  }

  escalate(reason: string): EscalationResponse {
    return {
      escalated: true,
      requiresCEOAttention: true,
      reason,
      status: "escalated",
    };
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
