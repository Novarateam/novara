import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentResult,
  AgentTask,
  PerformanceEvent,
} from "./types.ts";

export class Agent {
  definition: AgentDefinition;

  constructor(definition: AgentDefinition) {
    this.definition = definition;
  }

  execute(task: AgentTask): {
    result: AgentResult;
    event: PerformanceEvent;
  } {
    const timestamp = new Date().toISOString();
    const context =
      typeof task.input === "object" &&
      task.input !== null &&
      "context" in task.input
        ? (task.input as { context?: AgentExecutionContext }).context
        : undefined;

    const priorOpportunityEvidence = context
      ? context.memory
          .filter(
            (entry) =>
              entry.type === "evidence" ||
              (entry.type === "knowledge" &&
                typeof entry.content === "object" &&
                entry.content !== null &&
                "structuredResult" in entry.content)
          )
          .slice(-5)
          .map((entry) => ({
            id: entry.id,
            type: entry.type,
            status: entry.status,
            source: entry.source,
            confidence: entry.confidence,
          }))
      : [];

    const statusBreakdown = context
      ? {
          proposed: context.memory.filter((entry) => entry.status === "proposed")
            .length,
          verified: context.memory.filter((entry) => entry.status === "verified")
            .length,
          superseded: context.memory.filter((entry) => entry.status === "superseded")
            .length,
        }
      : {
          proposed: 0,
          verified: 0,
          superseded: 0,
        };

    const contextSummary = context
      ? {
          memoryEntries: context.memory.length,
          recentMemory: context.memory.slice(-3).map((entry) => ({
            id: entry.id,
            type: entry.type,
            status: entry.status,
          })),
          stateObjectives: context.state.objectives,
          stateActiveWork: context.state.activeWork,
          stateOpportunities: context.state.opportunities,
          priorOpportunityEvidence,
          statusBreakdown,
        }
      : undefined;

    const output =
      this.definition.id === "A-002"
        ? {
            message: `Agent ${this.definition.name} produced a structured opportunity signal.`,
            objective: task.objective,
            structuredResult: {
              title: "Novara Socials growth sprint",
              summary: "A concise social attention opportunity grounded in the current objective.",
              confidence: 0.82,
              source: task.id,
            },
            input: task.input,
            context: contextSummary,
          }
        : {
            message: `Agent ${this.definition.name} reviewed the current company context and delegated the opportunity task to A-002.`,
            objective: task.objective,
            input: task.input,
            context: contextSummary,
            delegation: {
              target: "A-002",
              focus:
                contextSummary?.stateObjectives?.[0] ?? task.objective,
              usedExistingContext: Boolean(contextSummary),
            },
            learningLoop: contextSummary
              ? {
                  priorOpportunityEvidence,
                  statusBreakdown,
                }
              : undefined,
          };

    const result: AgentResult = {
      taskId: task.id,
      agentId: this.definition.id,
      status: "completed",
      output,
    };

    const event: PerformanceEvent = {
      agentId: this.definition.id,
      taskId: task.id,
      event: "task_completed",
      timestamp,
    };

    return { result, event };
  }
}
