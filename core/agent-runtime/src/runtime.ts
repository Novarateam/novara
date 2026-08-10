import { Agent } from "./agent.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import {
  FileRuntimeStore,
  RuntimeRepository,
  createStableId,
  createTimestamp,
  type RuntimeStore,
} from "./persistence.ts";
import type {
  AgentProfile,
  AgentDefinition,
  AgentExecutionContext,
  AgentTask,
  CompanyBrief,
  CompanyMemoryEntry,
  CompanyMemoryStatus,
  CompanyState,
  DirectorDecisionResponse,
  EscalationResponse,
  MessageEnvelope,
  PermissionPolicy,
  SpecialistExecutionResponse,
  StoreMemoryRequest,
  StoreMemoryResponse,
  TaskRecord,
  TaskStatus,
} from "./types.ts";

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

export class AgentRuntime {
  private agents = new Map<string, Agent>();
  private readonly memory: CompanyMemory;
  private readonly state: CompanyStateStore;
  private readonly repository: RuntimeRepository;

  constructor(options?: {
    repository?: RuntimeRepository;
    store?: RuntimeStore;
    storageRoot?: string;
  }) {
    if (options?.repository) {
      this.repository = options.repository;
    } else {
      const store = options?.store ?? new FileRuntimeStore(options?.storageRoot);
      this.repository = new RuntimeRepository(store);
    }

    const snapshot = this.repository.getSnapshot();
    this.memory = new CompanyMemory(snapshot.memory, (entries) => {
      for (const entry of entries) {
        this.repository.upsertMemory(entry);
      }
    });
    this.state = new CompanyStateStore(snapshot.companyState, (state) => {
      this.repository.setCompanyState(state);
    });

    this.ensureBaseMemoryScopes();
  }

