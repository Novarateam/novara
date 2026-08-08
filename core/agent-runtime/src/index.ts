import { AgentRuntime } from "./runtime.ts";
import type {
  AgentDefinition,
  AgentResult,
  AgentTask,
  AgentOutput,
  ArchitectOutput,
  OpportunityOutput,
  OpportunityTaskInput,
  SignalContext,
} from "./types.ts";

const runtime = new AgentRuntime();

const agentDefinitions: AgentDefinition[] = [
  {
    id: "A-001",
    name: "architect",
    version: "0.1",
    status: "observed",
    mission: "Coordinate specialist agents and evaluate structured opportunity results.",
    authority: "delegate",
  },
  {
    id: "A-002",
    name: "opportunity",
    version: "0.3",
    status: "designing",
    mission: "Find opportunities to create valuable attention.",
    authority: "recommend",
  },
];

for (const definition of agentDefinitions) {
  runtime.registerAgent(definition);
}

function selectSpecialistAgent(): string {
  const specialist = runtime.listAgents().find((agent) => agent.id === "A-002");

  if (!specialist) {
    throw new Error("No suitable specialist agent found.");
  }

  return specialist.id;
}

function isOpportunityOutput(output: AgentOutput | undefined): output is OpportunityOutput {
  return (
    typeof output === "object" &&
    output !== null &&
    "opportunityId" in output &&
    "status" in output &&
    "recommendedAction" in output &&
    "targetAudience" in output &&
    "score" in output &&
    "confidence" in output &&
    "risks" in output &&
    "rationale" in output
  );
}

function evaluateOpportunityResult(
  result: AgentResult,
  selectedAgentId: string
): ArchitectOutput {
  if (result.status !== "completed") {
    return {
      decision: "ESCALATE",
      reason:
        "The specialist task did not complete successfully and requires higher-level review.",
      selectedAgentId,
      evaluatedTaskId: result.taskId,
    };
  }

  if (!isOpportunityOutput(result.output)) {
    return {
      decision: "REFINE",
      reason:
        "The specialist produced an output that is not a structured opportunity. A refined pass is required.",
      selectedAgentId,
      evaluatedTaskId: result.taskId,
    };
  }

  const requiredFields = [
    result.output.opportunityId,
    result.output.title,
    result.output.description,
    result.output.whyNow,
    result.output.recommendedAction,
    result.output.targetAudience,
    result.output.evidence,
    result.output.risks,
    result.output.rationale,
  ];

  const hasAllRequiredFields = requiredFields.every(
    (field) => typeof field === "string" && field.trim().length > 0
  );

  if (!hasAllRequiredFields) {
    return {
      decision: "REFINE",
      reason:
        "The opportunity structure is present but missing required textual fields, so a refinement is needed.",
      selectedAgentId,
      evaluatedTaskId: result.taskId,
    };
  }

  if (result.output.score < 40 || result.output.confidence < 0.5) {
    return {
      decision: "REFINE",
      reason:
        "The opportunity is structured, but score or confidence is too low. Another refinement pass is required.",
      selectedAgentId,
      evaluatedTaskId: result.taskId,
    };
  }

  return {
    decision: "ACCEPT",
    reason: "The structured opportunity result meets the defined acceptance criteria.",
    selectedAgentId,
    evaluatedTaskId: result.taskId,
  };
}

function createOpportunityTask(
  taskId: string,
  ceoObjective: string,
  signals: SignalContext[]
): AgentTask {
  return {
    id: taskId,
    objective: "Produce a structured opportunity result for the CEO objective.",
    input: {
      ceoObjective,
      signals,
    } as OpportunityTaskInput,
  };
}

function runScenario(
  name: string,
  ceoObjective: string,
  signals: SignalContext[]
) {
  console.log(`\n--- SCENARIO ${name} ---\n`);
  console.log("CEO objective:", ceoObjective);

  const selectedAgentId = selectSpecialistAgent();
  console.log("A-001 selected specialist:", selectedAgentId);

  const opportunityTask = createOpportunityTask(name === "A" ? "TASK-002A" : "TASK-002B", ceoObjective, signals);
  console.log("A-001 created structured AgentTask for A-002:", opportunityTask);

  const { result, event } = runtime.execute(selectedAgentId, opportunityTask);

  console.log("\nAgentRuntime dispatched the task to A-002.");
  console.log("A-002 result:", result);
  console.log("A-002 performance event:", event);

  const architectDecision = evaluateOpportunityResult(result, selectedAgentId);
  console.log("\nA-001 Architect evaluation:", architectDecision);
}

runScenario("Strong Opportunity", "Create a high-impact Instagram reel series for Novara Socials.", [
  {
    id: "S-101",
    category: "short-form video",
    description: "Instagram Reels are gaining rapid audience attention for bite-sized storytelling.",
    importance: 0.95,
    audience: "creative professionals",
    evidence: "Recent platform shifts and audience behavior indicate strong interest in short-form educational content.",
    urgency: 0.92,
    novelty: 0.85,
    feasibility: 0.9,
  },
  {
    id: "S-102",
    category: "audience engagement",
    description: "Creative professionals want practical, actionable insights that can be consumed quickly.",
    importance: 0.88,
    audience: "creative professionals",
    evidence: "Engagement metrics on similar content show strong response to concise, high-value social insights.",
    urgency: 0.9,
    novelty: 0.8,
    feasibility: 0.9,
  },
]);

runScenario("Weak Opportunity", "Explore low-cost social content experiments that may be easy to produce.", [
  {
    id: "S-201",
    category: "generic meme",
    description: "A lightweight meme-style format may attract attention but lacks strategic depth.",
    importance: 0.25,
    audience: "broad social users",
    evidence: "A few low-quality posts briefly trended without sustained audience value.",
    urgency: 0.2,
    novelty: 0.3,
    feasibility: 0.4,
  },
  {
    id: "S-202",
    category: "overused listicle",
    description: "A familiar list-style post format has low differentiation and limited long-term impact.",
    importance: 0.3,
    audience: "general followers",
    evidence: "Similar content has generated modest clicks but little meaningful engagement.",
    urgency: 0.25,
    novelty: 0.2,
    feasibility: 0.35,
  },
]);

runScenario("High Potential / Low Confidence", "Evaluate an innovative multi-platform relationship-building campaign.", [
  {
    id: "S-301",
    category: "interactive experience",
    description: "A new immersive audience experience could unlock high attention if the fit is right.",
    importance: 0.85,
    audience: "early adopters",
    evidence: "Some pilot tests show promise, but the evidence is limited and mixed.",
    urgency: 0.8,
    novelty: 0.9,
    feasibility: 0.45,
  },
  {
    id: "S-302",
    category: "emerging audience segment",
    description: "Targeting a nascent but fast-growing audience may yield outsized value, though fit is uncertain.",
    importance: 0.8,
    audience: "future-focused creators",
    evidence: "A few signals suggest interest, but broader validation is lacking.",
    urgency: 0.75,
    novelty: 0.88,
    feasibility: 0.5,
  },
]);

console.log("\n--- POC COMPLETE ---\n");
