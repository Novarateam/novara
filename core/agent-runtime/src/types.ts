export type AgentStatus =
  | "planned"
  | "designing"
  | "training"
  | "observed"
  | "trusted"
  | "autonomous"
  | "delegated"
  | "review"
  | "retired";

export type AuthorityLevel =
  | "observe"
  | "recommend"
  | "execute_with_approval"
  | "autonomous"
  | "delegate";

export type OpportunityStatus = "idea" | "opportunity" | "recommendation";

export type ArchitectDecision = "ACCEPT" | "REFINE" | "ESCALATE";

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  status: AgentStatus;
  mission: string;
  authority: AuthorityLevel;
}

export interface SignalContext {
  id: string;
  category: string;
  description: string;
  importance: number; // 0.0 to 1.0
  audience: string;
  evidence: string;
  urgency: number; // 0.0 to 1.0
  novelty: number; // 0.0 to 1.0
  feasibility: number; // 0.0 to 1.0
}

export interface OpportunityTaskInput {
  ceoObjective: string;
  signals: SignalContext[];
}

export interface AgentTask {
  id: string;
  objective: string;
  input?: unknown;
}

export interface OpportunityOutput {
  opportunityId: string;
  status: OpportunityStatus;
  title: string;
  description: string;
  whyNow: string;
  targetAudience: string;
  evidence: string;
  score: number;
  confidence: number;
  risks: string;
  recommendedAction: string;
  rationale: string;
}

export interface ArchitectOutput {
  decision: ArchitectDecision;
  reason: string;
  selectedAgentId: string;
  evaluatedTaskId: string;
}

export interface GenericOutput {
  message: string;
  objective: string;
}

export type AgentOutput = OpportunityOutput | ArchitectOutput | GenericOutput;

export interface AgentResult {
  taskId: string;
  agentId: string;
  status: "completed" | "failed" | "escalated";
  output?: AgentOutput;
  error?: string;
}

export interface PerformanceEvent {
  agentId: string;
  taskId: string;
  event: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