  private ensureBaseMemoryScopes(): void {
    const timestamp = createTimestamp();
    this.repository.upsertMemoryScope({
      id: "scope-novara",
      type: "novara",
      targetId: "novara",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.repository.upsertMemoryScope({
      id: "scope-company",
      type: "company",
      targetId: "company",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private appendAudit(actorId: string, type: string, message: string, payload?: Record<string, unknown>, taskId?: string): void {
    this.repository.appendAuditEvent({
      actorId,
      taskId,
      type,
      message,
      payload,
    });
  }

  private getPersistedAgentProfile(agentId: string): AgentProfile | undefined {
    return this.repository.getSnapshot().agents.find((agent) => agent.id === agentId);
  }

  private buildAgentProfile(definition: AgentDefinition): AgentProfile {
    const existing = this.getPersistedAgentProfile(definition.id);
    const timestamp = createTimestamp();
    return {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      status: definition.status,
      mission: definition.mission,
      departmentId: existing?.departmentId ?? null,
      toolIds: existing?.toolIds ?? [],
      memoryScopeIds: existing?.memoryScopeIds ?? ["scope-company"],
      metrics: existing?.metrics ?? {},
      workload: existing?.workload ?? {
        activeTaskIds: [],
        queueDepth: 0,
      },
      authority: definition.authority,
      limits: existing?.limits ?? {
        maxConcurrentTasks: 1,
        maxTaskCost: null,
      },
      performance: existing?.performance ?? {
        completedTasks: 0,
        failedTasks: 0,
        escalatedTasks: 0,
      },
      cost: existing?.cost ?? {
        currency: "USD",
        total: 0,
      },
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  }

  private upsertDefaultPermissionPolicy(definition: AgentDefinition): PermissionPolicy {
    const existing = this.repository
      .getSnapshot()
      .permissionPolicies.find((policy) => policy.id === `policy-${definition.id}`);
    const timestamp = createTimestamp();
    const policy: PermissionPolicy = {
      id: `policy-${definition.id}`,
      subjectType: "agent",
      subjectId: definition.id,
      allowedAuthorities: [definition.authority],
      approvalRequiredFor:
        definition.authority === "autonomous" || definition.authority === "delegate"
          ? []
          : ["execute_with_approval", "autonomous", "delegate"],
      riskLevel:
        definition.authority === "delegate" || definition.authority === "autonomous"
          ? "high"
          : "medium",
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    return this.repository.upsertPermissionPolicy(policy);
  }

  private ensureTaskId(task: AgentTask): AgentTask {
    const id = typeof task.id === "string" && task.id.trim().length > 0 ? task.id.trim() : createStableId("task");
    return {
      ...task,
      id,
    };
  }

  private readTaskPriority(task: AgentTask): TaskRecord["priority"] {
    if (typeof task.input === "object" && task.input !== null && "priority" in task.input) {
      const priority = (task.input as { priority?: unknown }).priority;
      if (priority === "low" || priority === "normal" || priority === "high" || priority === "critical") {
        return priority;
      }
    }

    return "normal";
  }

  private buildTaskRecord(agentId: string, task: AgentTask, status: TaskStatus): TaskRecord {
    const existing = this.repository.getSnapshot().tasks.find((entry) => entry.id === task.id);
    const now = createTimestamp();

    return {
      id: task.id,
      objective: task.objective,
      assignedAgentId: agentId,
      priority: existing?.priority ?? this.readTaskPriority(task),
      status,
      input: task.input,
      result: existing?.result,
      error: existing?.error,
      cost: existing?.cost ?? {
        currency: "USD",
        amount: 0,
      },
      evidence: existing?.evidence ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      startedAt: status === "running" ? now : existing?.startedAt,
      completedAt:
        status === "completed" || status === "failed" || status === "escalated"
          ? now
          : existing?.completedAt,
    };
  }

  private updateTaskRecord(agentId: string, task: AgentTask, status: TaskStatus, patch?: Partial<TaskRecord>): TaskRecord {
    const base = this.buildTaskRecord(agentId, task, status);
    const merged: TaskRecord = {
      ...base,
      ...patch,
      updatedAt: createTimestamp(),
      startedAt: status === "running" ? base.startedAt ?? createTimestamp() : base.startedAt,
      completedAt:
        status === "completed" || status === "failed" || status === "escalated"
          ? patch?.completedAt ?? createTimestamp()
          : base.completedAt,
    };
    return this.repository.upsertTask(merged);
  }

  private updateAgentAfterTask(agentId: string, taskId: string, status: TaskStatus): void {
    const profile = this.getPersistedAgentProfile(agentId);
    if (!profile) {
      return;
    }

    const activeTaskIds = profile.workload.activeTaskIds.filter((id) => id !== taskId);
    const performance = { ...profile.performance };

    if (status === "completed") {
      performance.completedTasks += 1;
    } else if (status === "failed") {
      performance.failedTasks += 1;
    } else if (status === "escalated") {
      performance.escalatedTasks += 1;
    }

    this.repository.upsertAgent({
      ...profile,
      workload: {
        activeTaskIds,
        queueDepth: activeTaskIds.length,
      },
      performance,
      updatedAt: createTimestamp(),
    });
  }

  private markAgentTaskRunning(agentId: string, taskId: string): void {
    const profile = this.getPersistedAgentProfile(agentId);
    if (!profile) {
      return;
    }

    const activeTaskIds = profile.workload.activeTaskIds.includes(taskId)
      ? profile.workload.activeTaskIds
      : [...profile.workload.activeTaskIds, taskId];

    this.repository.upsertAgent({
      ...profile,
      workload: {
        activeTaskIds,
        queueDepth: activeTaskIds.length,
      },
      updatedAt: createTimestamp(),
    });
  }

  registerAgent(definition: AgentDefinition): void {
    if (this.agents.has(definition.id)) {
      throw new Error(`Agent already registered: ${definition.id}`);
    }

    this.agents.set(definition.id, new Agent(definition));
    this.repository.upsertAgent(this.buildAgentProfile(definition));
    this.upsertDefaultPermissionPolicy(definition);
    this.appendAudit(definition.id, "agent.registered", `Registered agent ${definition.id}`, {
      authority: definition.authority,
      status: definition.status,
      version: definition.version,
    });
  }

  private buildContext(): AgentExecutionContext {
    return {
      memory: this.memory.list(),
      state: this.state.getState(),
    };
  }

  private buildContextualTask(task: AgentTask): AgentTask {
    const context = this.buildContext();
    return {
      ...task,
      input:
        typeof task.input === "object" && task.input !== null
          ? { ...(task.input as Record<string, unknown>), context }
          : { context },
    };
  }

  private recordSpecialistEvidence(agentId: string, task: AgentTask, execution: { result: { output?: unknown } }) {
    if (agentId !== "A-002") {
      return;
    }

    const output = execution.result.output as
      | {
          structuredResult?: {
            title?: string;
            summary?: string;
            confidence?: number;
            source?: string;
          };
        }
      | undefined;
    const structuredResult = output?.structuredResult;

    if (structuredResult) {
      const recommendationStatus =
        typeof structuredResult === "object" &&
        structuredResult !== null &&
        "recommendationStatus" in structuredResult &&
        (structuredResult as { recommendationStatus?: CompanyMemoryStatus }).recommendationStatus
          ? (structuredResult as { recommendationStatus?: CompanyMemoryStatus }).recommendationStatus
          : "proposed";

      const evidenceEntry: CompanyMemoryEntry = {
        id: `mem-${task.id}-${agentId}`,
        type: "evidence",
        content: {
          objective: task.objective,
          structuredResult,
          note:
            "A-002 produced a structured opportunity signal that should be treated as evidence, not verified knowledge.",
        },
        source: `A-002/${task.id}`,
        timestamp: new Date().toISOString(),
        confidence: structuredResult.confidence ?? 0.5,
        authority: "recommend",
        status: recommendationStatus,
      };

      this.memory.add(evidenceEntry);
      this.repository.upsertMemory(evidenceEntry);
      this.appendAudit(agentId, "memory.evidence_recorded", "Recorded specialist evidence entry.", {
        memoryId: evidenceEntry.id,
        status: evidenceEntry.status,
      }, task.id);

      const supportedByExternalEvidence =
        typeof structuredResult === "object" &&
        structuredResult !== null &&
        "supportedByExternalEvidence" in structuredResult
          ? Boolean((structuredResult as { supportedByExternalEvidence?: boolean }).supportedByExternalEvidence)
          : false;

      const unresolvedQuestions =
        typeof structuredResult === "object" &&
        structuredResult !== null &&
        "unresolvedQuestions" in structuredResult
          ? readStringArray((structuredResult as { unresolvedQuestions?: unknown }).unresolvedQuestions)
          : [];

      const stateUpdate: Partial<CompanyState> = {
        objectives: task.objective ? [task.objective] : [],
        priorities: supportedByExternalEvidence
          ? ["Advance the verified opportunity"]
          : ["Resolve missing evidence for the proposed opportunity"],
        activeWork: supportedByExternalEvidence
          ? ["A-002 opportunity execution"]
          : ["A-002 evidence review"],
        opportunities: structuredResult.title ? [structuredResult.title] : [],
        risks: supportedByExternalEvidence
          ? ["Opportunity requires disciplined execution"]
          : ["Opportunity remains proposed because external evidence is still insufficient"],
        pendingDecisions: unresolvedQuestions.length > 0
          ? unresolvedQuestions
          : supportedByExternalEvidence
            ? ["Confirm execution timing"]
            : ["Whether to pursue the proposed opportunity"],
      };

      this.state.updateState(stateUpdate);
      this.repository.setCompanyState(this.state.getState());
      this.appendAudit(agentId, "state.updated", "Updated company state from specialist evidence.", {
        objective: task.objective,
      }, task.id);
    }
  }

  private executeInternal(agentId: string, task: AgentTask, options?: { autoDelegate?: boolean }) {
    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const safeTask = this.ensureTaskId(task);
    this.updateTaskRecord(agentId, safeTask, "queued");
    this.appendAudit(agentId, "task.queued", "Queued task for execution.", {
      objective: safeTask.objective,
    }, safeTask.id);

    const contextualTask = this.buildContextualTask(safeTask);
    this.updateTaskRecord(agentId, safeTask, "running");
    this.markAgentTaskRunning(agentId, safeTask.id);
    this.appendAudit(agentId, "task.started", "Started task execution.", {
      objective: safeTask.objective,
    }, safeTask.id);

    let execution;
    try {
      execution = agent.execute(contextualTask);
    } catch (error) {
      this.updateTaskRecord(agentId, safeTask, "failed", {
        error: (error as Error).message,
      });
      this.updateAgentAfterTask(agentId, safeTask.id, "failed");
      this.appendAudit(agentId, "task.failed", "Task execution failed.", {
        error: (error as Error).message,
      }, safeTask.id);
      throw error;
    }

    this.updateTaskRecord(agentId, safeTask, execution.result.status, {
      result: execution.result.output,
      error: execution.result.error,
    });
    this.updateAgentAfterTask(agentId, safeTask.id, execution.result.status);
    this.appendAudit(agentId, "task.completed", "Task execution completed.", {
      status: execution.result.status,
    }, safeTask.id);

    if (options?.autoDelegate !== false && agentId === "A-001") {
      const output = execution.result.output as
        | {
            directorDecision?: {
              selectedAgent?: string;
              delegatedTask?: string;
            };
          }
        | undefined;
      const directorDecision = output?.directorDecision;

      if (directorDecision?.selectedAgent === "A-002") {
        const message: MessageEnvelope = {
          id: createStableId("msg"),
          senderAgentId: "A-001",
          recipientAgentId: "A-002",
          taskId: safeTask.id,
          priority: "normal",
          payload: {
            decision: directorDecision,
            objective: safeTask.objective,
          },
          createdAt: createTimestamp(),
        };
        this.repository.upsertMessage(message);
        this.appendAudit("A-001", "message.delegated", "Delegated opportunity task to A-002.", {
          messageId: message.id,
          delegatedTask: directorDecision.delegatedTask,
        }, safeTask.id);

        const delegatedTask: AgentTask = {
          id: `${safeTask.id}-delegate`,
          objective: safeTask.objective,
          input: {
            focus: directorDecision.delegatedTask ?? "Opportunity discovery",
            sourceDecision: directorDecision,
            evidence: Array.isArray(output?.context?.priorOpportunityEvidence)
              ? output?.context?.priorOpportunityEvidence
              : [],
          },
        };

        const specialist = this.agents.get("A-002");

        if (specialist) {
          const specialistExecution = this.executeInternal("A-002", {
            ...delegatedTask,
            input: {
              ...(typeof delegatedTask.input === "object" && delegatedTask.input !== null
                ? (delegatedTask.input as Record<string, unknown>)
                : {}),
              context: this.buildContext(),
            },
          }, { autoDelegate: false });

          return {
            ...execution,
            delegatedExecution: specialistExecution,
          };
        }
      }
    }

    if (agentId === "A-002") {
      this.recordSpecialistEvidence(agentId, safeTask, execution);
    }

    return execution;
  }

  execute(agentId: string, task: AgentTask) {
    return this.executeInternal(agentId, task, { autoDelegate: true });
  }

  getCompanyBrief(): CompanyBrief {
    const state = this.state.getState();
    const memoryEntries = this.memory.list();
    const recentMemory = memoryEntries.slice(-3);

    return {
      objective: state.objectives[0] ?? null,
      state,
      memory: memoryEntries,
      recentMemory,
      risks: state.risks,
      opportunities: state.opportunities,
      pendingDecisions: state.pendingDecisions,
      summary: `Objective: ${state.objectives[0] ?? "none"}; active work: ${state.activeWork.join(", ") || "none"}; opportunities: ${state.opportunities.join(", ") || "none"}`,
    };
  }

  requestDirectorDecision(objective: string): DirectorDecisionResponse {
    this.appendAudit("system", "director.requested", "Director decision requested.", {
      objective,
    });
    const execution = this.executeInternal("A-001", {
      id: createStableId("director"),
      objective,
      input: {
        source: "mcp",
      },
    }, { autoDelegate: false });

    const output = execution.result.output as
      | {
          directorDecision?: {
            objective?: string;
            selectedAgent?: string;
            delegatedTask?: string;
            reason?: string;
          };
        }
      | undefined;

    return {
      objective,
      decision: output?.directorDecision
        ? {
            objective: output.directorDecision.objective ?? objective,
            selectedAgent: output.directorDecision.selectedAgent ?? "",
            delegatedTask: output.directorDecision.delegatedTask ?? "",
            reason: output.directorDecision.reason ?? "",
          }
        : null,
      output: execution.result.output,
      taskId: execution.result.taskId,
    };
  }

  executeSpecialist(agentId: string, task: AgentTask): SpecialistExecutionResponse {
    if (agentId !== "A-002") {
      throw new Error("Only A-002 is currently allowed through the MCP interface.");
    }

    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.definition.authority !== "recommend") {
      throw new Error("Specialist authority is not permitted for MCP execution.");
    }

    const execution = this.executeInternal(agentId, task, { autoDelegate: false });

    return {
      agentId,
      taskId: execution.result.taskId,
      result: execution.result,
    };
  }

  escalate(reason: string): EscalationResponse {
    this.appendAudit("system", "task.escalated", "Escalation requested.", {
      reason,
    });
    return {
      escalated: true,
      requiresCEOAttention: true,
      reason,
      status: "escalated",
    };
  }

  listAgents(): AgentDefinition[] {
    return Array.from(this.agents.values()).map(
      (agent) => agent.definition
    );
  }

  getMemory(): CompanyMemory {
    return this.memory;
  }

  getState(): CompanyStateStore {
    return this.state;
  }

  storeMemory(request: StoreMemoryRequest): StoreMemoryResponse {
    const entry: CompanyMemoryEntry = {
      ...request.entry,
      id: request.entry.id && request.entry.id.trim().length > 0 ? request.entry.id : createStableId("mem"),
      timestamp:
        request.entry.timestamp && request.entry.timestamp.trim().length > 0
          ? request.entry.timestamp
          : createTimestamp(),
    };

    this.memory.add(entry);
    this.repository.upsertMemory(entry);
    this.appendAudit("system", "memory.stored", "Stored memory entry.", {
      memoryId: entry.id,
      type: entry.type,
      status: entry.status,
    });
    return { entry };
  }
}
