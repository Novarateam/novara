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

export type CompanyMemoryType =
  | "objective"
  | "decision"
  | "knowledge"
  | "evidence"
  | "experiment"
  | "learning";

export type CompanyMemoryStatus = "proposed" | "verified" | "superseded";

export interface CompanyMemoryEntry {
  id: string;
  type: CompanyMemoryType;
  content: unknown;
  source: string;
  timestamp: string;
  confidence: number;
  authority: AuthorityLevel;
  status: CompanyMemoryStatus;
}

export interface CompanyState {
  objectives: string[];
  priorities: string[];
  activeWork: string[];
  opportunities: string[];
  risks: string[];
  pendingDecisions: string[];
  lastUpdated: string;
}

export interface AgentExecutionContext {
  memory: CompanyMemoryEntry[];
  state: CompanyState;
}

export interface StoreMemoryRequest {
  entry: CompanyMemoryEntry;
}

export interface StoreMemoryResponse {
  entry: CompanyMemoryEntry;
}
