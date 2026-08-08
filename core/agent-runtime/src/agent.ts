import type {
  AgentDefinition,
  AgentResult,
  AgentTask,
  OpportunityOutput,
  OpportunityTaskInput,
  PerformanceEvent,
} from "./types.ts";

function isOpportunityTaskInput(input: unknown): input is OpportunityTaskInput {
  return (
    typeof input === "object" &&
    input !== null &&
    "ceoObjective" in input &&
    Array.isArray((input as OpportunityTaskInput).signals)
  );
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildTargetAudience(signals: OpportunityTaskInput["signals"]): string {
  const audienceScores = new Map<string, number>();
  for (const signal of signals) {
    const score = audienceScores.get(signal.audience) ?? 0;
    audienceScores.set(signal.audience, score + signal.importance);
  }
  return Array.from(audienceScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([audience]) => audience)
    .slice(0, 3)
    .join(", ");
}

function buildEvidence(signals: OpportunityTaskInput["signals"]): string {
  return signals
    .map((signal) => `- ${signal.description} (${signal.evidence})`)
    .join("\n");
}

function buildRisks(signals: OpportunityTaskInput["signals"]): string {
  const concerns = signals
    .filter((signal) => signal.feasibility < 0.6)
    .map(
      (signal) =>
        `- ${signal.category}: ${signal.description} (feasibility ${Math.round(
          signal.feasibility * 100
        )}%)`
    );
  if (concerns.length === 0) {
    return "Execution appears feasible based on the provided signal context.";
  }
  return concerns.join("\n");
}

function buildStatus(score: number): OpportunityOutput["status"] {
  if (score >= 70) {
    return "recommendation";
  }
  if (score >= 45) {
    return "opportunity";
  }
  return "idea";
}

function buildRecommendedAction(score: number, confidence: number): string {
  if (score >= 70 && confidence >= 0.6) {
    return "Proceed to a focused experiment and monitor early signal response carefully.";
  }

  if (score >= 70 && confidence < 0.5) {
    return "Prioritize validation and research before committing to execution.";
  }

  if (score < 45 && confidence < 0.5) {
    return "Deprioritize this opportunity and wait for stronger evidence before pursuing it.";
  }

  return "Run a focused test of the top signal category and validate the audience response quickly.";
}

export class Agent {
  public readonly definition: AgentDefinition;

  constructor(definition: AgentDefinition) {
    this.definition = definition;
  }

  execute(task: AgentTask): {
    result: AgentResult;
    event: PerformanceEvent;
  } {
    const timestamp = new Date().toISOString();
    let output = {
      message: `Agent ${this.definition.name} received the task.`,
      objective: task.objective,
    } as AgentResult["output"];

    if (this.definition.id === "A-002") {
      const input = task.input;
      if (isOpportunityTaskInput(input) && input.signals.length > 0) {
        const topAudience = buildTargetAudience(input.signals);
        const evidence = buildEvidence(input.signals);
        const risks = buildRisks(input.signals);
        const confidence = Math.max(
          0.3,
          Math.min(
            0.95,
            average(input.signals.map((signal) => signal.importance * signal.feasibility))
          )
        );
        const score = Math.round(
          average(input.signals.map((signal) => signal.importance)) * 20 +
            average(input.signals.map((signal) => signal.novelty)) * 20 +
            average(input.signals.map((signal) => signal.urgency)) * 15 +
            average(input.signals.map((signal) => Number(Boolean(signal.evidence)))) * 15 +
            (input.signals.some((signal) => signal.category === "short-form video") ? 10 : 6) +
            average(input.signals.map((signal) => signal.novelty)) * 10 +
            average(input.signals.map((signal) => signal.feasibility)) * 5 +
            average(input.signals.map((signal) => signal.novelty)) * 5
        );

        output = {
          opportunityId: `OPP-${task.id}`,
          status: buildStatus(score),
          title: `Evaluate ${input.signals[0].category} for ${topAudience}`,
          description: `Assess the opportunity implied by the provided signal context against the CEO objective: ${input.ceoObjective}`,
          whyNow: `The signals show urgency and relevance for ${topAudience} in the current environment.`,
          targetAudience: topAudience,
          evidence,
          score,
          confidence: Number(confidence.toFixed(2)),
          risks,
          recommendedAction: buildRecommendedAction(score, Number(confidence.toFixed(2))),
          rationale: `The opportunity was derived from signal importance, novelty, urgency, feasibility, and evidence presence.`,
        };
      } else {
        output = {
          message: `Agent ${this.definition.name} requires structured signal context input to generate an opportunity.`,
          objective: task.objective,
        };
      }
    }

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
