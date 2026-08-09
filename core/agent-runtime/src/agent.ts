import type {
  AgentDefinition,
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
          }
        : {
            message: `Agent ${this.definition.name} received the task.`,
            objective: task.objective,
            input: task.input,
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
