import {
  AgentDefinition,
  AgentResult,
  AgentTask,
  PerformanceEvent,
} from "./types";

export class Agent {
  constructor(public readonly definition: AgentDefinition) {}

  execute(task: AgentTask): {
    result: AgentResult;
    event: PerformanceEvent;
  } {
    const timestamp = new Date().toISOString();

    const result: AgentResult = {
      taskId: task.id,
      agentId: this.definition.id,
      status: "completed",
      output: {
        message: `Agent ${this.definition.name} received the task.`,
        objective: task.objective,
      },
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
