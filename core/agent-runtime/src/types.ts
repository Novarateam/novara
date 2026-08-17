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

export type AgentExecutionState = "implemented" | "planned";

export interface ApprovalRequirement {
  action: "execution" | "delegation" | "external_action" | "strategy";
  required: boolean;
  reason: string;
}

export interface DeclaredPerformanceSignal {
  id: string;
  description: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  version: string;
  status: AgentStatus;
  mission: string;
  description: string;
  capabilities: string[];
  allowedInputs: string[];
  expectedOutputs: string[];
  authorityLevel: AuthorityLevel;
  approvalRequirements: ApprovalRequirement[];
  limitations: string[];
  declaredPerformanceSignals: DeclaredPerformanceSignal[];
  executionState: AgentExecutionState;
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

export interface AgentProfile extends AgentDefinition {
  departmentId: string | null;
  toolIds: string[];
  memoryScopeIds: string[];
  metrics: Record<string, number | string | null>;
  workload: {
    activeTaskIds: string[];
    queueDepth: number;
  };
  /** Retained only to normalize snapshots written before authorityLevel existed. */
  authority?: AuthorityLevel;
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

export type TaskStatus = "queued" | "claimed" | "running" | "completed" | "failed" | "escalated";

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
  handoff?: {
    actionId: string;
    requiredCapability: string;
    permissionDecision: PermissionDecisionStatus;
    approvalId?: string;
    sourceRequestId?: string;
  };
  claim?: {
    claimingAgentId: string;
    claimedAt: string;
    executionReadyAt: string;
    requiredCapability: string;
    permissionDecision: PermissionDecisionStatus;
    approvalId?: string;
  };
  execution?: {
    attemptedAt: string;
    executorId: "bounded-internal-v1";
    operation: BoundedOperation;
    authorizationResult: PermissionDecisionStatus;
    approvalId?: string;
    completedAt?: string;
    failedAt?: string;
  };
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

export type ActionType =
  | "read"
  | "research"
  | "analyse"
  | "recommend"
  | "create_draft"
  | "execute"
  | "publish"
  | "external_communication"
  | "spend_money"
  | "modify_code"
  | "modify_system"
  | "manage_agents"
  | "modify_authority"
  | (string & {});

export type ActionScope = "agent" | "task" | "department" | "company" | "external" | "code" | "system" | "organization";

export type ActionImpactLevel = "low" | "medium" | "high" | "critical";

export type BoundedOperation =
  | "analyse_text"
  | "score_opportunity"
  | "validate_data"
  | "analyse_trend"
  | "check_policy_update"
  | "quality_check"
  | (string & {});

export interface ActionRequest {
  actionId: string;
  agentId: string;
  actionType: ActionType;
  capability: string;
  purpose: string;
  target: string;
  scope: ActionScope;
  impactLevel: ActionImpactLevel;
  requestedAt: string;
  taskId?: string;
  routingRequestId?: string;
  targetAgentId?: string;
  operation?: BoundedOperation;
  operationInput?: unknown;
}

export type PermissionDecisionStatus = "allowed" | "approval-required" | "denied" | "escalation-required";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRecord {
  approvalId: string;
  actionId: string;
  requestedBy: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt?: string;
  approvedBy?: string;
  decidedAt?: string;
  reason: string;
}

export interface ApprovalDecisionRequest {
  approvalId: string;
  approverId: string;
  reason?: string;
}

export type ApprovalDecisionStatus = "approved" | "rejected" | "expired" | "not-found" | "already-decided" | "invalid-request";

export interface ApprovalDecisionResult {
  status: ApprovalDecisionStatus;
  approvalId: string;
  reason: string;
  approval?: ApprovalRecord;
  decidedAt: string;
}

export interface PermissionDecision {
  action: ActionRequest;
  status: PermissionDecisionStatus;
  reason: string;
  evaluatedAt: string;
  requiredApprovalLevel?: "human";
  approval?: ApprovalRecord;
}

export interface PersistedPermissionDecision {
  action: ActionRequest;
  status: PermissionDecisionStatus;
  reason: string;
  evaluatedAt: string;
  approvalId?: string;
}

export interface TaskHandoffRequest {
  actionId: string;
  approvalId?: string;
  taskId?: string;
  priority?: TaskPriority;
}

export type TaskHandoffStatus = "created" | "rejected";

export interface TaskHandoffResult {
  status: TaskHandoffStatus;
  reason: string;
  task?: TaskRecord;
  actionId: string;
  approvalId?: string;
}

export interface TaskClaimRequest {
  taskId: string;
  claimingAgentId: string;
}

export type TaskClaimStatus = "claimed" | "rejected";

export interface TaskClaimResult {
  status: TaskClaimStatus;
  reason: string;
  taskId: string;
  claimingAgentId: string;
  task?: TaskRecord;
  permissionDecision?: PermissionDecision;
  approvalId?: string;
}

export type BoundedExecutionResult = {
  operation: BoundedOperation;
  output: Record<string, unknown>;
};

export interface ExecutionAttemptRequest {
  taskId: string;
}

export type ExecutionAttemptStatus = "completed" | "failed" | "rejected";

export interface ExecutionAttemptResult {
  status: ExecutionAttemptStatus;
  taskId: string;
  reason: string;
  task?: TaskRecord;
  permissionDecision?: PermissionDecision;
  approvalId?: string;
}

export interface IntelligenceEvaluationExpectation {
  direction?: "rising" | "falling" | "stable" | "insufficient-data";
  momentumInterpretation?: "positive" | "negative" | "neutral";
  recommendation?: string;
  confidenceRange?: { min: number; max: number };
  qualityCriteria: string[];
}

export interface IntelligenceEvaluationCase {
  id: string;
  agentId: string;
  capability: string;
  operation: BoundedOperation;
  input: unknown;
  expectation: IntelligenceEvaluationExpectation;
  metadata: Record<string, string>;
}

export interface IntelligenceEvaluationRequest {
  reportId: string;
  agentId: string;
  capability: string;
  cases: IntelligenceEvaluationCase[];
}

export interface IntelligenceEvaluationCaseResult {
  caseId: string;
  status: "completed" | "failed" | "rejected";
  taskId?: string;
  actualOutput?: Record<string, unknown>;
  directionScore: number;
  momentumScore: number;
  recommendationScore: number;
  confidenceScore: number;
  overallScore: number;
  passed: boolean;
  reason: string;
}

export interface IntelligenceEvaluationReport {
  reportId: string;
  agentId: string;
  capability: string;
  createdAt: string;
  completedAt: string;
  cases: IntelligenceEvaluationCaseResult[];
  summary: {
    totalCases: number;
    passedCases: number;
    failedCases: number;
    averageScore: number;
    directionAccuracyPercentage: number;
    recommendationAccuracyPercentage: number;
    confidenceQualityScore: number;
  };
}

export type TrustAssessmentLevel = "unproven" | "observed" | "developing" | "demonstrated" | "proven";

export type TrustReviewRecommendation = "gather-more-evidence" | "continue-observation" | "investigate-performance" | "eligible-for-human-review";

export type EvidenceSufficiency = "sufficient" | "insufficient" | "unavailable";

export interface AgentTrustPerformanceReport {
  reportId: string;
  agentId: string;
  generatedAt: string;
  evidenceWindow: {
    taskOutcomeCount: number;
    evaluationReportIds: string[];
    evaluationCaseCount: number;
    auditEventCount: number;
  };
  operational: {
    completed: number;
    failedOrRejected: number;
    outcomeCount: number;
    completionRate: number | null;
    sufficiency: EvidenceSufficiency;
  };
  evaluation: {
    reportCount: number;
    caseCount: number;
    averageScore: number | null;
    directionAccuracy: number | null;
    recommendationAccuracy: number | null;
    confidenceQuality: number | null;
    sufficiency: EvidenceSufficiency;
  };
  governance: {
    sufficiency: EvidenceSufficiency;
    attributablePermissionDenials: number;
    attributableCapabilityMismatches: number;
    attributableExecutionRejections: number;
    humanApprovalRejectionsIgnored: number;
  };
  componentScores: {
    controlledQuality: number;
    confidenceCalibration: number;
    operationalReliability: number;
    governanceSafety: number;
  };
  trustScore: number;
  trustLevel: TrustAssessmentLevel;
  recommendation: TrustReviewRecommendation;
  reasons: string[];
}

export interface TrustReportReviewItem {
  reportId: string;
  agentId: string;
  generatedAt: string;
  trustScore: number;
  trustLevel: TrustAssessmentLevel;
  recommendation: TrustReviewRecommendation;
  evidenceSufficiency: {
    operational: EvidenceSufficiency;
    evaluation: EvidenceSufficiency;
    governance: EvidenceSufficiency;
  };
  reasons: string[];
}

export type TrustReportLookupResult =
  | { status: "found"; report: AgentTrustPerformanceReport }
  | { status: "not-found"; reportId: string };

export interface AgentTrustReviewSummary {
  agentId: string;
  reportCount: number;
  latestReport: TrustReportReviewItem | null;
  humanReviewEligible: boolean;
}

export type HumanGovernanceDecision = "continue-observation" | "needs-more-evidence" | "approved-for-human-review" | "rejected-for-now";

export interface HumanGovernanceDecisionRecord {
  decisionId: string;
  agentId: string;
  trustReportId: string;
  reviewerId: string;
  decision: HumanGovernanceDecision;
  reason?: string;
  recordedAt: string;
}

export interface RecordHumanGovernanceDecisionRequest {
  decisionId: string;
  agentId: string;
  trustReportId: string;
  reviewerId: string;
  decision: HumanGovernanceDecision;
  reason?: string;
}

export type HumanGovernanceDecisionResult =
  | { status: "created"; record: HumanGovernanceDecisionRecord }
  | { status: "rejected"; reason: string };

export type ContentReviewDecision = "approved" | "rejected";

export interface ContentReviewDecisionRecord {
  decisionId: string;
  proposalId: string;
  agentId: string;
  reviewerId: string;
  decision: ContentReviewDecision;
  reason?: string;
  recordedAt: string;
}

export interface RecordContentReviewDecisionRequest {
  decisionId: string;
  proposalId: string;
  agentId: string;
  reviewerId: string;
  decision: ContentReviewDecision;
  reason?: string;
}

export type ContentReviewDecisionResult =
  | { status: "created"; record: ContentReviewDecisionRecord }
  | { status: "rejected"; reason: string };

export type ProductionReadiness = "not-ready" | "ready";

export type ProductionApprovalDecision = "approved-for-production" | "rejected-for-production";

export interface ProductionApprovalRecord {
  approvalId: string;
  proposalId: string;
  productionBriefId: string;
  reviewerId: string;
  decision: ProductionApprovalDecision;
  reason?: string;
  recordedAt: string;
}

export interface InstitutionalKnowledgeProposal {
  proposalId: string;
  proposerType: "human";
  proposerId: string;
  targetPath: string;
  baseContentHash: string;
  proposedContent: string;
  rationale: string;
  evidenceReferences: string[];
  createdAt: string;
}

export interface InstitutionalKnowledgeReview {
  reviewId: string;
  proposalId: string;
  reviewerId: string;
  decision: "approved" | "rejected";
  reason?: string;
  reviewedAt: string;
}

export type InstitutionalKnowledgeApplicationStatus = "pending" | "claimed" | "applying" | "applied" | "conflict" | "failed" | "unknown-result";
export interface InstitutionalKnowledgeApplication {
  applicationId: string;
  proposalId: string;
  status: InstitutionalKnowledgeApplicationStatus;
  claimedBy?: string;
  claimedAt?: string;
  resultingContentHash?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionVisualSegment {
  sequence: number;
  description: string;
  durationSeconds?: number;
}

export interface ProductionCaptionRequirements {
  burnedIn: boolean;
  language?: string;
  style?: string;
}

export interface ProductionBrief {
  productionBriefId: string;
  proposalId: string;
  agentId: "A-014";
  productionPlanVersion: string;
  revision?: number;
  targetPlatform?: string;
  contentScript?: string;
  narrationScript?: string;
  visualPlan: ProductionVisualSegment[];
  requiredMediaType?: "short-form-video";
  aspectRatio?: "9:16" | string;
  targetDurationSeconds?: number;
  captionRequirements?: ProductionCaptionRequirements;
  productionReadiness: ProductionReadiness;
  missingRequirements: string[];
  createdAt: string;
  updatedAt: string;
}

export type GenerationOperationType = "narration" | "visual" | "video" | "alignment" | "subtitle";
export type GenerationOperationStatus = "queued" | "generating" | "completed" | "failed" | "unknown-result";

export interface GenerationOperation {
  generationOperationId: string;
  productionBriefId: string;
  proposalId: string;
  agentId: "A-014";
  operationType: GenerationOperationType;
  sceneSequence?: number;
  status: GenerationOperationStatus;
  provider?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  unknownReason?: string;
  resultAssetIds: string[];
}

export type AssetType = "audio" | "video" | "image" | "subtitle";
export type AssetMetadataStatus = "metadata-only" | "available";

export interface AssetMetadata {
  assetId: string;
  generationOperationId: string;
  productionBriefId: string;
  proposalId: string;
  assetType: AssetType;
  status: AssetMetadataStatus;
  localPath?: string;
  reference?: string;
  mimeType?: string;
  durationSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface NarrationAlignmentCharacter {
  text: string;
  start: number;
  end: number;
}

export interface NarrationAlignmentWord {
  text: string;
  start: number;
  end: number;
  loss: number;
}

export interface NarrationAlignment {
  alignmentId: string;
  generationOperationId: string;
  productionBriefId: string;
  proposalId: string;
  narrationAssetId: string;
  narrationText: string;
  source: "elevenlabs-forced-alignment";
  characters: NarrationAlignmentCharacter[];
  words: NarrationAlignmentWord[];
  loss: number;
  createdAt: string;
  updatedAt: string;
}

export interface VisualSceneAssetMapping {
  mappingId: string;
  productionBriefId: string;
  proposalId: string;
  generationOperationId: string;
  sceneSequence: number;
  assetId: string;
  createdAt: string;
  updatedAt: string;
}

export type PublishingQueueStatus = "queued" | "publishing" | "published" | "failed" | "unknown-result";

export interface PublishingProviderResult {
  network: string;
  id?: string;
  status?: string;
  publicUrl?: string;
  detailedStatus?: string;
}

export interface PublishingQueueEntry {
  queueEntryId: string;
  proposalId: string;
  agentId: string;
  status: PublishingQueueStatus;
  createdAt: string;
  updatedAt: string;
  publishAttemptId?: string;
  publishStartedAt?: string;
  publishCompletedAt?: string;
  publishTargetPlatform?: "instagram";
  publishTargetBrandId?: number;
  publishExternalId?: number;
  publishExternalUuid?: string;
  publishPublicationDate?: string;
  publishCreationDate?: string;
  publishProviders?: PublishingProviderResult[];
  publishErrorCode?: string;
  publishErrorReason?: string;
}

export interface RecordPublishingQueueEntryRequest {
  queueEntryId: string;
  proposalId: string;
  agentId: string;
}

export type PublishingQueueEnqueueResult =
  | { status: "created"; entry: PublishingQueueEntry }
  | { status: "rejected"; reason: string };

export type AgentPromotionType = "observed-to-trusted";

export interface AgentPromotionProposal {
  proposalId: string;
  agentId: string;
  trustReportId: string;
  governanceDecisionId: string;
  promotionType: AgentPromotionType;
  currentStatus: AgentStatus;
  proposedStatus: AgentStatus;
  changedFields: ["status"];
  prohibitedFields: string[];
  createdAt: string;
}

export interface AgentPromotionConfirmation {
  confirmationId: string;
  proposalId: string;
  reviewerId: string;
  confirmation: "confirm-promotion";
  confirmedAt: string;
}

export interface AgentPromotionRecord {
  promotionId: string;
  proposalId: string;
  confirmationId: string;
  agentId: string;
  trustReportId: string;
  governanceDecisionId: string;
  previousStatus: AgentStatus;
  newStatus: AgentStatus;
  reviewerId: string;
  appliedAt: string;
}

export type AgentPromotionResult =
  | { status: "created"; proposal: AgentPromotionProposal }
  | { status: "confirmed"; confirmation: AgentPromotionConfirmation }
  | { status: "applied"; promotion: AgentPromotionRecord }
  | { status: "rejected"; reason: string };

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

export interface CoordinationRequest {
  id: string;
  objective: string;
  requiredCapability: string;
  requiredAuthority?: AuthorityLevel;
  requiresExecution?: boolean;
  requesterAgentId?: string;
  taskId?: string;
}

export interface RoutingProposal {
  requestId: string;
  agentId: string;
  capability: string;
  authorityLevel: AuthorityLevel;
  approvalRequired: boolean;
  reason: string;
}

export type RoutingStatus =
  | "routed"
  | "approval-required"
  | "escalation-required"
  | "no-eligible-agent"
  | "rejected";

export interface RoutingResult {
  request: CoordinationRequest;
  status: RoutingStatus;
  proposal?: RoutingProposal;
  reason: string;
}

export type DecisionApprovalState = "proposed" | "approved" | "rejected" | "superseded";

export interface DecisionRecord {
  decisionId: string;
  title: string;
  owner: string;
  alternativesConsidered: string[];
  rationale: string;
  supportingEvidenceIds: string[];
  approvalState: DecisionApprovalState;
  createdAt: string;
  updatedAt: string;
  revisitable: boolean;
}

export interface StoreDecisionRequest {
  decision: Omit<DecisionRecord, "createdAt" | "updatedAt"> &
    Partial<Pick<DecisionRecord, "createdAt" | "updatedAt">>;
  source: string;
  authority: AuthorityLevel;
  confidence?: number;
  scopeIds?: string[];
}

export interface OutcomeRecord {
  id: string;
  agentId: string;
  taskId?: string;
  outcome: "succeeded" | "failed" | "mixed" | "unknown";
  feedback: string;
  performanceSignals: Record<string, number | string | boolean | null>;
  timestamp: string;
}

export interface RecordOutcomeRequest {
  outcome: Omit<OutcomeRecord, "id" | "timestamp"> & Partial<Pick<OutcomeRecord, "id" | "timestamp">>;
  scopeIds?: string[];
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

export interface ObjectiveEvidenceSummary {
  id: string;
  source: string;
  status: CompanyMemoryStatus;
  confidence: number;
  summary: string;
}

export interface ChiefObjectiveFlowResponse {
  objective: string;
  hermesTaskId: string;
  directorDecision: DirectorDecision;
  delegatedAgentId: string | null;
  delegatedAgentName: string | null;
  evidenceUsed: ObjectiveEvidenceSummary[];
  recommendation: string;
  opportunityStatus: CompanyMemoryStatus;
  pendingDecision: string | null;
  supportedByExternalEvidence: boolean;
  unresolvedQuestions: string[];
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
  permissionDecisions: PersistedPermissionDecision[];
  approvalRequests: ApprovalRecord[];
  evaluationReports: IntelligenceEvaluationReport[];
  trustPerformanceReports: AgentTrustPerformanceReport[];
  humanGovernanceDecisions: HumanGovernanceDecisionRecord[];
  agentPromotionProposals: AgentPromotionProposal[];
  agentPromotionConfirmations: AgentPromotionConfirmation[];
  agentPromotionHistory: AgentPromotionRecord[];
  contentReviewDecisions: ContentReviewDecisionRecord[];
  productionBriefs: ProductionBrief[];
  productionApprovals: ProductionApprovalRecord[];
  generationOperations: GenerationOperation[];
  assets: AssetMetadata[];
  narrationAlignments: NarrationAlignment[];
  visualSceneAssetMappings: VisualSceneAssetMapping[];
  publishingQueueEntries: PublishingQueueEntry[];
  institutionalKnowledgeProposals: InstitutionalKnowledgeProposal[];
  institutionalKnowledgeReviews: InstitutionalKnowledgeReview[];
  institutionalKnowledgeApplications: InstitutionalKnowledgeApplication[];
  companyState: CompanyState;
  updatedAt: string;
}
