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

export interface Department {
  id: string;
  name: string;
  mission: string;
  agentIds: string[];
  goals: string[];
  metrics: Record<string, number | string | null>;
  memoryIds: string[];
  budget: {
    currency: string;
    allocated: number;
    spent: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentProfile {
  id: string;
  name: string;
  version: string;
  status: AgentStatus;
  mission: string;
  departmentId: string | null;
  toolIds: string[];
  memoryScopeIds: string[];
  metrics: Record<string, number | string | null>;
  workload: {
    activeTaskIds: string[];
    queueDepth: number;
  };
  authority: AuthorityLevel;
  limits: {
    maxConcurrentTasks: number;
    maxTaskCost: number | null;
  };
  performance: {
    completedTasks: number;
    failedTasks: number;
    escalatedTasks: number;
  };
  cost: {
    currency: string;
    total: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AgentTask {
  id: string;
  objective: string;
  input?: unknown;
}

export type TaskPriority = "low" | "normal" | "high" | "critical";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "escalated";

export interface TaskRecord {
  id: string;
  objective: string;
  assignedAgentId: string;
  priority: TaskPriority;
  status: TaskStatus;
  input?: unknown;
  result?: unknown;
  error?: string;
  cost: {
    currency: string;
    amount: number;
  };
  evidence: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface MessageEnvelope {
  id: string;
  senderAgentId: string;
  recipientAgentId: string;
  taskId: string;
  type: string;
  priority: TaskPriority;
  payload: unknown;
  createdAt: string;
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

export interface AuditEvent {
  id: string;
  timestamp: string;
  actorId: string;
  taskId?: string;
  type: string;
  message: string;
  payload?: Record<string, unknown>;
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

export type MemoryScopeType = "novara" | "company" | "department" | "agent" | "task";

export interface MemoryScope {
  id: string;
  type: MemoryScopeType;
  targetId: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryScopeBinding {
  id: string;
  memoryEntryId: string;
  scopeId: string;
  createdAt: string;
}

export interface PermissionPolicy {
  id: string;
  subjectType: "agent" | "department";
  subjectId: string;
  allowedAuthorities: AuthorityLevel[];
  approvalRequiredFor: AuthorityLevel[];
  riskLevel: "low" | "medium" | "high" | "critical";
  createdAt: string;
  updatedAt: string;
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

export interface DirectorDecision {
  objective: string;
  selectedAgent: string;
  delegatedTask: string;
  reason: string;
}

export interface CompanyBrief {
  objective: string | null;
  state: CompanyState;
  memory: CompanyMemoryEntry[];
  recentMemory: CompanyMemoryEntry[];
  risks: string[];
  opportunities: string[];
  pendingDecisions: string[];
  summary: string;
}

export interface DirectorDecisionResponse {
  objective: string;
  decision: DirectorDecision | null;
  output: unknown;
  taskId: string;
}

export interface SpecialistExecutionResponse {
  agentId: string;
  taskId: string;
  result: AgentResult;
}

export interface EscalationResponse {
  escalated: boolean;
  requiresCEOAttention: boolean;
  reason: string;
  status: "escalated";
}

export interface StoreMemoryRequest {
  entry: CompanyMemoryEntry;
  scopeIds?: string[];
}

export interface StoreMemoryResponse {
  entry: CompanyMemoryEntry;
}

export interface RuntimeSnapshot {
  agents: AgentProfile[];
  departments: Department[];
  tasks: TaskRecord[];
  messages: MessageEnvelope[];
  memory: CompanyMemoryEntry[];
  memoryScopes: MemoryScope[];
  memoryScopeBindings: MemoryScopeBinding[];
  permissionPolicies: PermissionPolicy[];
  companyState: CompanyState;
  updatedAt: string;
}
