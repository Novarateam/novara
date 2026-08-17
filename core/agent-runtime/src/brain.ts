import type { AgentRegistry } from "./agent-registry.ts";
import type { ApprovalService } from "./approval-service.ts";
import type { CompanyMemory } from "./company-memory.ts";
import type { CompanyStateStore } from "./company-state.ts";
import type { CoordinationService } from "./coordination.ts";
import type { DecisionMemory } from "./decision-memory.ts";
import type { PermissionEngine } from "./permission-engine.ts";
import type { TaskHandoffService } from "./task-handoff-service.ts";
import type { TaskClaimService } from "./task-claim-service.ts";
import type { ExecutionAttemptService } from "./execution-attempt-service.ts";
import type { IntelligenceEvaluationService } from "./intelligence-evaluation-service.ts";
import type { TrustPerformanceService, TrustEvidence } from "./trust-performance-service.ts";
import type { HumanTrustReviewService } from "./human-trust-review-service.ts";
import type { HumanGovernanceDecisionService } from "./human-governance-decision-service.ts";
import type { AgentPromotionService } from "./agent-promotion-service.ts";
import type {
  ActionRequest,
  ApprovalDecisionRequest,
  ApprovalDecisionResult,
  AgentExecutionContext,
  CompanyMemoryEntry,
  CompanyState,
  CoordinationRequest,
  DecisionRecord,
  PermissionDecision,
  RoutingResult,
  TaskHandoffRequest,
  TaskHandoffResult,
  TaskClaimRequest,
  TaskClaimResult,
  ExecutionAttemptRequest,
  ExecutionAttemptResult,
  IntelligenceEvaluationRequest,
  IntelligenceEvaluationReport,
  AgentTrustPerformanceReport,
  AgentTrustReviewSummary,
  TrustReportLookupResult,
  TrustReportReviewItem,
  HumanGovernanceDecisionResult,
  RecordHumanGovernanceDecisionRequest,
  AgentPromotionResult,
} from "./types.ts";

export class NovaraBrain {
  private readonly memory: CompanyMemory;
  private readonly state: CompanyStateStore;
  private readonly registry: AgentRegistry;
  private readonly decisions: DecisionMemory;
  private readonly coordination: CoordinationService;
  private readonly permissions: PermissionEngine;
  private readonly approvals: ApprovalService;
  private readonly handoffs: TaskHandoffService;
  private readonly claims: TaskClaimService;
  private readonly executions: ExecutionAttemptService;
  private readonly evaluations: IntelligenceEvaluationService;
  private readonly trustPerformance: TrustPerformanceService;
  private readonly humanTrustReview: HumanTrustReviewService;
  private readonly humanGovernanceDecisions: HumanGovernanceDecisionService;
  private readonly promotions: AgentPromotionService;
  private readonly contextFor: (agentId: string, taskId?: string) => AgentExecutionContext;

  constructor(
    memory: CompanyMemory,
    state: CompanyStateStore,
    registry: AgentRegistry,
    decisions: DecisionMemory,
    coordination: CoordinationService,
    permissions: PermissionEngine,
    approvals: ApprovalService,
    handoffs: TaskHandoffService,
    claims: TaskClaimService,
    executions: ExecutionAttemptService,
    evaluations: IntelligenceEvaluationService,
    trustPerformance: TrustPerformanceService,
    humanTrustReview: HumanTrustReviewService,
    humanGovernanceDecisions: HumanGovernanceDecisionService,
    promotions: AgentPromotionService,
    contextFor: (agentId: string, taskId?: string) => AgentExecutionContext,
  ) {
    this.memory = memory;
    this.state = state;
    this.registry = registry;
    this.decisions = decisions;
    this.coordination = coordination;
    this.permissions = permissions;
    this.approvals = approvals;
    this.handoffs = handoffs;
    this.claims = claims;
    this.executions = executions;
    this.evaluations = evaluations;
    this.trustPerformance = trustPerformance;
    this.humanTrustReview = humanTrustReview;
    this.humanGovernanceDecisions = humanGovernanceDecisions;
    this.promotions = promotions;
    this.contextFor = contextFor;
  }

  getCompanyKnowledge(): { memory: CompanyMemoryEntry[]; state: CompanyState } {
    return { memory: this.memory.list(), state: this.state.getState() };
  }

  getRelevantContext(agentId: string, taskId?: string): AgentExecutionContext {
    return this.contextFor(agentId, taskId);
  }

  listAvailableAgents() {
    return this.registry.list();
  }

  getDecision(decisionId: string): DecisionRecord | undefined {
    return this.decisions.get(decisionId);
  }

  listDecisions(): DecisionRecord[] {
    return this.decisions.list();
  }

  requestRouting(request: CoordinationRequest): RoutingResult {
    return this.coordination.requestRouting(request);
  }

  evaluateAction(request: ActionRequest): PermissionDecision {
    return this.permissions.evaluate(request);
  }

  approveAction(request: ApprovalDecisionRequest): ApprovalDecisionResult {
    return this.approvals.approve(request);
  }

  rejectAction(request: ApprovalDecisionRequest): ApprovalDecisionResult {
    return this.approvals.reject(request);
  }

  handoffTask(request: TaskHandoffRequest): TaskHandoffResult {
    return this.handoffs.handoff(request);
  }

  claimTask(request: TaskClaimRequest): TaskClaimResult {
    return this.claims.claim(request);
  }

  attemptExecution(request: ExecutionAttemptRequest): ExecutionAttemptResult {
    return this.executions.attempt(request);
  }

  runIntelligenceEvaluation(request: IntelligenceEvaluationRequest): IntelligenceEvaluationReport {
    return this.evaluations.run(request);
  }

  generateTrustPerformanceReport(reportId: string, evidence: TrustEvidence): AgentTrustPerformanceReport {
    return this.trustPerformance.generate(reportId, evidence);
  }

  listTrustReports(): TrustReportReviewItem[] {
    return this.humanTrustReview.listTrustReports();
  }

  getTrustReport(reportId: string): TrustReportLookupResult {
    return this.humanTrustReview.getTrustReport(reportId);
  }

  getAgentTrustReview(agentId: string): AgentTrustReviewSummary {
    return this.humanTrustReview.getAgentTrustReview(agentId);
  }

  recordHumanGovernanceDecision(request: RecordHumanGovernanceDecisionRequest): HumanGovernanceDecisionResult {
    return this.humanGovernanceDecisions.record(request);
  }

  createPromotionProposal(input: { proposalId: string; agentId: string; trustReportId: string; governanceDecisionId: string; promotionType: string }): AgentPromotionResult {
    return this.promotions.createProposal(input);
  }

  confirmPromotion(input: { confirmationId: string; proposalId: string; reviewerId: string; confirmation: string }): AgentPromotionResult {
    return this.promotions.confirm(input);
  }

  applyPromotion(input: { promotionId: string; proposalId: string; confirmationId: string }): AgentPromotionResult {
    return this.promotions.apply(input);
  }
}