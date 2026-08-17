import type { AgentRuntime } from "../../../core/agent-runtime/src/runtime.ts";
import type { RoutingResult } from "../../../core/agent-runtime/src/types.ts";

type HermesCapabilityRequest = {
  capability: string;
  label: string;
};

function classifyCapability(question: string): HermesCapabilityRequest | undefined {
  const normalized = question.toLowerCase();

  if (normalized.includes("policy") || normalized.includes("platform update") || normalized.includes("api rule")) {
    return { capability: "policy_monitoring", label: "policy and platform update" };
  }

  if (normalized.includes("trend")) {
    return { capability: "trend_monitoring", label: "trend monitoring" };
  }

  if (normalized.includes("quality") || normalized.includes("validate") || normalized.includes("compliance")) {
    return { capability: "quality_assurance", label: "quality and validation" };
  }

  if (normalized.includes("research") || normalized.includes("investigate") || normalized.includes("evidence")) {
    return { capability: "research", label: "research" };
  }

  if (normalized.includes("opportunit") || normalized.includes("growth sprint") || normalized.includes("evaluate")) {
    return { capability: "opportunity_analysis", label: "opportunity analysis" };
  }

  return undefined;
}

function appearsToRequestWork(question: string): boolean {
  return ["find", "research", "investigate", "evaluate", "monitor", "validate", "check", "assess", "analyze", "analyse", "track", "route"].some((token) =>
    question.toLowerCase().includes(token),
  );
}

function explainRouting(result: RoutingResult, label: string): string {
  switch (result.status) {
    case "routed":
      return `Hermes identified ${label} as the required capability and found an eligible agent. The work has been routed for review; no specialist was executed automatically.`;
    case "approval-required":
      return `Hermes identified ${label}, but the proposed work requires approval before any execution can begin.`;
    case "escalation-required":
      return `Hermes identified ${label}, but the request requires escalation before it can proceed.`;
    case "no-eligible-agent":
      return `Hermes identified ${label}, but no implemented eligible agent is currently available. The registered specialist may still be planned or inactive.`;
    case "rejected":
      return "Hermes could not create a valid routing request from that work request.";
  }
}

export type HermesRoutingResponse = {
  answer: string;
  routing: RoutingResult;
  context: {
    memoryEntries: number;
    objectives: string[];
    pendingDecisions: string[];
  };
};

export function routeHermesRequest(runtime: AgentRuntime, question: string, requestId: string): HermesRoutingResponse | undefined {
  const capabilityRequest = classifyCapability(question);
  if (!capabilityRequest && !appearsToRequestWork(question)) {
    return undefined;
  }

  const knowledge = runtime.getBrain().getCompanyKnowledge();
  const routing = runtime.requestCoordination({
    id: requestId,
    objective: question,
    requiredCapability: capabilityRequest?.capability ?? "",
    requiresExecution: false,
  });
  const label = capabilityRequest?.label ?? "the requested work";

  return {
    answer: explainRouting(routing, label),
    routing,
    context: {
      memoryEntries: knowledge.memory.length,
      objectives: knowledge.state.objectives,
      pendingDecisions: knowledge.state.pendingDecisions,
    },
  };
}