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

type ResearchAssessment = {
  recommendationStatus: "supported" | "insufficient evidence" | "contradictory evidence";
  confidence: number;
  summary: string;
  findings: string[];
  limitations: string[];
  sources: string[];
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

function evaluateResearchEvidence(evidence: OpportunityEvidence[]): ResearchAssessment {
  const sources = evidence.map((entry) => entry.source ?? entry.id ?? "unknown");
  const evidenceText = evidence
    .map((entry) => JSON.stringify(entry.content ?? {}))
    .join("\n")
    .toLowerCase();

  const hasContradiction = evidenceText.includes("contradict") || evidenceText.includes("inconsistent") || evidenceText.includes("conflict");
  const hasMeaningfulBaseline = !evidenceText.includes("zero followers") && !evidenceText.includes("zero posts") && !evidenceText.includes("no measurable audience baseline");

  if (hasContradiction) {
    return {
      recommendationStatus: "contradictory evidence",
      confidence: 0.74,
      summary: "The available evidence contains contradictions that must be reconciled before the opportunity can be trusted.",
      findings: ["The evidence set includes conflicting signals that do not yet agree."],
      limitations: ["The current sources do not agree with each other."],
      sources,
    };
  }

  if (hasMeaningfulBaseline) {
    return {
      recommendationStatus: "supported",
      confidence: 0.71,
      summary: "The available evidence is sufficient to support the current opportunity hypothesis.",
      findings: ["External evidence provides a meaningful baseline for comparison."],
      limitations: [],
      sources,
    };
  }

  return {
    recommendationStatus: "insufficient evidence",
    confidence: 0.33,
    summary: "The available Metricool evidence is insufficient to verify the opportunity because the account has no meaningful performance baseline.",
    findings: ["The account appears to be in a zero-state with no meaningful baseline."],
    limitations: ["No published content.", "No measurable audience baseline.", "No performance history from real posts."],
    sources,
  };
}

export function getAgentDefinitions(): AgentDefinition[] {
  return [
    {
      id: "A-001",
      name: "Hermes",
      version: "0.2",
      status: "observed",
      mission: "Coordinate Novara work, preserve oversight, and escalate decisions outside its authority.",
      description: "The bounded conductor between CEO intent, the Novara Brain, and specialist agents.",
      capabilities: ["coordination", "task_routing", "context_synthesis", "escalation"],
      allowedInputs: ["CEO goals", "company context", "agent outputs", "approval decisions"],
      expectedOutputs: ["routing proposals", "delegation requests", "escalations", "clear status updates"],
      authorityLevel: "delegate",
      approvalRequirements: [
        { action: "strategy", required: true, reason: "Strategic decisions remain subject to CEO approval." },
        { action: "external_action", required: true, reason: "Hermes cannot execute external actions directly." },
      ],
      limitations: ["Does not replace specialist agents.", "Does not autonomously change Novara structure or code."],
      declaredPerformanceSignals: [
        { id: "routing_quality", description: "Routes work to an appropriate eligible specialist." },
        { id: "escalation_quality", description: "Escalates when authority or evidence is insufficient." },
      ],
      executionState: "implemented",
    },
    {
      id: "A-002",
      name: "opportunity",
      version: "0.2",
      status: "observed",
      mission: "Find opportunities to create valuable attention.",
      description: "Evaluates available evidence and produces bounded opportunity recommendations.",
      capabilities: ["opportunity_analysis", "opportunity_research", "evidence_evaluation"],
      allowedInputs: ["external evidence", "company memory", "current objectives", "performance context"],
      expectedOutputs: ["opportunity signals", "evidence assessments", "recommendations", "escalations"],
      authorityLevel: "recommend",
      approvalRequirements: [
        { action: "execution", required: true, reason: "Opportunity recommendations require approval before execution." },
        { action: "external_action", required: true, reason: "The agent cannot publish, spend, or mutate external systems." },
      ],
      limitations: ["Does not verify its own recommendations as company truth.", "Does not execute external actions."],
      declaredPerformanceSignals: [
        { id: "evidence_quality", description: "Strength and clarity of supporting evidence." },
        { id: "recommendation_usefulness", description: "Usefulness of recommendations to decision makers." },
      ],
      executionState: "implemented",
    },
    {
      id: "A-012",
      name: "trend",
      version: "0.2",
      status: "observed",
      mission: "Analyse structured internal trend signals and report bounded deterministic intelligence for Novara decisions.",
      description: "Internal-only Trend Monitor for supplied historical trend data. It does not perform external research or external actions.",
      capabilities: ["trend_monitoring", "signal_detection"],
      allowedInputs: ["supplied structured trend values", "optional baseline", "period labels", "company strategy context"],
      expectedOutputs: ["deterministic trend reports", "direction and momentum signals", "confidence and recommendation", "uncertainty notes"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Trend findings are advisory until reviewed." }],
      limitations: ["Uses only data supplied to the runtime.", "No web search, provider access, external research, or external action.", "No strategic decisions."],
      declaredPerformanceSignals: [
        { id: "tasks_received", description: "Trend tasks handed to the agent." },
        { id: "tasks_completed", description: "Trend tasks completed by deterministic internal execution." },
        { id: "tasks_failed_or_rejected", description: "Trend tasks blocked or failed during bounded processing." },
        { id: "processed_values_total", description: "Total supplied trend values processed." },
        { id: "average_trend_confidence", description: "Average deterministic confidence from completed trend results." },
      ],
      executionState: "implemented",
    },
    {
      id: "A-013",
      name: "policy-platform-update",
      version: "0.1",
      status: "planned",
      mission: "Track policy, API, monetisation, and platform-rule changes relevant to Novara.",
      description: "Planned specialist for evidence-backed policy and platform change monitoring.",
      capabilities: ["policy_monitoring", "platform_update_analysis"],
      allowedInputs: ["policy documents", "platform updates", "Novara integrations"],
      expectedOutputs: ["change alerts", "risk summaries", "review requests"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "strategy", required: true, reason: "Policy impacts require human review." }],
      limitations: ["Does not provide legal advice.", "Does not modify integrations or publishing settings."],
      declaredPerformanceSignals: [{ id: "alert_accuracy", description: "Accuracy and timeliness of material change alerts." }],
      executionState: "planned",
    },
    {
      id: "A-003",
      name: "research",
      version: "0.1",
      status: "observed",
      mission: "Turn uncertainty into useful, attributable knowledge.",
      description: "Planned specialist for structured evidence gathering and claim verification.",
      capabilities: ["research", "evidence_verification", "contradiction_analysis"],
      allowedInputs: ["research questions", "source material", "company context"],
      expectedOutputs: ["research briefs", "evidence records", "confidence assessments"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Research conclusions remain recommendations." }],
      limitations: ["Does not make strategic decisions.", "Does not present unsupported claims as verified."],
      declaredPerformanceSignals: [{ id: "claim_accuracy", description: "Accuracy and provenance of research outputs." }],
      executionState: "implemented",
    },
    {
      id: "A-004",
      name: "audience-intelligence",
      version: "0.1",
      status: "planned",
      mission: "Understand audience segments, behavior, and needs from read-only evidence.",
      description: "Specialist for audience signal analysis and segment-level evidence synthesis.",
      capabilities: ["audience_analysis", "audience_behavior_analysis", "audience_signal_synthesis"],
      allowedInputs: ["audience evidence", "read-only performance evidence", "company context"],
      expectedOutputs: ["audience segments", "behavior insights", "needs and signal summaries"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Audience findings remain recommendations until reviewed." }],
      limitations: ["Read-only evidence only.", "Does not publish, schedule, or modify external systems.", "Does not verify opportunities or claims."],
      declaredPerformanceSignals: [{ id: "segment_clarity", description: "Clarity and usefulness of audience segment synthesis." }],
      executionState: "planned",
    },
    {
      id: "A-005",
      name: "strategy-architect",
      version: "0.1",
      status: "planned",
      mission: "Turn validated opportunities and evidence into strategic plans.",
      description: "Strategic planning specialist for positioning, objectives, and channel cadence recommendations.",
      capabilities: ["strategy_planning", "positioning_analysis", "objective_design", "channel_planning"],
      allowedInputs: ["validated opportunity evidence", "strategic context", "read-only performance context"],
      expectedOutputs: ["strategic plans", "positioning options", "objective sets", "channel and cadence recommendations"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Strategy outputs require CEO review before action." }],
      limitations: ["Does not execute strategy.", "Does not mutate external systems.", "Does not verify evidence on its own."],
      declaredPerformanceSignals: [{ id: "plan_quality", description: "Practicality and evidence alignment of strategic plans." }],
      executionState: "planned",
    },
    {
      id: "A-006",
      name: "creative-director",
      version: "0.1",
      status: "planned",
      mission: "Develop creative concepts, messaging, hooks, and campaign direction.",
      description: "Creative specialist for message framing and concept generation.",
      capabilities: ["creative_concepting", "messaging_design", "hook_development", "campaign_direction"],
      allowedInputs: ["approved strategy", "audience evidence", "brand context"],
      expectedOutputs: ["creative concepts", "message frameworks", "hook options", "campaign direction"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Creative direction is advisory until approved." }],
      limitations: ["Does not publish or schedule content.", "Does not mutate external systems.", "Does not bypass brand review."],
      declaredPerformanceSignals: [{ id: "concept_quality", description: "Originality and strategic fit of creative concepts." }],
      executionState: "planned",
    },
    {
      id: "A-007",
      name: "content-production",
      version: "0.1",
      status: "planned",
      mission: "Turn approved strategy and creative direction into production-ready content.",
      description: "Production specialist for drafts, scripts, captions, and briefs.",
      capabilities: ["content_production", "draft_generation", "script_planning", "brief_creation"],
      allowedInputs: ["approved strategy", "approved creative direction", "content requirements"],
      expectedOutputs: ["drafts", "scripts", "captions", "production briefs"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Production outputs require review before use." }],
      limitations: ["No publishing.", "No scheduling.", "No external mutations."],
      declaredPerformanceSignals: [{ id: "draft_readiness", description: "Readiness of produced content for review and refinement." }],
      executionState: "planned",
    },
    {
      id: "A-008",
      name: "quality-validation",
      version: "0.1",
      status: "planned",
      mission: "Review quality, brand consistency, factual accuracy, and compliance risks before distribution.",
      description: "Independent quality and brand specialist for bounded reviews.",
      capabilities: ["quality_assurance", "brand_review", "fact_checking", "compliance_review"],
      allowedInputs: ["agent outputs", "evidence", "quality criteria", "brand context"],
      expectedOutputs: ["validation reports", "challenges", "risk findings", "approval recommendations"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Validation findings do not autonomously block business decisions." }],
      limitations: ["Does not publish or modify work.", "Does not replace human compliance review.", "Does not mutate external systems."],
      declaredPerformanceSignals: [{ id: "defect_detection", description: "Material issues detected before completion." }],
      executionState: "planned",
    },
    {
      id: "A-009",
      name: "distribution",
      version: "0.1",
      status: "planned",
      mission: "Plan distribution, channel selection, scheduling recommendations, and publishing readiness.",
      description: "Distribution planning specialist for readiness and channel strategy.",
      capabilities: ["distribution_planning", "channel_selection", "scheduling_analysis", "publishing_readiness"],
      allowedInputs: ["approved content", "channel context", "distribution constraints"],
      expectedOutputs: ["distribution plans", "channel recommendations", "scheduling guidance", "readiness assessments"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Distribution recommendations require approval before action." }],
      limitations: ["No publishing capability.", "No scheduling capability.", "No external write actions."],
      declaredPerformanceSignals: [{ id: "readiness_quality", description: "Quality of distribution readiness and channel planning." }],
      executionState: "planned",
    },
    {
      id: "A-010",
      name: "performance-growth",
      version: "0.1",
      status: "planned",
      mission: "Analyze performance, identify growth signals, and compare results against objectives using read-only evidence.",
      description: "Performance and growth specialist for Metricool-based analysis and learning recommendations.",
      capabilities: ["performance_analysis", "growth_signal_detection", "objective_comparison", "metricool_evidence_review"],
      allowedInputs: ["Metricool evidence", "performance objectives", "read-only account context"],
      expectedOutputs: ["performance summaries", "growth signals", "objective comparisons", "learning recommendations"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Performance recommendations require review before action." }],
      limitations: ["Read-only Metricool evidence only.", "No publishing or scheduling.", "No external mutations."],
      declaredPerformanceSignals: [{ id: "growth_signal_quality", description: "Usefulness of growth insights and performance comparisons." }],
      executionState: "planned",
    },
    {
      id: "A-011",
      name: "finance-commercial-intelligence",
      version: "0.1",
      status: "planned",
      mission: "Analyze revenue, economics, and commercial signals from read-only RevenueCat evidence.",
      description: "Commercial intelligence specialist for RevenueCat evidence review and recommendation.",
      capabilities: ["commercial_analysis", "revenue_analysis", "subscription_signal_analysis", "revenuecat_evidence_review"],
      allowedInputs: ["RevenueCat evidence", "commercial performance context", "read-only subscription data"],
      expectedOutputs: ["commercial intelligence briefs", "revenue findings", "subscription signals", "recommendations"],
      authorityLevel: "recommend",
      approvalRequirements: [{ action: "execution", required: true, reason: "Commercial analysis remains advisory until reviewed." }],
      limitations: ["Uses only read-only RevenueCat evidence.", "Does not modify commercial systems.", "Does not use the unclear RevenueCat tool."],
      declaredPerformanceSignals: [{ id: "commercial_insight_quality", description: "Clarity and usefulness of commercial intelligence." }],
      executionState: "planned",
    },
    {
      id: "A-014",
      name: "content",
      version: "0.1",
      status: "observed",
      mission: "Analyze supplied content and produce a structured social-media post proposal for human review.",
      description: "AI-backed specialist that turns a supplied piece of content into a bounded, human-reviewable post proposal.",
      capabilities: ["content_analysis"],
      allowedInputs: ["supplied content text", "task objective"],
      expectedOutputs: ["structured post proposal", "confidence and reasoning", "human review flag"],
      authorityLevel: "recommend",
      approvalRequirements: [
        { action: "execution", required: true, reason: "Content proposals require human review before any execution." },
        { action: "external_action", required: true, reason: "The agent cannot publish, schedule, or mutate external systems." },
      ],
      limitations: ["Does not publish or schedule content.", "Does not verify its own proposal as company truth.", "Requires human review before any action is taken."],
      declaredPerformanceSignals: [
        { id: "proposal_quality", description: "Usefulness and structure of generated post proposals." },
        { id: "provider_reliability", description: "Successful AI provider calls versus failures." },
      ],
      executionState: "implemented",
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
      this.definition.id === "A-003"
        ? (() => {
            const input = (task.input as Record<string, unknown> | undefined) ?? {};
            const inputEvidence = Array.isArray(input.evidence)
              ? (input.evidence as OpportunityEvidence[])
              : [];
            const contextEvidence = extractOpportunityEvidence(context);
            const evidence = inputEvidence.some((entry) => entry.content !== undefined)
              ? inputEvidence
              : contextEvidence;
            const assessment = evaluateResearchEvidence(evidence.length > 0 ? evidence : contextEvidence);

            return {
              message: `Agent ${this.definition.name} gathered and structured the available evidence for review.`,
              objective: task.objective,
              structuredResult: {
                title: "Novara Socials growth sprint",
                summary: assessment.summary,
                confidence: assessment.confidence,
                source: task.id,
                recommendationStatus: assessment.recommendationStatus,
                findings: assessment.findings,
                limitations: assessment.limitations,
                sources: assessment.sources,
              },
              input: task.input,
              context: contextSummary,
            };
          })()
        : this.definition.id === "A-002"
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
            message: `Agent ${this.definition.name} reviewed the current company context and delegated the task to a specialist.`,
            objective: task.objective,
            input: task.input,
            context: contextSummary,
            delegation: {
              focus:
                contextSummary?.stateObjectives?.[0] ?? task.objective,
              usedExistingContext: Boolean(contextSummary),
            },
            routingRequest: {
              requiredCapability: priorOpportunityEvidence.length > 0 ? "research" : "opportunity_analysis",
              requiresExecution: false,
            },
            learningLoop: contextSummary
              ? {
                  priorOpportunityEvidence,
                  statusBreakdown,
                }
              : undefined,
            directorDecision: {
              objective: task.objective,
              selectedAgent: "",
              delegatedTask:
                priorOpportunityEvidence.length > 0
                  ? `Research the external evidence for: ${task.objective}. Determine whether the opportunity is supported, insufficient, or contradictory.`
                  : `Discover an opportunity aligned to: ${task.objective}`,
              reason:
                priorOpportunityEvidence.length > 0
                  ? "Relevant external evidence exists in company context; delegate an evidence-based research review before advancing status."
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
