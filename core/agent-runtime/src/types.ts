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

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  status: AgentStatus;
  mission: string;
  authority: AuthorityLevel;
}

export interface AgentTask {
  id: string;
  objective: string;
  input?: unknown;
}

export interface AgentResult {
  taskId: string;
  agentId: string;
  status: "completed" | "failed" | "escalated";
  output?: unknown;
  error?: string;
}

export interface PerformanceEvent {
  agentId: string;
  taskId: string;
  event: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}
