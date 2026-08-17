import { Agent } from "./agent.ts";
import { AgentRegistry, createAgentProfile } from "./agent-registry.ts";
import { ApprovalService } from "./approval-service.ts";
import { NovaraBrain } from "./brain.ts";
import { CompanyMemory } from "./company-memory.ts";
import { CompanyStateStore } from "./company-state.ts";
import { CoordinationService } from "./coordination.ts";
import { DecisionMemory } from "./decision-memory.ts";
import { PermissionEngine } from "./permission-engine.ts";
import { TaskHandoffService } from "./task-handoff-service.ts";
import { TaskClaimService } from "./task-claim-service.ts";
import { ExecutionAttemptService } from "./execution-attempt-service.ts";
import { IntelligenceEvaluationService } from "./intelligence-evaluation-service.ts";
import { TrustPerformanceService } from "./trust-performance-service.ts";
import { HumanTrustReviewService } from "./human-trust-review-service.ts";
import { HumanGovernanceDecisionService } from "./human-governance-decision-service.ts";
import { AgentPromotionService } from "./agent-promotion-service.ts";
import { generateContentProposal, type GenerateContentProposalOptions } from "./content-provider.ts";
import {
  FileRuntimeStore,
  RuntimeRepository,
  createStableId,
  createTimestamp,
  type RuntimeStore,
} from "./persistence.ts";
import type {
  AgentProfile,
  ActionRequest,
  ApprovalDecisionRequest,
  ApprovalDecisionResult,
  AgentDefinition,
  AgentExecutionContext,
  AgentTask,
  CompanyBrief,
  CompanyMemoryEntry,
  CompanyMemoryStatus,
  CompanyState,
  CoordinationRequest,
  ChiefObjectiveFlowResponse,
  DecisionRecord,
  DirectorDecisionResponse,
  EscalationResponse,
  MemoryScope,
  MessageEnvelope,
  ObjectiveEvidenceSummary,
  PermissionPolicy,
  PermissionDecision,
  PersistedPermissionDecision,
  RecordOutcomeRequest,
  RoutingResult,
  SpecialistExecutionResponse,
  StoreDecisionRequest,
  StoreMemoryRequest,
  StoreMemoryResponse,
  TaskPriority,
  TaskHandoffRequest,
  TaskHandoffResult,
  TaskClaimRequest,
  TaskClaimResult,
  ExecutionAttemptRequest,
  ExecutionAttemptResult,
  IntelligenceEvaluationCase,
  IntelligenceEvaluationRequest,
  IntelligenceEvaluationReport,
  AgentTrustPerformanceReport,
  AgentTrustReviewSummary,
  TrustReportLookupResult,
  TrustReportReviewItem,
  HumanGovernanceDecisionRecord,
  HumanGovernanceDecisionResult,
  RecordHumanGovernanceDecisionRequest,
  AgentPromotionResult,
  AgentPromotionProposal,
  AgentPromotionConfirmation,
  AgentPromotionRecord,
  TaskRecord,
  TaskStatus,
} from "./types.ts";

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

// The only agent id currently allowed through the async, AI-backed executeSpecialist branch.
const CONTENT_AGENT_ID = "A-014";

