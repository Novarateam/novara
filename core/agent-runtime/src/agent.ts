import type {
  AgentDefinition,
  AgentExecutionContext,
  AgentResult,
  AgentTask,
  DirectorDecision,
  PerformanceEvent,
} from "./types.ts";

type OpportunityEvidence = {
  id?: string;
  type?: string;
  status?: string;
  source?: string;
  confidence?: number;
  content?: unknown;
};

type OpportunityAssessment = {
  supportedByExternalEvidence: boolean;
  recommendationStatus: "proposed" | "verified";
  confidence: number;
  summary: string;
  reasons: string[];
  missing: string[];
  evidenceUsed: string[];
};

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function extractOpportunityEvidence(context?: AgentExecutionContext): OpportunityEvidence[] {
  if (!context) {
    return [];
  }

  return context.memory.filter((entry) => {
    if (entry.type !== "evidence" && entry.type !== "knowledge") {
      return false;
    }

    if (typeof entry.source === "string" && entry.source.toLowerCase().includes("metricool")) {
      return true;
    }

    const content = entry.content;
    if (!content || typeof content !== "object") {
      return false;
    }

    const payload = content as Record<string, unknown>;
    const source = payload.source;
    const opportunity = payload.opportunity;
    return (
      (typeof source === "string" && source.toLowerCase().includes("metricool")) ||
      (typeof opportunity === "string" && opportunity.toLowerCase().includes("socials growth sprint"))
    );
  }) as OpportunityEvidence[];
}

function evaluateOpportunityEvidence(evidence: OpportunityEvidence[]): OpportunityAssessment {
  const evidenceUsed = evidence.map((entry) => entry.id ?? entry.source ?? "unknown");
  const evidenceText = evidence
    .map((entry) => JSON.stringify(entry.content ?? {}))
    .join("\n")
    .toLowerCase();

  const hasZeroStateSignals =
    evidenceText.includes("zero followers") ||
    evidenceText.includes("zero posts") ||
    evidenceText.includes("zero content") ||
    evidenceText.includes("no posts") ||
    evidenceText.includes("no scheduled posts");

  const hasBenchmarkOnlySignals =
    evidenceText.includes("best-time") ||
    evidenceText.includes("benchmark") ||
    evidenceText.includes("directional guidance");

  const supportedByExternalEvidence = !hasZeroStateSignals && !hasBenchmarkOnlySignals && evidence.length > 0;

  if (supportedByExternalEvidence) {
    return {
      supportedByExternalEvidence: true,
      recommendationStatus: "verified",
      confidence: 0.78,
      summary: "Metricool evidence supports advancing the opportunity beyond proposal.",
      reasons: ["External evidence shows non-zero activity and audience signal."],
      missing: [],
      evidenceUsed,
    };
  }

  return {
    supportedByExternalEvidence: false,
    recommendationStatus: "proposed",
    confidence: 0.32,
    summary:
      "Metricool evidence does not yet support verification; the opportunity should remain proposed until the account has real content and audience signal.",
    reasons: [
      "Current external evidence shows a zero-state account or benchmark-only guidance rather than measured growth.",
    ],
    missing: [
      "Published content",
      "Non-zero audience baseline",
      "Scheduled content pipeline",
      "Performance data from real posts",
    ],
    evidenceUsed,
  };
}

export function getAgentDefinitions(): AgentDefinition[] {
  return [
    {
      id: "A-001",
      name: "architect",
      version: "0.1",
      status: "planned",
      mission: "Coordinate the initial Novara structure and objective framing.",
      authority: "delegate",
    },
    {
      id: "A-002",
      name: "opportunity",
      version: "0.1",
      status: "observed",
      mission: "Find opportunities to create valuable attention.",
      authority: "recommend",
    },
  ];
}

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
      ? extractOpportunityEvidence(context)
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
        ? (() => {
            const input = (task.input as Record<string, unknown> | undefined) ?? {};
            const inputEvidence = Array.isArray(input.evidence)
              ? (input.evidence as OpportunityEvidence[])
              : [];
            const contextEvidence = extractOpportunityEvidence(context);
            const evidence = inputEvidence.some((entry) => entry.content !== undefined)
              ? inputEvidence
              : contextEvidence;
            const assessment = evaluateOpportunityEvidence(
              evidence.length > 0 ? evidence : contextEvidence,
            );

            return {
              message: `Agent ${this.definition.name} evaluated the available external evidence before forming a recommendation.`,
              objective: task.objective,
              structuredResult: {
                title: "Novara Socials growth sprint",
                summary: assessment.summary,
                confidence: assessment.confidence,
                source: task.id,
                supportedByExternalEvidence: assessment.supportedByExternalEvidence,
                recommendationStatus: assessment.recommendationStatus,
                reasons: assessment.reasons,
                unresolvedQuestions: assessment.missing,
                evidenceUsed: assessment.evidenceUsed,
              },
              input: task.input,
              context: contextSummary,
            };
          })()
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
            directorDecision: {
              objective: task.objective,
              selectedAgent: "A-002",
              delegatedTask:
                priorOpportunityEvidence.length > 0
                  ? `Evaluate the external evidence for: ${task.objective}. Determine whether the opportunity should remain proposed or be verified.`
                  : `Discover an opportunity aligned to: ${task.objective}`,
              reason:
                priorOpportunityEvidence.length > 0
                  ? "Relevant external evidence exists in company context; delegate an evidence-based review before advancing status."
                  : "Use existing company context to prioritize a concrete opportunity signal.",
            } as DirectorDecision,
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