export class AgentRuntime {
  private agents = new Map<string, Agent>();
  private readonly memory: CompanyMemory;
  private readonly state: CompanyStateStore;
  private readonly repository: RuntimeRepository;
  private readonly registry: AgentRegistry;
  private readonly decisions: DecisionMemory;
  private readonly brain: NovaraBrain;

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
    this.registry = new AgentRegistry(this.repository, (definition, existing) =>
      createAgentProfile(definition, existing, [this.ensureAgentScope(definition.id), "scope-company"]),
    );
    this.decisions = new DecisionMemory(
      () => this.memory.list(),
      (entry, scopeIds) => this.persistMemoryEntry(entry, scopeIds ?? ["scope-company"]),
    );
    const coordination = new CoordinationService(this.registry, (type, message, payload, taskId) => {
      this.appendAudit("brain", type, message, payload, taskId);
    });
    const permissions = new PermissionEngine(this.registry, (agentId) =>
      this.repository.getSnapshot().permissionPolicies.find((policy) => policy.subjectType === "agent" && policy.subjectId === agentId),
    );
    const approvals = new ApprovalService((approvalId) => this.repository.getApprovalRequest(approvalId));
    const handoffs = new TaskHandoffService(
      this.registry,
      (actionId) => this.repository.getPermissionDecision(actionId),
      (approvalId) => this.repository.getApprovalRequest(approvalId),
    );
    const claims = new TaskClaimService(
      this.registry,
      (taskId) => this.repository.getTask(taskId),
      (actionId) => this.repository.getPermissionDecision(actionId),
      (action) => permissions.evaluate(action),
      (approvalId) => this.repository.getApprovalRequest(approvalId),
    );
    const executions = new ExecutionAttemptService(
      this.registry,
      (taskId) => this.repository.getTask(taskId),
      (actionId) => this.repository.getPermissionDecision(actionId),
      (action) => permissions.evaluate(action),
      (approvalId) => this.repository.getApprovalRequest(approvalId),
      ({ task, permission, approvalId, operation }) => {
        const payload = {
          taskId: task.id,
          actionId: task.handoff?.actionId,
          approvalId,
          agentId: task.claim?.claimingAgentId,
          operation,
          authorizationResult: permission.status,
        };
        this.appendAudit(task.claim?.claimingAgentId ?? "system", "task.execution_attempted", "Attempting bounded internal execution.", payload, task.id);
        this.appendAudit(task.claim?.claimingAgentId ?? "system", "task.execution_authorized", "Final execution authorization passed.", payload, task.id);
      },
    );
    const evaluations = new IntelligenceEvaluationService((reportId, evaluationCase) => this.executeEvaluationCase(reportId, evaluationCase));
    const trustPerformance = new TrustPerformanceService();
    const humanTrustReview = new HumanTrustReviewService({
      listTrustPerformanceReports: () => this.repository.listTrustPerformanceReports(),
      getTrustPerformanceReport: (reportId) => this.repository.getTrustPerformanceReport(reportId),
    });
    const humanGovernanceDecisions = new HumanGovernanceDecisionService((reportId) => this.repository.getTrustPerformanceReport(reportId));
    const promotions = new AgentPromotionService({
      getAgent: (agentId) => this.getPersistedAgentProfile(agentId),
      getTrustReport: (reportId) => this.repository.getTrustPerformanceReport(reportId),
      getGovernanceDecision: (decisionId) => this.repository.getHumanGovernanceDecision(decisionId),
      getProposal: (proposalId) => this.repository.getAgentPromotionProposal(proposalId),
      getConfirmation: (confirmationId) => this.repository.getAgentPromotionConfirmation(confirmationId),
      getAppliedPromotion: (proposalId) => this.repository.getAgentPromotionByProposal(proposalId),
    });
    this.brain = new NovaraBrain(
      this.memory,
      this.state,
      this.registry,
      this.decisions,
      coordination,
      permissions,
      approvals,
      handoffs,
      claims,
      executions,
      evaluations,
      trustPerformance,
      humanTrustReview,
      humanGovernanceDecisions,
      promotions,
      (agentId, taskId) => this.buildContext(agentId, taskId),
    );
  }

  private ensureBaseMemoryScopes(): void {
    this.ensureMemoryScope("scope-novara", "novara", "novara");
    this.ensureMemoryScope("scope-company", "company", "company");
  }

  private ensureMemoryScope(id: string, type: MemoryScope["type"], targetId: string): MemoryScope {
    const existing = this.repository.getSnapshot().memoryScopes.find((scope) => scope.id === id);
    const timestamp = createTimestamp();
    return this.repository.upsertMemoryScope({
      id,
      type,
      targetId,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
  }

  private ensureAgentScope(agentId: string): string {
    const scopeId = `scope-agent-${agentId}`;
    this.ensureMemoryScope(scopeId, "agent", agentId);
    return scopeId;
  }

  private ensureTaskScope(taskId: string): string {
    const scopeId = `scope-task-${taskId}`;
    this.ensureMemoryScope(scopeId, "task", taskId);
    return scopeId;
  }

  private ensureDepartmentScope(departmentId: string): string {
    const scopeId = `scope-department-${departmentId}`;
    this.ensureMemoryScope(scopeId, "department", departmentId);
    return scopeId;
  }

  private associateMemoryEntryWithScopes(memoryEntryId: string, scopeIds: string[]): void {
    const existingBindings = this.repository.listMemoryScopeBindingsForEntry(memoryEntryId);
    const uniqueScopeIds = scopeIds.filter((scopeId, index, list) => Boolean(scopeId) && list.indexOf(scopeId) === index);

    for (const scopeId of uniqueScopeIds) {
      if (existingBindings.some((binding) => binding.scopeId === scopeId)) {
        continue;
      }

      this.repository.upsertMemoryScopeBinding({
        id: createStableId("memscope"),
        memoryEntryId,
        scopeId,
        createdAt: createTimestamp(),
      });
    }
  }

  private persistMemoryEntry(entry: CompanyMemoryEntry, scopeIds: string[]): CompanyMemoryEntry {
    this.memory.add(entry);
    this.repository.upsertMemory(entry);
    this.associateMemoryEntryWithScopes(entry.id, scopeIds);
    return entry;
  }

  private buildRelevantScopeIds(agentId: string, taskId?: string): string[] {
    const profile = this.getPersistedAgentProfile(agentId);
    const scopeIds: string[] = [];

    if (taskId) {
      scopeIds.push(this.ensureTaskScope(taskId));
    }

    scopeIds.push(this.ensureAgentScope(agentId));

    if (profile?.departmentId) {
      scopeIds.push(this.ensureDepartmentScope(profile.departmentId));
    }

    scopeIds.push("scope-company", "scope-novara");
    return scopeIds.filter((scopeId, index, list) => list.indexOf(scopeId) === index);
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

  private addAgentMetrics(agentId: string, increments: Record<string, number>): void {
    const profile = this.getPersistedAgentProfile(agentId);
    if (!profile) {
      return;
    }

    const metrics = { ...profile.metrics };
    for (const [key, increment] of Object.entries(increments)) {
      const current = typeof metrics[key] === "number" ? metrics[key] : 0;
      metrics[key] = current + increment;
    }

    const confidenceTotal = typeof metrics.trendConfidenceTotal === "number" ? metrics.trendConfidenceTotal : 0;
    const confidenceSamples = typeof metrics.trendConfidenceSamples === "number" ? metrics.trendConfidenceSamples : 0;
    if (confidenceSamples > 0) {
      metrics.averageTrendConfidence = Math.round((confidenceTotal / confidenceSamples) * 1000) / 1000;
    }

    this.repository.upsertAgent({ ...profile, metrics, updatedAt: createTimestamp() });
  }

  private isEvaluationTask(task: TaskRecord): boolean {
    return task.handoff?.sourceRequestId?.startsWith("evaluation:") ?? false;
  }

  private setAgentEvaluationMetrics(agentId: string, report: IntelligenceEvaluationReport): void {
    const profile = this.getPersistedAgentProfile(agentId);
    if (!profile) {
      return;
    }
    const metrics = {
      ...profile.metrics,
      evaluationReportsCompleted: (typeof profile.metrics.evaluationReportsCompleted === "number" ? profile.metrics.evaluationReportsCompleted : 0) + 1,
      evaluationCases: report.summary.totalCases,
      evaluationPassedCases: report.summary.passedCases,
      evaluationAverageScore: report.summary.averageScore,
      evaluationDirectionAccuracy: report.summary.directionAccuracyPercentage,
      evaluationRecommendationAccuracy: report.summary.recommendationAccuracyPercentage,
      evaluationConfidenceQuality: report.summary.confidenceQualityScore,
    };
    this.repository.upsertAgent({ ...profile, metrics, updatedAt: createTimestamp() });
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
      allowedAuthorities: [definition.authorityLevel],
      approvalRequiredFor:
        definition.authorityLevel === "autonomous" || definition.authorityLevel === "delegate"
          ? []
          : ["execute_with_approval", "autonomous", "delegate"],
      riskLevel:
        definition.authorityLevel === "delegate" || definition.authorityLevel === "autonomous"
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

  sendMessage(input: {
    senderAgentId: string;
    recipientAgentId: string;
    taskId: string;
    type: string;
    priority?: TaskPriority;
    payload: unknown;
    id?: string;
    createdAt?: string;
  }): MessageEnvelope {
    const sender = this.agents.get(input.senderAgentId);
    if (!sender) {
      throw new Error(`Message sender is not registered: ${input.senderAgentId}`);
    }

    const recipient = this.agents.get(input.recipientAgentId);
    if (!recipient) {
      throw new Error(`Message recipient is not registered: ${input.recipientAgentId}`);
    }

    const type = String(input.type ?? "").trim();
    if (!type) {
      throw new Error("Message type is required.");
    }

    const message: MessageEnvelope = {
      id: input.id ?? createStableId("msg"),
      senderAgentId: input.senderAgentId,
      recipientAgentId: input.recipientAgentId,
      taskId: input.taskId,
      type,
      priority: input.priority ?? "normal",
      payload: input.payload,
      createdAt: input.createdAt ?? createTimestamp(),
    };

    this.repository.upsertMessage(message);
    this.appendAudit(input.senderAgentId, "message.sent", "Agent message sent.", {
      messageId: message.id,
      messageType: message.type,
      recipientAgentId: message.recipientAgentId,
      priority: message.priority,
    }, message.taskId);

    return message;
  }

  registerAgent(definition: AgentDefinition): void {
    this.registry.register(definition);
    if (definition.executionState === "implemented") {
      this.agents.set(definition.id, new Agent(definition));
    }
    this.upsertDefaultPermissionPolicy(definition);
    this.appendAudit(definition.id, "agent.registered", `Registered agent ${definition.id}`, {
      authority: definition.authorityLevel,
      status: definition.status,
      version: definition.version,
      executionState: definition.executionState,
    });
  }

  private buildContext(agentId: string, taskId?: string): AgentExecutionContext {
    return {
      memory: this.repository.listMemoryByScopeHierarchy(this.buildRelevantScopeIds(agentId, taskId)),
      state: this.state.getState(),
    };
  }

  private summarizeEvidence(evidenceIds: string[]): ObjectiveEvidenceSummary[] {
    const memoryEntries = this.memory.list();

    return evidenceIds
      .map((evidenceId) => {
        const entry = memoryEntries.find((memoryEntry) => memoryEntry.id === evidenceId);
        if (!entry) {
          return {
            id: evidenceId,
            source: "unknown",
            status: "proposed",
            confidence: 0,
            summary: "Evidence entry is no longer available in runtime memory.",
          };
        }

        const content = entry.content;
        const summary = typeof content === "string"
          ? content
          : typeof content === "object" && content !== null && "summary" in content && typeof (content as { summary?: unknown }).summary === "string"
            ? (content as { summary?: string }).summary ?? ""
            : JSON.stringify(content);

        return {
          id: entry.id,
          source: entry.source,
          status: entry.status,
          confidence: entry.confidence,
          summary: summary.length > 240 ? `${summary.slice(0, 237)}...` : summary,
        };
      })
      .filter((entry) => Boolean(entry.id));
  }

  private buildContextualTask(agentId: string, task: AgentTask): AgentTask {
    const context = this.buildContext(agentId, task.id);
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

      this.persistMemoryEntry(evidenceEntry, [this.ensureTaskScope(task.id), "scope-company"]);
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

    this.ensureTaskScope(safeTask.id);
    const contextualTask = this.buildContextualTask(agentId, safeTask);
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

    if (options?.autoDelegate !== false && this.registry.get(agentId)?.authorityLevel === "delegate") {
      const output = execution.result.output as
        | {
            directorDecision?: {
              delegatedTask?: string;
            };
            routingRequest?: {
              requiredCapability?: string;
              requiresExecution?: boolean;
            };
          }
        | undefined;
      const directorDecision = output?.directorDecision;
      const routingRequest = output?.routingRequest;

      if (routingRequest?.requiredCapability) {
        const routing = this.requestCoordination({
          id: `${safeTask.id}-routing`,
          objective: safeTask.objective,
          requiredCapability: routingRequest.requiredCapability,
          requiresExecution: routingRequest.requiresExecution,
          requesterAgentId: agentId,
          taskId: safeTask.id,
        });
        const recipientAgentId = routing.status === "routed" ? routing.proposal?.agentId : undefined;

        if (recipientAgentId) {
        const message = this.sendMessage({
          senderAgentId: agentId,
          recipientAgentId,
          taskId: safeTask.id,
          type: "task.delegation",
          priority: "normal",
          payload: {
            decision: directorDecision,
            objective: safeTask.objective,
          },
        });
        this.appendAudit(agentId, "message.delegated", "Delegated task through generic coordination.", {
          messageId: message.id,
          delegatedTask: directorDecision.delegatedTask,
          recipientAgentId,
          capability: routingRequest.requiredCapability,
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

        const specialist = this.agents.get(recipientAgentId);

        if (specialist) {
          const specialistExecution = this.executeInternal(recipientAgentId, {
            ...delegatedTask,
            input: {
              ...(typeof delegatedTask.input === "object" && delegatedTask.input !== null
                ? (delegatedTask.input as Record<string, unknown>)
                : {}),
              context: this.buildContext(recipientAgentId, delegatedTask.id),
            },
          }, { autoDelegate: false });

          return {
            ...execution,
            delegatedExecution: specialistExecution,
          };
        }
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

  getPersistenceSnapshotUpdatedAt(): string {
    return this.repository.getSnapshot().updatedAt;
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
          routingRequest?: {
            requiredCapability?: string;
            requiresExecution?: boolean;
          };
        }
      | undefined;
      const routingRequest = output?.routingRequest;
      const routing = routingRequest?.requiredCapability
        ? this.requestCoordination({
            id: `${execution.result.taskId}-routing`,
            objective,
            requiredCapability: routingRequest.requiredCapability,
            requiresExecution: routingRequest.requiresExecution,
            requesterAgentId: "A-001",
            taskId: execution.result.taskId,
          })
        : undefined;

    return {
      objective,
      decision: output?.directorDecision
        ? {
            objective: output.directorDecision.objective ?? objective,
            selectedAgent: routing?.proposal?.agentId ?? output.directorDecision.selectedAgent ?? "",
            delegatedTask: output.directorDecision.delegatedTask ?? "",
            reason: output.directorDecision.reason ?? "",
          }
        : null,
      output: execution.result.output,
      taskId: execution.result.taskId,
    };
  }

  runChiefObjectiveFlow(objective: string): ChiefObjectiveFlowResponse {
    const hermesTaskId = createStableId("ceo-objective");
    const execution = this.execute("A-001", {
      id: hermesTaskId,
      objective,
      input: {
        source: "CEO",
      },
    });

    const directorOutput = execution.result.output as
      | {
          directorDecision?: {
            objective?: string;
            selectedAgent?: string;
            delegatedTask?: string;
            reason?: string;
          };
          learningLoop?: {
            priorOpportunityEvidence?: Array<{ id?: string }>;
          };
        }
      | undefined;
    const specialistExecution = execution.delegatedExecution;
    const specialistOutput = specialistExecution?.result.output as
      | {
          structuredResult?: {
            summary?: string;
            recommendationStatus?: CompanyMemoryStatus;
            supportedByExternalEvidence?: boolean;
            unresolvedQuestions?: string[];
            evidenceUsed?: string[];
          };
        }
      | undefined;

    const evidenceIds = specialistOutput?.structuredResult?.evidenceUsed?.length
      ? specialistOutput.structuredResult.evidenceUsed
      : directorOutput?.learningLoop?.priorOpportunityEvidence?.map((entry) => entry.id).filter((id): id is string => Boolean(id)) ?? [];

    const delegatedAgentId = specialistExecution?.result.agentId ?? null;

    return {
      objective,
      hermesTaskId,
      directorDecision: directorOutput?.directorDecision && typeof directorOutput.directorDecision === "object"
        ? {
            objective: directorOutput.directorDecision.objective ?? objective,
            selectedAgent: directorOutput.directorDecision.selectedAgent ?? "A-002",
            delegatedTask: directorOutput.directorDecision.delegatedTask ?? "",
            reason: directorOutput.directorDecision.reason ?? "",
          }
        : {
            objective,
            selectedAgent: "A-002",
            delegatedTask: objective,
            reason: "Hermes delegated the objective to the Director flow.",
          },
      delegatedAgentId,
      delegatedAgentName: delegatedAgentId === "A-002"
        ? "Opportunity Architect"
        : delegatedAgentId
          ? this.agents.get(delegatedAgentId)?.definition.name ?? null
          : null,
      evidenceUsed: this.summarizeEvidence(evidenceIds),
      recommendation: specialistOutput?.structuredResult?.summary ?? "No opportunity recommendation was produced.",
      opportunityStatus: specialistOutput?.structuredResult?.recommendationStatus ?? "proposed",
      pendingDecision: specialistOutput?.structuredResult?.recommendationStatus === "verified"
        ? null
        : specialistOutput?.structuredResult?.unresolvedQuestions?.length
          ? `Pending decision: ${specialistOutput.structuredResult.unresolvedQuestions.join("; ")}`
          : "Pending decision: evidence is insufficient for verification.",
      supportedByExternalEvidence: specialistOutput?.structuredResult?.supportedByExternalEvidence ?? false,
      unresolvedQuestions: specialistOutput?.structuredResult?.unresolvedQuestions ?? [],
    };
  }

  async executeSpecialist(agentId: string, task: AgentTask, options?: { contentProvider?: GenerateContentProposalOptions }): Promise<SpecialistExecutionResponse> {
    if (agentId !== "A-002" && agentId !== CONTENT_AGENT_ID) {
      throw new Error("Only A-002 and the Content Agent are currently allowed through the MCP interface.");
    }

    const agent = this.agents.get(agentId);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.definition.authorityLevel !== "recommend") {
      throw new Error("Specialist authority is not permitted for MCP execution.");
    }

    if (agentId === CONTENT_AGENT_ID) {
      return this.executeContentAgent(task, options?.contentProvider);
    }

    const execution = this.executeInternal(agentId, task, { autoDelegate: false });

    return {
      agentId,
      taskId: execution.result.taskId,
      result: execution.result,
    };
  }

  /**
   * Runs the Content Agent through the same authorized-specialist boundary as A-002
   * (agent must exist, be implemented, and be recommend-authority only), then makes one
   * real AI provider call and persists the resulting proposal as ordinary evidence.
   * Never grants publishing/external-action authority and never falls back to fake output.
   */
  private async executeContentAgent(task: AgentTask, providerOptions?: GenerateContentProposalOptions): Promise<SpecialistExecutionResponse> {
    const agentId = CONTENT_AGENT_ID;
    const safeTask = this.ensureTaskId(task);

    this.updateTaskRecord(agentId, safeTask, "queued");
    this.appendAudit(agentId, "task.queued", "Queued task for execution.", { objective: safeTask.objective }, safeTask.id);
    this.ensureTaskScope(safeTask.id);
    this.updateTaskRecord(agentId, safeTask, "running");
    this.markAgentTaskRunning(agentId, safeTask.id);
    this.appendAudit(agentId, "task.started", "Started task execution.", { objective: safeTask.objective }, safeTask.id);

    const fail = (errorMessage: string): SpecialistExecutionResponse => {
      this.updateTaskRecord(agentId, safeTask, "failed", { error: errorMessage });
      this.updateAgentAfterTask(agentId, safeTask.id, "failed");
      this.appendAudit(agentId, "task.failed", "Task execution failed.", { error: errorMessage }, safeTask.id);
      return {
        agentId,
        taskId: safeTask.id,
        result: { taskId: safeTask.id, agentId, status: "failed", error: errorMessage },
      };
    };

    const input = (safeTask.input as Record<string, unknown> | undefined) ?? {};
    const content = typeof input.content === "string" ? input.content.trim() : "";
    if (!content) {
      return fail("Content Agent requires a non-empty string input.content.");
    }

    let proposal;
    try {
      proposal = await generateContentProposal(content, safeTask.objective, providerOptions);
    } catch (error) {
      return fail((error as Error).message);
    }

    const output = {
      message: "Agent content produced an AI-generated structured post proposal that requires human review.",
      objective: safeTask.objective,
      structuredResult: proposal,
    };

    this.updateTaskRecord(agentId, safeTask, "completed", { result: output });
    this.updateAgentAfterTask(agentId, safeTask.id, "completed");
    this.appendAudit(agentId, "task.completed", "Task execution completed.", { status: "completed" }, safeTask.id);

    const evidenceEntry: CompanyMemoryEntry = {
      id: `mem-${safeTask.id}-${agentId}`,
      type: "evidence",
      content: {
        objective: safeTask.objective,
        structuredResult: proposal,
        note: "Content Agent produced an AI-generated content proposal; it requires human review before any publishing action.",
      },
      source: `${agentId}/${safeTask.id}`,
      timestamp: new Date().toISOString(),
      confidence: proposal.confidence,
      authority: "recommend",
      status: "proposed",
    };
    this.persistMemoryEntry(evidenceEntry, [this.ensureTaskScope(safeTask.id), "scope-company"]);
    this.appendAudit(agentId, "memory.evidence_recorded", "Recorded specialist evidence entry.", {
      memoryId: evidenceEntry.id,
      status: evidenceEntry.status,
    }, safeTask.id);

    return {
      agentId,
      taskId: safeTask.id,
      result: { taskId: safeTask.id, agentId, status: "completed", output },
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
    return this.registry.list();
  }

  getBrain(): NovaraBrain {
    return this.brain;
  }

  requestCoordination(request: CoordinationRequest): RoutingResult {
    return this.brain.requestRouting(request);
  }

  evaluateAction(request: ActionRequest): PermissionDecision {
    const decision = this.brain.evaluateAction(request);
    const persistedDecision: PersistedPermissionDecision = {
      action: decision.action,
      status: decision.status,
      reason: decision.reason,
      evaluatedAt: decision.evaluatedAt,
      approvalId: decision.approval?.approvalId,
    };
    this.repository.upsertPermissionDecision(persistedDecision);
    if (decision.approval) {
      this.repository.upsertApprovalRequest(decision.approval);
    }
    this.appendAudit(request.agentId, "permission.evaluated", "Evaluated action permission.", {
      actionId: request.actionId,
      actionType: request.actionType,
      capability: request.capability,
      scope: request.scope,
      impactLevel: request.impactLevel,
      result: decision.status,
      reason: decision.reason,
      approvalId: decision.approval?.approvalId,
    }, request.taskId);
    return decision;
  }

  listApprovalRequests() {
    return this.repository.getSnapshot().approvalRequests;
  }

  handoffTask(request: Omit<TaskHandoffRequest, "taskId"> & { taskId?: string }): TaskHandoffResult {
    const taskId = request.taskId?.trim() || createStableId("task");
    const result = this.brain.handoffTask({ ...request, taskId });
    if (result.status === "created" && result.task) {
      this.ensureTaskScope(result.task.id);
      this.repository.upsertTask(result.task);
      if (!this.isEvaluationTask(result.task)) {
        this.addAgentMetrics(result.task.assignedAgentId, { tasksReceived: 1 });
      }
      this.appendAudit(result.task.assignedAgentId, "task.created", "Created queued task through permission-gated handoff.", {
        taskId: result.task.id,
        actionId: result.actionId,
        approvalId: result.approvalId,
        agentId: result.task.assignedAgentId,
        permissionDecision: result.task.handoff?.permissionDecision,
      }, result.task.id);
    } else {
      this.appendAudit("system", "task.handoff_rejected", "Rejected permission-gated task handoff.", {
        taskId,
        actionId: result.actionId,
        approvalId: result.approvalId,
        reason: result.reason,
      });
    }
    return result;
  }

  claimTask(request: TaskClaimRequest): TaskClaimResult {
    const result = this.brain.claimTask(request);
    if (result.permissionDecision) {
      this.repository.upsertPermissionDecision({
        action: result.permissionDecision.action,
        status: result.permissionDecision.status,
        reason: result.permissionDecision.reason,
        evaluatedAt: result.permissionDecision.evaluatedAt,
        approvalId: result.permissionDecision.approval?.approvalId,
      });
    }
    if (result.status === "claimed" && result.task) {
      this.repository.upsertTask(result.task);
      const payload = {
        taskId: result.task.id,
        actionId: result.task.handoff?.actionId,
        approvalId: result.approvalId,
        claimingAgentId: result.claimingAgentId,
        requiredCapability: result.task.handoff?.requiredCapability,
        authorizationResult: result.permissionDecision?.status,
      };
      this.appendAudit(result.claimingAgentId, "task.claimed", "Claimed task after authorization revalidation.", payload, result.task.id);
      this.appendAudit(result.claimingAgentId, "task.execution_ready", "Task is execution-ready for a future execution layer.", payload, result.task.id);
    } else {
      this.appendAudit("system", "task.claim_rejected", "Rejected task claim.", {
        taskId: result.taskId,
        actionId: result.permissionDecision?.action.actionId,
        approvalId: result.approvalId,
        claimingAgentId: result.claimingAgentId,
        authorizationResult: result.permissionDecision?.status,
        reason: result.reason,
      }, result.taskId || undefined);
    }
    return result;
  }

  attemptExecution(request: ExecutionAttemptRequest): ExecutionAttemptResult {
    const result = this.brain.attemptExecution(request);
    if (result.permissionDecision) {
      this.repository.upsertPermissionDecision({
        action: result.permissionDecision.action,
        status: result.permissionDecision.status,
        reason: result.permissionDecision.reason,
        evaluatedAt: result.permissionDecision.evaluatedAt,
        approvalId: result.permissionDecision.approval?.approvalId,
      });
    }
    if (result.status === "completed" && result.task) {
      this.repository.upsertTask(result.task);
      const output = result.task.result as { operation?: string; output?: { confidence?: unknown; valuesCount?: unknown } } | undefined;
      const trendMetrics = output?.operation === "analyse_trend"
        ? {
            processedValuesTotal: typeof output.output?.valuesCount === "number" ? output.output.valuesCount : 0,
            trendConfidenceTotal: typeof output.output?.confidence === "number" ? output.output.confidence : 0,
            trendConfidenceSamples: typeof output.output?.confidence === "number" ? 1 : 0,
          }
        : {};
      if (!this.isEvaluationTask(result.task)) {
        this.addAgentMetrics(result.task.claim?.claimingAgentId ?? result.task.assignedAgentId, { tasksCompleted: 1, ...trendMetrics });
      }
      this.appendAudit(result.task.claim?.claimingAgentId ?? "system", "task.execution_completed", "Bounded internal execution completed.", {
        taskId: result.task.id,
        actionId: result.task.handoff?.actionId,
        approvalId: result.approvalId,
        agentId: result.task.claim?.claimingAgentId,
        operation: result.task.execution?.operation,
        authorizationResult: result.permissionDecision?.status,
      }, result.task.id);
    } else if (result.status === "failed" && result.task) {
      this.repository.upsertTask(result.task);
      if (!this.isEvaluationTask(result.task)) {
        this.addAgentMetrics(result.task.claim?.claimingAgentId ?? result.task.assignedAgentId, { tasksFailedOrRejected: 1 });
      }
      this.appendAudit(result.task.claim?.claimingAgentId ?? "system", "task.execution_failed", "Bounded internal execution failed.", {
        taskId: result.task.id,
        actionId: result.task.handoff?.actionId,
        approvalId: result.approvalId,
        agentId: result.task.claim?.claimingAgentId,
        operation: result.task.execution?.operation,
        authorizationResult: result.permissionDecision?.status,
        reason: result.reason,
      }, result.task.id);
    } else {
      const rejectedTask = result.taskId ? this.repository.getTask(result.taskId) : undefined;
      if (rejectedTask?.claim?.claimingAgentId && !this.isEvaluationTask(rejectedTask)) {
        this.addAgentMetrics(rejectedTask.claim.claimingAgentId, { tasksFailedOrRejected: 1 });
      }
      this.appendAudit("system", "task.execution_rejected", "Rejected execution attempt.", {
        taskId: result.taskId,
        actionId: result.permissionDecision?.action.actionId,
        approvalId: result.approvalId,
        authorizationResult: result.permissionDecision?.status,
        reason: result.reason,
      }, result.taskId || undefined);
    }
    return result;
  }

  private executeEvaluationCase(reportId: string, evaluationCase: IntelligenceEvaluationCase): { status: "completed" | "failed" | "rejected"; taskId?: string; output?: Record<string, unknown>; reason: string } {
    const taskId = `evaluation-${reportId}-${evaluationCase.id}`;
    const action: ActionRequest = {
      actionId: `evaluation-action-${reportId}-${evaluationCase.id}`,
      agentId: evaluationCase.agentId,
      actionType: "research",
      capability: evaluationCase.capability,
      purpose: `Controlled intelligence evaluation case: ${evaluationCase.id}`,
      target: "internal evaluation corpus",
      scope: "company",
      impactLevel: "low",
      requestedAt: createTimestamp(),
      routingRequestId: `evaluation:${reportId}`,
      operation: evaluationCase.operation,
      operationInput: evaluationCase.input,
    };
    const permission = this.evaluateAction(action);
    if (permission.status !== "allowed") {
      this.appendAudit(evaluationCase.agentId, "evaluation.case_rejected", "Evaluation case was not authorized.", { reportId, caseId: evaluationCase.id, reason: permission.reason }, taskId);
      return { status: "rejected", taskId, reason: permission.reason };
    }
    const handoff = this.handoffTask({ actionId: action.actionId, taskId });
    if (handoff.status !== "created" || !handoff.task) {
      this.appendAudit(evaluationCase.agentId, "evaluation.case_rejected", "Evaluation case handoff was rejected.", { reportId, caseId: evaluationCase.id, reason: handoff.reason }, taskId);
      return { status: "rejected", taskId, reason: handoff.reason };
    }
    const claim = this.claimTask({ taskId, claimingAgentId: evaluationCase.agentId });
    if (claim.status !== "claimed") {
      this.appendAudit(evaluationCase.agentId, "evaluation.case_rejected", "Evaluation case claim was rejected.", { reportId, caseId: evaluationCase.id, reason: claim.reason }, taskId);
      return { status: "rejected", taskId, reason: claim.reason };
    }
    const execution = this.attemptExecution({ taskId });
    if (execution.status === "completed" && execution.task) {
      const result = execution.task.result as { output?: Record<string, unknown> } | undefined;
      this.appendAudit(evaluationCase.agentId, "evaluation.case_completed", "Evaluation case completed through bounded execution.", { reportId, caseId: evaluationCase.id, taskId }, taskId);
      return { status: "completed", taskId, output: result?.output, reason: execution.reason };
    }
    const eventType = execution.status === "failed" ? "evaluation.case_failed" : "evaluation.case_rejected";
    this.appendAudit(evaluationCase.agentId, eventType, "Evaluation case did not complete.", { reportId, caseId: evaluationCase.id, taskId, reason: execution.reason }, taskId);
    return { status: execution.status, taskId, reason: execution.reason };
  }

  runIntelligenceEvaluation(request: IntelligenceEvaluationRequest): IntelligenceEvaluationReport {
    this.appendAudit("system", "evaluation.started", "Started controlled intelligence evaluation.", { reportId: request.reportId, agentId: request.agentId, capability: request.capability, caseCount: request.cases.length });
    const report = this.brain.runIntelligenceEvaluation(request);
    this.repository.upsertEvaluationReport(report);
    this.setAgentEvaluationMetrics(request.agentId, report);
    this.appendAudit("system", "evaluation.report_completed", "Completed controlled intelligence evaluation report.", { reportId: report.reportId, agentId: report.agentId, capability: report.capability, ...report.summary });
    return report;
  }

  getIntelligenceEvaluationReport(reportId: string): IntelligenceEvaluationReport | undefined {
    return this.repository.getEvaluationReport(reportId);
  }

  generateTrustPerformanceReport(agentId: string, reportId = createStableId("trust")): AgentTrustPerformanceReport {
    const profile = this.getPersistedAgentProfile(agentId);
    if (!profile) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    const snapshot = this.repository.getSnapshot();
    const audit = this.repository.listAuditEvents();
    const report = this.brain.generateTrustPerformanceReport(reportId, {
      profile,
      tasks: snapshot.tasks.filter((task) => task.assignedAgentId === agentId || task.claim?.claimingAgentId === agentId),
      evaluationReports: snapshot.evaluationReports.filter((evaluation) => evaluation.agentId === agentId),
      auditEvents: audit.events,
      auditAvailable: audit.available,
    });
    this.repository.createTrustPerformanceReport(report);
    this.appendAudit("system", "agent.trust_report_generated", "Generated immutable trust and performance report.", {
      reportId: report.reportId,
      agentId,
      trustScore: report.trustScore,
      trustLevel: report.trustLevel,
      recommendation: report.recommendation,
      taskOutcomeCount: report.evidenceWindow.taskOutcomeCount,
      evaluationCaseCount: report.evidenceWindow.evaluationCaseCount,
    });
    return report;
  }

  getTrustPerformanceReport(reportId: string): AgentTrustPerformanceReport | undefined {
    return this.repository.getTrustPerformanceReport(reportId);
  }

  listTrustReports(): TrustReportReviewItem[] {
    return this.brain.listTrustReports();
  }

  getTrustReport(reportId: string): TrustReportLookupResult {
    return this.brain.getTrustReport(reportId);
  }

  getAgentTrustReview(agentId: string): AgentTrustReviewSummary {
    return this.brain.getAgentTrustReview(agentId);
  }

  recordHumanGovernanceDecision(request: Omit<RecordHumanGovernanceDecisionRequest, "decisionId"> & { decisionId?: string }): HumanGovernanceDecisionResult {
    const result = this.brain.recordHumanGovernanceDecision({ ...request, decisionId: request.decisionId?.trim() || createStableId("governance") });
    if (result.status === "created") {
      this.repository.createHumanGovernanceDecision(result.record);
      this.appendAudit(result.record.reviewerId, "governance.decision_recorded", "Recorded immutable human governance decision.", {
        decisionId: result.record.decisionId,
        agentId: result.record.agentId,
        trustReportId: result.record.trustReportId,
        reviewerId: result.record.reviewerId,
        decision: result.record.decision,
        recordedAt: result.record.recordedAt,
      });
    } else {
      this.appendAudit(request.reviewerId?.trim() || "human", "governance.decision_rejected", "Rejected human governance decision.", {
        agentId: request.agentId,
        trustReportId: request.trustReportId,
        decision: request.decision,
        reason: result.reason,
      });
    }
    return result;
  }

  getHumanGovernanceDecision(decisionId: string): HumanGovernanceDecisionRecord | undefined {
    return this.repository.getHumanGovernanceDecision(decisionId);
  }

  listHumanGovernanceDecisions(): HumanGovernanceDecisionRecord[] {
    return this.repository.listHumanGovernanceDecisions().sort((left, right) => left.recordedAt.localeCompare(right.recordedAt) || left.decisionId.localeCompare(right.decisionId));
  }

  listAgentHumanGovernanceDecisions(agentId: string): HumanGovernanceDecisionRecord[] {
    return this.listHumanGovernanceDecisions().filter((record) => record.agentId === agentId);
  }

  createPromotionProposal(input: Omit<AgentPromotionProposal, "createdAt" | "currentStatus" | "proposedStatus" | "changedFields" | "prohibitedFields">): AgentPromotionResult {
    const result = this.brain.createPromotionProposal(input);
    if (result.status === "created") {
      this.repository.createAgentPromotionProposal(result.proposal);
      this.appendAudit("system", "promotion.proposal_created", "Created immutable promotion proposal.", { proposalId: result.proposal.proposalId, agentId: result.proposal.agentId, trustReportId: result.proposal.trustReportId, governanceDecisionId: result.proposal.governanceDecisionId, promotionType: result.proposal.promotionType });
    } else {
      this.appendAudit("system", "promotion.proposal_rejected", "Rejected promotion proposal.", { agentId: input.agentId, trustReportId: input.trustReportId, governanceDecisionId: input.governanceDecisionId, reason: result.reason });
    }
    return result;
  }

  confirmPromotion(input: Omit<AgentPromotionConfirmation, "confirmedAt">): AgentPromotionResult {
    const result = this.brain.confirmPromotion(input);
    if (result.status === "confirmed") {
      this.repository.createAgentPromotionConfirmation(result.confirmation);
      this.appendAudit(result.confirmation.reviewerId, "promotion.confirmed", "Recorded explicit promotion confirmation.", { confirmationId: result.confirmation.confirmationId, proposalId: result.confirmation.proposalId, reviewerId: result.confirmation.reviewerId });
    } else {
      this.appendAudit(input.reviewerId || "human", "promotion.confirmation_rejected", "Rejected promotion confirmation.", { proposalId: input.proposalId, reason: result.reason });
    }
    return result;
  }

  applyPromotion(input: { promotionId: string; proposalId: string; confirmationId: string }): AgentPromotionResult {
    const result = this.brain.applyPromotion(input);
    if (result.status === "applied") {
      const profile = this.getPersistedAgentProfile(result.promotion.agentId)!;
      this.repository.upsertAgent({ ...profile, status: result.promotion.newStatus, updatedAt: createTimestamp() });
      this.repository.createAgentPromotionRecord(result.promotion);
      this.appendAudit(result.promotion.reviewerId, "promotion.applied", "Applied allowlisted agent lifecycle promotion.", { promotionId: result.promotion.promotionId, proposalId: result.promotion.proposalId, confirmationId: result.promotion.confirmationId, agentId: result.promotion.agentId, previousStatus: result.promotion.previousStatus, newStatus: result.promotion.newStatus });
    } else {
      this.appendAudit("system", "promotion.apply_rejected", "Rejected promotion application.", { proposalId: input.proposalId, confirmationId: input.confirmationId, reason: result.reason });
    }
    return result;
  }

  getPromotionProposal(proposalId: string): AgentPromotionProposal | undefined { return this.repository.getAgentPromotionProposal(proposalId); }
  getPromotionConfirmation(confirmationId: string): AgentPromotionConfirmation | undefined { return this.repository.getAgentPromotionConfirmation(confirmationId); }
  listPromotionHistory(): AgentPromotionRecord[] { return this.repository.listAgentPromotionHistory().sort((left, right) => left.appliedAt.localeCompare(right.appliedAt) || left.promotionId.localeCompare(right.promotionId)); }

  approveAction(request: ApprovalDecisionRequest): ApprovalDecisionResult {
    return this.decideApproval(request, "approved");
  }

  rejectAction(request: ApprovalDecisionRequest): ApprovalDecisionResult {
    return this.decideApproval(request, "rejected");
  }

  private decideApproval(request: ApprovalDecisionRequest, decision: "approved" | "rejected"): ApprovalDecisionResult {
    const result = decision === "approved"
      ? this.brain.approveAction(request)
      : this.brain.rejectAction(request);

    if (result.approval && (result.status === "approved" || result.status === "rejected" || result.status === "expired")) {
      this.repository.upsertApprovalRequest(result.approval);
    }

    const eventType = result.status === "approved"
      ? "approval.approved"
      : result.status === "rejected"
        ? "approval.rejected"
        : result.status === "expired"
          ? "approval.expired"
          : "approval.decision_rejected";
    this.appendAudit(request.approverId || "human", eventType, "Processed human approval decision.", {
      approvalId: result.approvalId,
      actionId: result.approval?.actionId,
      approverId: request.approverId,
      requestedDecision: decision,
      result: result.status,
      reason: result.reason,
      decidedAt: result.decidedAt,
    });
    return result;
  }

  storeDecision(request: StoreDecisionRequest): DecisionRecord {
    const decision = this.decisions.store(request);
    this.appendAudit("system", "decision.stored", "Stored structured decision memory.", {
      decisionId: decision.decisionId,
      approvalState: decision.approvalState,
      revisitable: decision.revisitable,
    });
    return decision;
  }

  recordOutcome(request: RecordOutcomeRequest): void {
    const timestamp = request.outcome.timestamp ?? createTimestamp();
    const id = request.outcome.id ?? createStableId("outcome");
    this.storeMemory({
      entry: {
        id,
        type: "learning",
        content: { ...request.outcome, id, timestamp },
        source: `outcome/${request.outcome.agentId}`,
        timestamp,
        confidence: 1,
        authority: "observe",
        status: "proposed",
      },
      scopeIds: request.scopeIds,
    });
    this.appendAudit(request.outcome.agentId, "outcome.recorded", "Recorded outcome and feedback.", {
      outcomeId: id,
      taskId: request.outcome.taskId,
      outcome: request.outcome.outcome,
    }, request.outcome.taskId);
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

    const scopeIds = request.scopeIds?.length ? request.scopeIds : ["scope-company"];
    this.persistMemoryEntry(entry, scopeIds);
    this.appendAudit("system", "memory.stored", "Stored memory entry.", {
      memoryId: entry.id,
      type: entry.type,
      status: entry.status,
    });
    return { entry };
  }
}
