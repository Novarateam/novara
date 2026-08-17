import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentProfile,
  ApprovalRecord,
  AuditEvent,
  CompanyMemoryEntry,
  CompanyState,
  Department,
  IntelligenceEvaluationReport,
  AgentTrustPerformanceReport,
  HumanGovernanceDecisionRecord,
  AgentPromotionProposal,
  AgentPromotionConfirmation,
  AgentPromotionRecord,
  ContentReviewDecisionRecord,
  InstitutionalKnowledgeProposal,
  InstitutionalKnowledgeReview,
  InstitutionalKnowledgeApplication,
  ProductionBrief,
  ProductionApprovalRecord,
  GenerationOperation,
  AssetMetadata,
  NarrationAlignment,
  VisualSceneAssetMapping,
  PublishingQueueEntry,
  MemoryScopeBinding,
  MemoryScope,
  MessageEnvelope,
  PermissionPolicy,
  PersistedPermissionDecision,
  RuntimeSnapshot,
  TaskRecord,
} from "./types.ts";

const RUNTIME_STORE_VERSION = 1;

type RuntimeStoreDocument = RuntimeSnapshot & {
  version: number;
};

const DEFAULT_COMPANY_STATE: CompanyState = {
  objectives: [],
  priorities: [],
  activeWork: [],
  opportunities: [],
  risks: [],
  pendingDecisions: [],
  lastUpdated: new Date().toISOString(),
};

function nowIso(): string {
  return new Date().toISOString();
}

function isAuthorityLevel(value: unknown): value is AgentProfile["authorityLevel"] {
  return ["observe", "recommend", "execute_with_approval", "autonomous", "delegate"].includes(String(value));
}

function isAgentStatus(value: unknown): value is AgentProfile["status"] {
  return ["planned", "designing", "training", "observed", "trusted", "autonomous", "delegated", "review", "retired"].includes(String(value));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeAgentProfile(value: unknown): AgentProfile | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<AgentProfile>;
  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    return null;
  }

  const authorityLevel = isAuthorityLevel(raw.authorityLevel)
    ? raw.authorityLevel
    : isAuthorityLevel(raw.authority)
      ? raw.authority
      : "observe";
  const status = isAgentStatus(raw.status) ? raw.status : "planned";
  const timestamp = typeof raw.updatedAt === "string" && raw.updatedAt.trim().length > 0 ? raw.updatedAt : nowIso();
  const executionState = raw.executionState === "implemented" || raw.executionState === "planned"
    ? raw.executionState
    : ["observed", "trusted", "autonomous", "delegated"].includes(status)
      ? "implemented"
      : "planned";

  return {
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name : raw.id,
    version: typeof raw.version === "string" && raw.version.trim().length > 0 ? raw.version : "0.1",
    status,
    mission: typeof raw.mission === "string" && raw.mission.trim().length > 0 ? raw.mission : "No mission recorded.",
    description: typeof raw.description === "string" ? raw.description : "Legacy registered agent.",
    capabilities: stringArray(raw.capabilities),
    allowedInputs: stringArray(raw.allowedInputs),
    expectedOutputs: stringArray(raw.expectedOutputs),
    authorityLevel,
    approvalRequirements: Array.isArray(raw.approvalRequirements) ? raw.approvalRequirements : [],
    limitations: stringArray(raw.limitations),
    declaredPerformanceSignals: Array.isArray(raw.declaredPerformanceSignals) ? raw.declaredPerformanceSignals : [],
    executionState,
    departmentId: typeof raw.departmentId === "string" ? raw.departmentId : null,
    toolIds: stringArray(raw.toolIds),
    memoryScopeIds: stringArray(raw.memoryScopeIds),
    metrics: raw.metrics && typeof raw.metrics === "object" ? raw.metrics : {},
    workload: {
      activeTaskIds: stringArray(raw.workload?.activeTaskIds),
      queueDepth: typeof raw.workload?.queueDepth === "number" ? raw.workload.queueDepth : 0,
    },
    authority: authorityLevel,
    limits: {
      maxConcurrentTasks: typeof raw.limits?.maxConcurrentTasks === "number" ? raw.limits.maxConcurrentTasks : 1,
      maxTaskCost: typeof raw.limits?.maxTaskCost === "number" ? raw.limits.maxTaskCost : null,
    },
    performance: {
      completedTasks: typeof raw.performance?.completedTasks === "number" ? raw.performance.completedTasks : 0,
      failedTasks: typeof raw.performance?.failedTasks === "number" ? raw.performance.failedTasks : 0,
      escalatedTasks: typeof raw.performance?.escalatedTasks === "number" ? raw.performance.escalatedTasks : 0,
    },
    cost: {
      currency: typeof raw.cost?.currency === "string" ? raw.cost.currency : "USD",
      total: typeof raw.cost?.total === "number" ? raw.cost.total : 0,
    },
    createdAt: typeof raw.createdAt === "string" && raw.createdAt.trim().length > 0 ? raw.createdAt : timestamp,
    updatedAt: timestamp,
  };
}

function emptySnapshot(): RuntimeSnapshot {
  return {
    agents: [],
    departments: [],
    tasks: [],
    messages: [],
    memory: [],
    memoryScopes: [],
    memoryScopeBindings: [],
    permissionPolicies: [],
    permissionDecisions: [],
    approvalRequests: [],
    evaluationReports: [],
    trustPerformanceReports: [],
    humanGovernanceDecisions: [],
    agentPromotionProposals: [],
    agentPromotionConfirmations: [],
    agentPromotionHistory: [],
    contentReviewDecisions: [],
    productionBriefs: [],
    productionApprovals: [],
    generationOperations: [],
    assets: [],
    narrationAlignments: [],
    visualSceneAssetMappings: [],
    publishingQueueEntries: [],
    institutionalKnowledgeProposals: [],
    institutionalKnowledgeReviews: [],
      institutionalKnowledgeApplications: [],
    companyState: { ...DEFAULT_COMPANY_STATE },
    updatedAt: nowIso(),
  };
}

function toDocument(snapshot: RuntimeSnapshot): RuntimeStoreDocument {
  return {
    version: RUNTIME_STORE_VERSION,
    ...snapshot,
  };
}

function fromDocument(doc: Partial<RuntimeStoreDocument> | undefined): RuntimeSnapshot {
  const base = emptySnapshot();
  if (!doc || typeof doc !== "object") {
    return base;
  }

  return {
    agents: Array.isArray(doc.agents)
      ? doc.agents.map(normalizeAgentProfile).filter((agent): agent is AgentProfile => agent !== null)
      : base.agents,
    departments: Array.isArray(doc.departments) ? doc.departments : base.departments,
    tasks: Array.isArray(doc.tasks) ? doc.tasks : base.tasks,
    messages: Array.isArray(doc.messages) ? doc.messages : base.messages,
    memory: Array.isArray(doc.memory) ? doc.memory : base.memory,
    memoryScopes: Array.isArray(doc.memoryScopes) ? doc.memoryScopes : base.memoryScopes,
    memoryScopeBindings: Array.isArray(doc.memoryScopeBindings) ? doc.memoryScopeBindings : base.memoryScopeBindings,
    permissionPolicies: Array.isArray(doc.permissionPolicies) ? doc.permissionPolicies : base.permissionPolicies,
    permissionDecisions: Array.isArray(doc.permissionDecisions) ? doc.permissionDecisions : base.permissionDecisions,
    approvalRequests: Array.isArray(doc.approvalRequests) ? doc.approvalRequests : base.approvalRequests,
    evaluationReports: Array.isArray(doc.evaluationReports) ? doc.evaluationReports : base.evaluationReports,
    trustPerformanceReports: Array.isArray(doc.trustPerformanceReports) ? doc.trustPerformanceReports : base.trustPerformanceReports,
    humanGovernanceDecisions: Array.isArray(doc.humanGovernanceDecisions) ? doc.humanGovernanceDecisions : base.humanGovernanceDecisions,
    agentPromotionProposals: Array.isArray(doc.agentPromotionProposals) ? doc.agentPromotionProposals : base.agentPromotionProposals,
    agentPromotionConfirmations: Array.isArray(doc.agentPromotionConfirmations) ? doc.agentPromotionConfirmations : base.agentPromotionConfirmations,
    agentPromotionHistory: Array.isArray(doc.agentPromotionHistory) ? doc.agentPromotionHistory : base.agentPromotionHistory,
    contentReviewDecisions: Array.isArray(doc.contentReviewDecisions) ? doc.contentReviewDecisions : base.contentReviewDecisions,
    productionBriefs: Array.isArray(doc.productionBriefs) ? doc.productionBriefs : base.productionBriefs,
    productionApprovals: Array.isArray(doc.productionApprovals) ? doc.productionApprovals : base.productionApprovals,
    generationOperations: Array.isArray(doc.generationOperations) ? doc.generationOperations : base.generationOperations,
    assets: Array.isArray(doc.assets) ? doc.assets : base.assets,
    narrationAlignments: Array.isArray(doc.narrationAlignments) ? doc.narrationAlignments : base.narrationAlignments,
    visualSceneAssetMappings: Array.isArray(doc.visualSceneAssetMappings) ? doc.visualSceneAssetMappings : base.visualSceneAssetMappings,
    publishingQueueEntries: Array.isArray(doc.publishingQueueEntries) ? doc.publishingQueueEntries : base.publishingQueueEntries,
    institutionalKnowledgeProposals: Array.isArray(doc.institutionalKnowledgeProposals) ? doc.institutionalKnowledgeProposals : base.institutionalKnowledgeProposals,
    institutionalKnowledgeReviews: Array.isArray(doc.institutionalKnowledgeReviews) ? doc.institutionalKnowledgeReviews : base.institutionalKnowledgeReviews,
      institutionalKnowledgeApplications: Array.isArray(doc.institutionalKnowledgeApplications) ? doc.institutionalKnowledgeApplications : base.institutionalKnowledgeApplications,
    companyState:
      doc.companyState && typeof doc.companyState === "object"
        ? {
            objectives: Array.isArray(doc.companyState.objectives) ? doc.companyState.objectives : [],
            priorities: Array.isArray(doc.companyState.priorities) ? doc.companyState.priorities : [],
            activeWork: Array.isArray(doc.companyState.activeWork) ? doc.companyState.activeWork : [],
            opportunities: Array.isArray(doc.companyState.opportunities) ? doc.companyState.opportunities : [],
            risks: Array.isArray(doc.companyState.risks) ? doc.companyState.risks : [],
            pendingDecisions: Array.isArray(doc.companyState.pendingDecisions) ? doc.companyState.pendingDecisions : [],
            lastUpdated:
              typeof doc.companyState.lastUpdated === "string" && doc.companyState.lastUpdated.trim().length > 0
                ? doc.companyState.lastUpdated
                : nowIso(),
          }
        : base.companyState,
    updatedAt:
      typeof doc.updatedAt === "string" && doc.updatedAt.trim().length > 0
        ? doc.updatedAt
        : nowIso(),
  };
}

function upsertById<T extends { id: string }>(collection: T[], item: T): T[] {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    return [...collection, item];
  }

  const next = [...collection];
  next[index] = item;
  return next;
}

function toAuditLine(event: AuditEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export interface RuntimeStore {
  loadSnapshot(): RuntimeSnapshot;
  saveSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot;
  claimGenerationOperation?(generationOperationId: string, operation: GenerationOperation): GenerationOperation | undefined;
  updateGenerationOperation?(generationOperationId: string, expectedStatus: GenerationOperation["status"], operation: GenerationOperation): GenerationOperation | undefined;
  completeGenerationOperation?(generationOperationId: string, operation: GenerationOperation, assets: AssetMetadata[], mappings?: VisualSceneAssetMapping[], alignment?: NarrationAlignment): GenerationOperation | undefined;
  createProductionBrief?(brief: ProductionBrief): ProductionBrief | undefined;
  createProductionApproval?(record: ProductionApprovalRecord): ProductionApprovalRecord | undefined;
  createInstitutionalKnowledgeProposal?(proposal: InstitutionalKnowledgeProposal): InstitutionalKnowledgeProposal | undefined;
  createInstitutionalKnowledgeReview?(review: InstitutionalKnowledgeReview): InstitutionalKnowledgeReview | undefined;
  claimInstitutionalKnowledgeApplication?(application: InstitutionalKnowledgeApplication): InstitutionalKnowledgeApplication | undefined;
  transitionInstitutionalKnowledgeApplication?(applicationId: string, expectedStatus: InstitutionalKnowledgeApplication["status"], application: InstitutionalKnowledgeApplication): InstitutionalKnowledgeApplication | undefined;
  claimPublishingQueueEntry?(queueEntryId: string, entry: PublishingQueueEntry): PublishingQueueEntry | undefined;
  updatePublishingQueueEntry?(queueEntryId: string, expectedStatus: PublishingQueueEntry["status"], entry: PublishingQueueEntry): PublishingQueueEntry | undefined;
  appendAuditEvent(event: AuditEvent): void;
  listAuditEvents?(): AuditEvent[];
}

export class FileRuntimeStore implements RuntimeStore {
  private readonly storageRoot: string;
  private readonly stateFilePath: string;
  private readonly auditFilePath: string;

  constructor(storageRoot = path.resolve(process.cwd(), ".novara/runtime")) {
    this.storageRoot = path.resolve(storageRoot);
    this.stateFilePath = path.join(this.storageRoot, "state.json");
    this.auditFilePath = path.join(this.storageRoot, "audit.log");
    this.ensureStorageRoot();
  }

  loadSnapshot(): RuntimeSnapshot {
    this.ensureStorageRoot();

    if (!existsSync(this.stateFilePath)) {
      const snapshot = emptySnapshot();
      this.writeState(snapshot);
      return snapshot;
    }

    const raw = readFileSync(this.stateFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeStoreDocument>;
    return fromDocument(parsed);
  }

  saveSnapshot(snapshot: RuntimeSnapshot): RuntimeSnapshot {
    this.ensureStorageRoot();
    const nextSnapshot: RuntimeSnapshot = {
      ...snapshot,
      updatedAt: nowIso(),
    };
    this.writeState(nextSnapshot);
    return nextSnapshot;
  }

  claimPublishingQueueEntry(queueEntryId: string, entry: PublishingQueueEntry): PublishingQueueEntry | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      const current = snapshot.publishingQueueEntries.find((candidate) => candidate.queueEntryId === queueEntryId);
      if (!current || current.status !== "queued") {
        return undefined;
      }
      const nextSnapshot = {
        ...snapshot,
        publishingQueueEntries: snapshot.publishingQueueEntries.map((candidate) => candidate.queueEntryId === queueEntryId ? entry : candidate),
      };
      this.writeState(nextSnapshot);
      return structuredClone(entry);
    });
  }

  updatePublishingQueueEntry(queueEntryId: string, expectedStatus: PublishingQueueEntry["status"], entry: PublishingQueueEntry): PublishingQueueEntry | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      const current = snapshot.publishingQueueEntries.find((candidate) => candidate.queueEntryId === queueEntryId);
      if (!current || current.status !== expectedStatus) {
        return undefined;
      }
      this.writeState({
        ...snapshot,
        publishingQueueEntries: snapshot.publishingQueueEntries.map((candidate) => candidate.queueEntryId === queueEntryId ? entry : candidate),
      });
      return structuredClone(entry);
    });
  }

  claimGenerationOperation(generationOperationId: string, operation: GenerationOperation): GenerationOperation | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      const current = snapshot.generationOperations.find((candidate) => candidate.generationOperationId === generationOperationId);
      if (!current || current.status !== "queued") return undefined;
      this.writeState({
        ...snapshot,
        generationOperations: snapshot.generationOperations.map((candidate) => candidate.generationOperationId === generationOperationId ? operation : candidate),
      });
      return structuredClone(operation);
    });
  }

  updateGenerationOperation(generationOperationId: string, expectedStatus: GenerationOperation["status"], operation: GenerationOperation): GenerationOperation | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      const current = snapshot.generationOperations.find((candidate) => candidate.generationOperationId === generationOperationId);
      if (!current || current.status !== expectedStatus) return undefined;
      this.writeState({
        ...snapshot,
        generationOperations: snapshot.generationOperations.map((candidate) => candidate.generationOperationId === generationOperationId ? operation : candidate),
      });
      return structuredClone(operation);
    });
  }

  completeGenerationOperation(generationOperationId: string, operation: GenerationOperation, assets: AssetMetadata[], mappings: VisualSceneAssetMapping[] = [], alignment?: NarrationAlignment): GenerationOperation | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      const current = snapshot.generationOperations.find((candidate) => candidate.generationOperationId === generationOperationId);
      if (!current || current.status !== "generating" || operation.status !== "completed") return undefined;
      if (assets.some((asset) => asset.generationOperationId !== generationOperationId || asset.productionBriefId !== operation.productionBriefId || asset.proposalId !== operation.proposalId)) {
        throw new Error("Generation result assets do not match the operation.");
      }
      if (mappings.some((mapping) => mapping.generationOperationId !== generationOperationId || mapping.productionBriefId !== operation.productionBriefId || mapping.proposalId !== operation.proposalId || mapping.assetId !== assets.find((asset) => asset.assetId === mapping.assetId)?.assetId)) {
        throw new Error("Generation scene mappings do not match the operation assets.");
      }
      if (mappings.some((mapping) => snapshot.visualSceneAssetMappings.some((existing) => existing.productionBriefId === mapping.productionBriefId && existing.sceneSequence === mapping.sceneSequence))) {
        throw new Error("Visual scene mapping already exists.");
      }
      if (alignment && (alignment.generationOperationId !== generationOperationId || alignment.productionBriefId !== operation.productionBriefId || alignment.proposalId !== operation.proposalId || snapshot.narrationAlignments.some((existing) => existing.alignmentId === alignment.alignmentId))) {
        throw new Error("Narration alignment does not match the operation or already exists.");
      }
      const existingAssetIds = new Set(snapshot.assets.map((asset) => asset.assetId));
      if (assets.some((asset) => existingAssetIds.has(asset.assetId))) {
        throw new Error("Generation result asset already exists.");
      }
      this.writeState({
        ...snapshot,
        generationOperations: snapshot.generationOperations.map((candidate) => candidate.generationOperationId === generationOperationId ? operation : candidate),
        assets: [...snapshot.assets, ...assets],
        visualSceneAssetMappings: [...snapshot.visualSceneAssetMappings, ...mappings],
        narrationAlignments: alignment ? [...snapshot.narrationAlignments, alignment] : snapshot.narrationAlignments,
      });
      return structuredClone(operation);
    });
  }

  createProductionApproval(record: ProductionApprovalRecord): ProductionApprovalRecord | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      if (snapshot.productionApprovals.some((entry) => entry.productionBriefId === record.productionBriefId || entry.approvalId === record.approvalId)) return undefined;
      this.writeState({ ...snapshot, productionApprovals: [...snapshot.productionApprovals, record] });
      return structuredClone(record);
    });
  }

  createProductionBrief(brief: ProductionBrief): ProductionBrief | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      if (snapshot.productionBriefs.some((entry) => entry.productionBriefId === brief.productionBriefId)) return undefined;
      this.writeState({ ...snapshot, productionBriefs: [...snapshot.productionBriefs, brief] });
      return structuredClone(brief);
    });
  }

  createInstitutionalKnowledgeProposal(proposal: InstitutionalKnowledgeProposal): InstitutionalKnowledgeProposal | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      if (snapshot.institutionalKnowledgeProposals.some((entry) => entry.proposalId === proposal.proposalId)) return undefined;
      this.writeState({ ...snapshot, institutionalKnowledgeProposals: [...snapshot.institutionalKnowledgeProposals, proposal] });
      return structuredClone(proposal);
    });
  }

  createInstitutionalKnowledgeReview(review: InstitutionalKnowledgeReview): InstitutionalKnowledgeReview | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      if (!snapshot.institutionalKnowledgeProposals.some((entry) => entry.proposalId === review.proposalId)) return undefined;
      if (snapshot.institutionalKnowledgeReviews.some((entry) => entry.proposalId === review.proposalId || entry.reviewId === review.reviewId)) return undefined;
      this.writeState({ ...snapshot, institutionalKnowledgeReviews: [...snapshot.institutionalKnowledgeReviews, review] });
      return structuredClone(review);
    });
  }

  claimInstitutionalKnowledgeApplication(application: InstitutionalKnowledgeApplication): InstitutionalKnowledgeApplication | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot();
      const review = snapshot.institutionalKnowledgeReviews.find((entry) => entry.proposalId === application.proposalId);
      if (review?.decision !== "approved" || snapshot.institutionalKnowledgeApplications.some((entry) => entry.proposalId === application.proposalId || entry.applicationId === application.applicationId)) return undefined;
      this.writeState({ ...snapshot, institutionalKnowledgeApplications: [...snapshot.institutionalKnowledgeApplications, application] });
      return structuredClone(application);
    });
  }

  transitionInstitutionalKnowledgeApplication(applicationId: string, expectedStatus: InstitutionalKnowledgeApplication["status"], application: InstitutionalKnowledgeApplication): InstitutionalKnowledgeApplication | undefined {
    return this.withStateLock(() => {
      const snapshot = this.loadSnapshot(); const current = snapshot.institutionalKnowledgeApplications.find((entry) => entry.applicationId === applicationId);
      const allowed: Record<InstitutionalKnowledgeApplication["status"], InstitutionalKnowledgeApplication["status"][]> = { pending: ["claimed"], claimed: ["applying"], applying: ["applied", "conflict", "failed", "unknown-result"], applied: [], conflict: [], failed: [], "unknown-result": [] };
      if (!current || current.status !== expectedStatus || current.proposalId !== application.proposalId || !allowed[current.status].includes(application.status)) return undefined;
      this.writeState({ ...snapshot, institutionalKnowledgeApplications: snapshot.institutionalKnowledgeApplications.map((entry) => entry.applicationId === applicationId ? application : entry) });
      return structuredClone(application);
    });
  }

  appendAuditEvent(event: AuditEvent): void {
    this.ensureStorageRoot();
    appendFileSync(this.auditFilePath, toAuditLine(event), "utf8");
  }

  listAuditEvents(): AuditEvent[] {
    this.ensureStorageRoot();
    if (!existsSync(this.auditFilePath)) {
      return [];
    }
    return readFileSync(this.auditFilePath, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as AuditEvent];
        } catch {
          return [];
        }
      });
  }

  private ensureStorageRoot(): void {
    mkdirSync(this.storageRoot, { recursive: true });
  }

  private writeState(snapshot: RuntimeSnapshot): void {
    const serialized = JSON.stringify(toDocument(snapshot), null, 2);
    const tempFilePath = `${this.stateFilePath}.tmp`;
    writeFileSync(tempFilePath, serialized, "utf8");
    try {
      renameSync(tempFilePath, this.stateFilePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY") {
        throw error;
      }

      // On Windows, rename can fail under transient file-lock contention.
      // Fall back to direct overwrite to keep runtime persistence available.
      writeFileSync(this.stateFilePath, serialized, "utf8");
    }
  }

  private withStateLock<T>(operation: () => T): T {
    const lockFilePath = `${this.stateFilePath}.lock`;
    const deadline = Date.now() + 5000;
    let descriptor: number | undefined;
    while (descriptor === undefined) {
      try {
        descriptor = openSync(lockFilePath, "wx");
        writeFileSync(descriptor, `${process.pid}:${Date.now()}`, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) {
          throw error;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }

    try {
      return operation();
    } finally {
      closeSync(descriptor);
      try {
        unlinkSync(lockFilePath);
      } catch {
        // The state transition itself has already been durably written.
      }
    }
  }
}

export function loadTrustPerformanceReportsReadOnly(storageRoot = path.resolve(process.cwd(), ".novara/runtime")): AgentTrustPerformanceReport[] {
  const stateFilePath = path.join(path.resolve(storageRoot), "state.json");
  if (!existsSync(stateFilePath)) {
    return [];
  }
  const parsed = JSON.parse(readFileSync(stateFilePath, "utf8")) as Partial<RuntimeStoreDocument>;
  return structuredClone(fromDocument(parsed).trustPerformanceReports);
}

export class RuntimeRepository {
  private snapshot: RuntimeSnapshot;
  private readonly store: RuntimeStore;

  constructor(store: RuntimeStore) {
    this.store = store;
    const loadedSnapshot = store.loadSnapshot();
    this.snapshot = {
      ...loadedSnapshot,
      permissionDecisions: Array.isArray(loadedSnapshot.permissionDecisions) ? loadedSnapshot.permissionDecisions : [],
      approvalRequests: Array.isArray(loadedSnapshot.approvalRequests) ? loadedSnapshot.approvalRequests : [],
      evaluationReports: Array.isArray(loadedSnapshot.evaluationReports) ? loadedSnapshot.evaluationReports : [],
      trustPerformanceReports: Array.isArray(loadedSnapshot.trustPerformanceReports) ? loadedSnapshot.trustPerformanceReports : [],
      humanGovernanceDecisions: Array.isArray(loadedSnapshot.humanGovernanceDecisions) ? loadedSnapshot.humanGovernanceDecisions : [],
      agentPromotionProposals: Array.isArray(loadedSnapshot.agentPromotionProposals) ? loadedSnapshot.agentPromotionProposals : [],
      agentPromotionConfirmations: Array.isArray(loadedSnapshot.agentPromotionConfirmations) ? loadedSnapshot.agentPromotionConfirmations : [],
      agentPromotionHistory: Array.isArray(loadedSnapshot.agentPromotionHistory) ? loadedSnapshot.agentPromotionHistory : [],
      contentReviewDecisions: Array.isArray(loadedSnapshot.contentReviewDecisions) ? loadedSnapshot.contentReviewDecisions : [],
      productionBriefs: Array.isArray(loadedSnapshot.productionBriefs) ? loadedSnapshot.productionBriefs : [],
      productionApprovals: Array.isArray(loadedSnapshot.productionApprovals) ? loadedSnapshot.productionApprovals : [],
      generationOperations: Array.isArray(loadedSnapshot.generationOperations) ? loadedSnapshot.generationOperations : [],
      assets: Array.isArray(loadedSnapshot.assets) ? loadedSnapshot.assets : [],
      narrationAlignments: Array.isArray(loadedSnapshot.narrationAlignments) ? loadedSnapshot.narrationAlignments : [],
      visualSceneAssetMappings: Array.isArray(loadedSnapshot.visualSceneAssetMappings) ? loadedSnapshot.visualSceneAssetMappings : [],
      publishingQueueEntries: Array.isArray(loadedSnapshot.publishingQueueEntries) ? loadedSnapshot.publishingQueueEntries : [],
      institutionalKnowledgeProposals: Array.isArray(loadedSnapshot.institutionalKnowledgeProposals) ? loadedSnapshot.institutionalKnowledgeProposals : [],
      institutionalKnowledgeReviews: Array.isArray(loadedSnapshot.institutionalKnowledgeReviews) ? loadedSnapshot.institutionalKnowledgeReviews : [],
      institutionalKnowledgeApplications: Array.isArray(loadedSnapshot.institutionalKnowledgeApplications) ? loadedSnapshot.institutionalKnowledgeApplications : [],
    };
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      agents: [...this.snapshot.agents],
      departments: [...this.snapshot.departments],
      tasks: [...this.snapshot.tasks],
      messages: [...this.snapshot.messages],
      memory: [...this.snapshot.memory],
      memoryScopes: [...this.snapshot.memoryScopes],
      memoryScopeBindings: [...this.snapshot.memoryScopeBindings],
      permissionPolicies: [...this.snapshot.permissionPolicies],
      permissionDecisions: [...this.snapshot.permissionDecisions],
      approvalRequests: [...this.snapshot.approvalRequests],
      evaluationReports: [...this.snapshot.evaluationReports],
      trustPerformanceReports: [...this.snapshot.trustPerformanceReports],
      humanGovernanceDecisions: [...this.snapshot.humanGovernanceDecisions],
      agentPromotionProposals: [...this.snapshot.agentPromotionProposals],
      agentPromotionConfirmations: [...this.snapshot.agentPromotionConfirmations],
      agentPromotionHistory: [...this.snapshot.agentPromotionHistory],
      contentReviewDecisions: [...this.snapshot.contentReviewDecisions],
      productionBriefs: [...this.snapshot.productionBriefs],
      productionApprovals: [...this.snapshot.productionApprovals],
      generationOperations: [...this.snapshot.generationOperations],
      assets: [...this.snapshot.assets],
      narrationAlignments: [...this.snapshot.narrationAlignments],
      visualSceneAssetMappings: [...this.snapshot.visualSceneAssetMappings],
      publishingQueueEntries: [...this.snapshot.publishingQueueEntries],
      institutionalKnowledgeProposals: [...this.snapshot.institutionalKnowledgeProposals],
      institutionalKnowledgeReviews: [...this.snapshot.institutionalKnowledgeReviews],
      institutionalKnowledgeApplications: [...this.snapshot.institutionalKnowledgeApplications],
      companyState: {
        objectives: [...this.snapshot.companyState.objectives],
        priorities: [...this.snapshot.companyState.priorities],
        activeWork: [...this.snapshot.companyState.activeWork],
        opportunities: [...this.snapshot.companyState.opportunities],
        risks: [...this.snapshot.companyState.risks],
        pendingDecisions: [...this.snapshot.companyState.pendingDecisions],
        lastUpdated: this.snapshot.companyState.lastUpdated,
      },
      updatedAt: this.snapshot.updatedAt,
    };
  }

  upsertAgent(profile: AgentProfile): AgentProfile {
    this.snapshot = this.persist({
      ...this.snapshot,
      agents: upsertById(this.snapshot.agents, profile),
    });
    return profile;
  }

  upsertDepartment(department: Department): Department {
    this.snapshot = this.persist({
      ...this.snapshot,
      departments: upsertById(this.snapshot.departments, department),
    });
    return department;
  }

  upsertTask(task: TaskRecord): TaskRecord {
    this.snapshot = this.persist({
      ...this.snapshot,
      tasks: upsertById(this.snapshot.tasks, task),
    });
    return task;
  }

  getTask(taskId: string): TaskRecord | undefined {
    return this.snapshot.tasks.find((task) => task.id === taskId);
  }

  upsertMessage(message: MessageEnvelope): MessageEnvelope {
    this.snapshot = this.persist({
      ...this.snapshot,
      messages: upsertById(this.snapshot.messages, message),
    });
    return message;
  }

  upsertMemory(entry: CompanyMemoryEntry): CompanyMemoryEntry {
    this.snapshot = this.persist({
      ...this.snapshot,
      memory: upsertById(this.snapshot.memory, entry),
    });
    return entry;
  }

  upsertMemoryScope(scope: MemoryScope): MemoryScope {
    this.snapshot = this.persist({
      ...this.snapshot,
      memoryScopes: upsertById(this.snapshot.memoryScopes, scope),
    });
    return scope;
  }

  upsertMemoryScopeBinding(binding: MemoryScopeBinding): MemoryScopeBinding {
    this.snapshot = this.persist({
      ...this.snapshot,
      memoryScopeBindings: upsertById(this.snapshot.memoryScopeBindings, binding),
    });
    return binding;
  }

  listMemoryScopeBindingsForEntry(memoryEntryId: string): MemoryScopeBinding[] {
    return this.snapshot.memoryScopeBindings.filter((binding) => binding.memoryEntryId === memoryEntryId);
  }

  listMemoryByScopeHierarchy(scopeIds: string[]): CompanyMemoryEntry[] {
    const requestedScopeIds = scopeIds.filter((scopeId, index, list) => Boolean(scopeId) && list.indexOf(scopeId) === index);
    const scopeRank = new Map(requestedScopeIds.map((scopeId, index) => [scopeId, index]));

    const candidates = this.snapshot.memory
      .map((entry) => {
        const bindings = this.listMemoryScopeBindingsForEntry(entry.id);
        const effectiveScopeIds = bindings.length > 0 ? bindings.map((binding) => binding.scopeId) : ["scope-company"];
        const matchingRanks = effectiveScopeIds
          .map((scopeId) => scopeRank.get(scopeId))
          .filter((rank): rank is number => rank !== undefined);

        if (matchingRanks.length === 0) {
          return null;
        }

        const bestScopeRank = Math.min(...matchingRanks);
        const statusRank = entry.status === "verified" ? 0 : entry.status === "proposed" ? 1 : 2;
        const timestamp = Date.parse(entry.timestamp);

        return {
          entry,
          bestScopeRank,
          statusRank,
          timestamp: Number.isNaN(timestamp) ? 0 : timestamp,
        };
      })
      .filter((candidate): candidate is { entry: CompanyMemoryEntry; bestScopeRank: number; statusRank: number; timestamp: number } => candidate !== null)
      .sort((left, right) => {
        if (left.bestScopeRank !== right.bestScopeRank) {
          return left.bestScopeRank - right.bestScopeRank;
        }
        if (left.statusRank !== right.statusRank) {
          return left.statusRank - right.statusRank;
        }
        return right.timestamp - left.timestamp;
      });

    return candidates.map((candidate) => candidate.entry);
  }

  upsertPermissionPolicy(policy: PermissionPolicy): PermissionPolicy {
    this.snapshot = this.persist({
      ...this.snapshot,
      permissionPolicies: upsertById(this.snapshot.permissionPolicies, policy),
    });
    return policy;
  }

  upsertPermissionDecision(decision: PersistedPermissionDecision): PersistedPermissionDecision {
    const existingIndex = this.snapshot.permissionDecisions.findIndex((entry) => entry.action.actionId === decision.action.actionId);
    const permissionDecisions = [...this.snapshot.permissionDecisions];
    if (existingIndex === -1) {
      permissionDecisions.push(decision);
    } else {
      permissionDecisions[existingIndex] = decision;
    }
    this.snapshot = this.persist({
      ...this.snapshot,
      permissionDecisions,
    });
    return decision;
  }

  getPermissionDecision(actionId: string): PersistedPermissionDecision | undefined {
    return this.snapshot.permissionDecisions.find((decision) => decision.action.actionId === actionId);
  }

  upsertApprovalRequest(approval: ApprovalRecord): ApprovalRecord {
    const existingIndex = this.snapshot.approvalRequests.findIndex((entry) => entry.approvalId === approval.approvalId);
    const approvalRequests = [...this.snapshot.approvalRequests];
    if (existingIndex === -1) {
      approvalRequests.push(approval);
    } else {
      approvalRequests[existingIndex] = approval;
    }
    this.snapshot = this.persist({
      ...this.snapshot,
      approvalRequests,
    });
    return approval;
  }

  getApprovalRequest(approvalId: string): ApprovalRecord | undefined {
    return this.snapshot.approvalRequests.find((approval) => approval.approvalId === approvalId);
  }

  upsertEvaluationReport(report: IntelligenceEvaluationReport): IntelligenceEvaluationReport {
    const existingIndex = this.snapshot.evaluationReports.findIndex((entry) => entry.reportId === report.reportId);
    const evaluationReports = [...this.snapshot.evaluationReports];
    if (existingIndex === -1) {
      evaluationReports.push(report);
    } else {
      evaluationReports[existingIndex] = report;
    }
    this.snapshot = this.persist({ ...this.snapshot, evaluationReports });
    return report;
  }

  getEvaluationReport(reportId: string): IntelligenceEvaluationReport | undefined {
    return this.snapshot.evaluationReports.find((report) => report.reportId === reportId);
  }

  createTrustPerformanceReport(report: AgentTrustPerformanceReport): AgentTrustPerformanceReport {
    if (this.snapshot.trustPerformanceReports.some((entry) => entry.reportId === report.reportId)) {
      throw new Error(`Trust performance report already exists: ${report.reportId}`);
    }
    this.snapshot = this.persist({ ...this.snapshot, trustPerformanceReports: [...this.snapshot.trustPerformanceReports, report] });
    return report;
  }

  getTrustPerformanceReport(reportId: string): AgentTrustPerformanceReport | undefined {
    const report = this.snapshot.trustPerformanceReports.find((entry) => entry.reportId === reportId);
    return report ? structuredClone(report) : undefined;
  }

  listTrustPerformanceReports(): AgentTrustPerformanceReport[] {
    return structuredClone(this.snapshot.trustPerformanceReports);
  }

  createHumanGovernanceDecision(record: HumanGovernanceDecisionRecord): HumanGovernanceDecisionRecord {
    if (this.snapshot.humanGovernanceDecisions.some((entry) => entry.decisionId === record.decisionId)) {
      throw new Error(`Human governance decision already exists: ${record.decisionId}`);
    }
    this.snapshot = this.persist({ ...this.snapshot, humanGovernanceDecisions: [...this.snapshot.humanGovernanceDecisions, record] });
    return record;
  }

  getHumanGovernanceDecision(decisionId: string): HumanGovernanceDecisionRecord | undefined {
    const record = this.snapshot.humanGovernanceDecisions.find((entry) => entry.decisionId === decisionId);
    return record ? structuredClone(record) : undefined;
  }

  listHumanGovernanceDecisions(): HumanGovernanceDecisionRecord[] {
    return structuredClone(this.snapshot.humanGovernanceDecisions);
  }

  createAgentPromotionProposal(proposal: AgentPromotionProposal): AgentPromotionProposal {
    if (this.snapshot.agentPromotionProposals.some((entry) => entry.proposalId === proposal.proposalId)) throw new Error(`Promotion proposal already exists: ${proposal.proposalId}`);
    this.snapshot = this.persist({ ...this.snapshot, agentPromotionProposals: [...this.snapshot.agentPromotionProposals, proposal] });
    return proposal;
  }

  getAgentPromotionProposal(proposalId: string): AgentPromotionProposal | undefined {
    const proposal = this.snapshot.agentPromotionProposals.find((entry) => entry.proposalId === proposalId);
    return proposal ? structuredClone(proposal) : undefined;
  }

  createAgentPromotionConfirmation(confirmation: AgentPromotionConfirmation): AgentPromotionConfirmation {
    if (this.snapshot.agentPromotionConfirmations.some((entry) => entry.confirmationId === confirmation.confirmationId)) throw new Error(`Promotion confirmation already exists: ${confirmation.confirmationId}`);
    this.snapshot = this.persist({ ...this.snapshot, agentPromotionConfirmations: [...this.snapshot.agentPromotionConfirmations, confirmation] });
    return confirmation;
  }

  getAgentPromotionConfirmation(confirmationId: string): AgentPromotionConfirmation | undefined {
    const confirmation = this.snapshot.agentPromotionConfirmations.find((entry) => entry.confirmationId === confirmationId);
    return confirmation ? structuredClone(confirmation) : undefined;
  }

  createAgentPromotionRecord(record: AgentPromotionRecord): AgentPromotionRecord {
    if (this.snapshot.agentPromotionHistory.some((entry) => entry.promotionId === record.promotionId || entry.proposalId === record.proposalId)) throw new Error(`Promotion already applied: ${record.proposalId}`);
    this.snapshot = this.persist({ ...this.snapshot, agentPromotionHistory: [...this.snapshot.agentPromotionHistory, record] });
    return record;
  }

  getAgentPromotionByProposal(proposalId: string): AgentPromotionRecord | undefined {
    const record = this.snapshot.agentPromotionHistory.find((entry) => entry.proposalId === proposalId);
    return record ? structuredClone(record) : undefined;
  }

  listAgentPromotionHistory(): AgentPromotionRecord[] {
    return structuredClone(this.snapshot.agentPromotionHistory);
  }

  createInstitutionalKnowledgeProposal(proposal: InstitutionalKnowledgeProposal): InstitutionalKnowledgeProposal | undefined {
    if (!this.store.createInstitutionalKnowledgeProposal) return undefined;
    const created = this.store.createInstitutionalKnowledgeProposal(proposal);
    if (!created) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(created);
  }

  getInstitutionalKnowledgeProposal(proposalId: string): InstitutionalKnowledgeProposal | undefined {
    const proposal = this.snapshot.institutionalKnowledgeProposals.find((entry) => entry.proposalId === proposalId);
    return proposal ? structuredClone(proposal) : undefined;
  }

  listInstitutionalKnowledgeProposals(): InstitutionalKnowledgeProposal[] {
    return structuredClone([...this.snapshot.institutionalKnowledgeProposals].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.proposalId.localeCompare(left.proposalId)));
  }

  createInstitutionalKnowledgeReview(review: InstitutionalKnowledgeReview): InstitutionalKnowledgeReview | undefined {
    if (!this.store.createInstitutionalKnowledgeReview) return undefined;
    const created = this.store.createInstitutionalKnowledgeReview(review);
    if (!created) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(created);
  }

  getInstitutionalKnowledgeReviewByProposal(proposalId: string): InstitutionalKnowledgeReview | undefined {
    const review = this.snapshot.institutionalKnowledgeReviews.find((entry) => entry.proposalId === proposalId);
    return review ? structuredClone(review) : undefined;
  }

  claimInstitutionalKnowledgeApplication(application: InstitutionalKnowledgeApplication): InstitutionalKnowledgeApplication | undefined {
    const claimed = this.store.claimInstitutionalKnowledgeApplication?.(application); if (!claimed) return undefined; this.snapshot = this.store.loadSnapshot(); return structuredClone(claimed);
  }
  transitionInstitutionalKnowledgeApplication(applicationId: string, expectedStatus: InstitutionalKnowledgeApplication["status"], application: InstitutionalKnowledgeApplication): InstitutionalKnowledgeApplication | undefined {
    const updated = this.store.transitionInstitutionalKnowledgeApplication?.(applicationId, expectedStatus, application); if (!updated) return undefined; this.snapshot = this.store.loadSnapshot(); return structuredClone(updated);
  }
  getInstitutionalKnowledgeApplicationByProposal(proposalId: string): InstitutionalKnowledgeApplication | undefined { const application = this.snapshot.institutionalKnowledgeApplications.find((entry) => entry.proposalId === proposalId); return application ? structuredClone(application) : undefined; }

  createContentReviewDecision(record: ContentReviewDecisionRecord): ContentReviewDecisionRecord {
    if (this.snapshot.contentReviewDecisions.some((entry) => entry.decisionId === record.decisionId)) {
      throw new Error(`Content review decision already exists: ${record.decisionId}`);
    }
    this.snapshot = this.persist({ ...this.snapshot, contentReviewDecisions: [...this.snapshot.contentReviewDecisions, record] });
    return record;
  }

  getContentReviewDecision(decisionId: string): ContentReviewDecisionRecord | undefined {
    const record = this.snapshot.contentReviewDecisions.find((entry) => entry.decisionId === decisionId);
    return record ? structuredClone(record) : undefined;
  }

  getContentReviewDecisionByProposal(proposalId: string): ContentReviewDecisionRecord | undefined {
    const record = this.snapshot.contentReviewDecisions.find((entry) => entry.proposalId === proposalId);
    return record ? structuredClone(record) : undefined;
  }

  listContentReviewDecisions(): ContentReviewDecisionRecord[] {
    return structuredClone(this.snapshot.contentReviewDecisions);
  }

  upsertProductionBrief(brief: ProductionBrief): ProductionBrief {
    this.snapshot = this.persist({
      ...this.snapshot,
      productionBriefs: upsertById(this.snapshot.productionBriefs, brief),
    });
    return structuredClone(brief);
  }

  createProductionBrief(brief: ProductionBrief): ProductionBrief | undefined {
    if (!this.store.createProductionBrief) return undefined;
    const created = this.store.createProductionBrief(brief);
    if (!created) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(created);
  }

  getProductionBrief(productionBriefId: string): ProductionBrief | undefined {
    const brief = this.snapshot.productionBriefs.find((candidate) => candidate.productionBriefId === productionBriefId);
    return brief ? structuredClone(brief) : undefined;
  }

  getProductionBriefByProposal(proposalId: string): ProductionBrief | undefined {
    const brief = this.listProductionBriefsByProposal(proposalId)[0];
    return brief ? structuredClone(brief) : undefined;
  }

  listProductionBriefsByProposal(proposalId: string): ProductionBrief[] {
    return structuredClone(this.snapshot.productionBriefs
      .filter((candidate) => candidate.proposalId === proposalId)
      .sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0) || right.createdAt.localeCompare(left.createdAt) || right.productionBriefId.localeCompare(left.productionBriefId)));
  }

  listProductionBriefs(): ProductionBrief[] {
    return structuredClone(this.snapshot.productionBriefs);
  }

  createProductionApproval(record: ProductionApprovalRecord): ProductionApprovalRecord | undefined {
    if (!this.store.createProductionApproval) return undefined;
    const created = this.store.createProductionApproval(record);
    if (!created) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(created);
  }

  getProductionApprovalByBrief(productionBriefId: string): ProductionApprovalRecord | undefined {
    const record = this.snapshot.productionApprovals.find((candidate) => candidate.productionBriefId === productionBriefId);
    return record ? structuredClone(record) : undefined;
  }

  listProductionApprovals(): ProductionApprovalRecord[] {
    return structuredClone(this.snapshot.productionApprovals);
  }

  createGenerationOperation(operation: GenerationOperation): GenerationOperation {
    if (this.snapshot.generationOperations.some((candidate) => candidate.generationOperationId === operation.generationOperationId)) {
      throw new Error(`Generation operation already exists: ${operation.generationOperationId}`);
    }
    if (this.snapshot.generationOperations.some((candidate) => candidate.productionBriefId === operation.productionBriefId && candidate.operationType === operation.operationType && candidate.sceneSequence === operation.sceneSequence)) {
      throw new Error(`Generation operation already exists for Production Brief: ${operation.productionBriefId}`);
    }
    this.snapshot = this.persist({ ...this.snapshot, generationOperations: [...this.snapshot.generationOperations, operation] });
    return structuredClone(operation);
  }

  claimGenerationOperation(generationOperationId: string, operation: GenerationOperation): GenerationOperation | undefined {
    const claimed = this.store.claimGenerationOperation
      ? this.store.claimGenerationOperation(generationOperationId, operation)
      : this.snapshot.generationOperations.find((candidate) => candidate.generationOperationId === generationOperationId && candidate.status === "queued")
        ? operation
        : undefined;
    if (!claimed) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(claimed);
  }

  updateGenerationOperation(generationOperationId: string, expectedStatus: GenerationOperation["status"], operation: GenerationOperation): GenerationOperation | undefined {
    const updated = this.store.updateGenerationOperation
      ? this.store.updateGenerationOperation(generationOperationId, expectedStatus, operation)
      : this.snapshot.generationOperations.find((candidate) => candidate.generationOperationId === generationOperationId && candidate.status === expectedStatus)
        ? operation
        : undefined;
    if (!updated) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(updated);
  }

  completeGenerationOperation(generationOperationId: string, operation: GenerationOperation, assets: AssetMetadata[], mappings: VisualSceneAssetMapping[] = [], alignment?: NarrationAlignment): GenerationOperation | undefined {
    const completed = this.store.completeGenerationOperation
      ? this.store.completeGenerationOperation(generationOperationId, operation, assets, mappings, alignment)
      : undefined;
    if (!completed) return undefined;
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(completed);
  }

  getGenerationOperation(generationOperationId: string): GenerationOperation | undefined {
    const operation = this.snapshot.generationOperations.find((candidate) => candidate.generationOperationId === generationOperationId);
    return operation ? structuredClone(operation) : undefined;
  }

  getGenerationOperationByBrief(productionBriefId: string, operationType: GenerationOperation["operationType"], sceneSequence?: number): GenerationOperation | undefined {
    const operation = this.snapshot.generationOperations.find((candidate) => candidate.productionBriefId === productionBriefId && candidate.operationType === operationType && (sceneSequence === undefined || candidate.sceneSequence === sceneSequence));
    return operation ? structuredClone(operation) : undefined;
  }

  listGenerationOperations(): GenerationOperation[] {
    return structuredClone(this.snapshot.generationOperations);
  }

  getAsset(assetId: string): AssetMetadata | undefined {
    const asset = this.snapshot.assets.find((candidate) => candidate.assetId === assetId);
    return asset ? structuredClone(asset) : undefined;
  }

  listAssets(): AssetMetadata[] {
    return structuredClone(this.snapshot.assets);
  }

  getNarrationAlignmentByOperation(generationOperationId: string): NarrationAlignment | undefined {
    const alignment = this.snapshot.narrationAlignments.find((candidate) => candidate.generationOperationId === generationOperationId);
    return alignment ? structuredClone(alignment) : undefined;
  }

  listNarrationAlignments(): NarrationAlignment[] {
    return structuredClone(this.snapshot.narrationAlignments);
  }

  getVisualSceneAssetMapping(productionBriefId: string, sceneSequence: number): VisualSceneAssetMapping | undefined {
    const mapping = this.snapshot.visualSceneAssetMappings.find((candidate) => candidate.productionBriefId === productionBriefId && candidate.sceneSequence === sceneSequence);
    return mapping ? structuredClone(mapping) : undefined;
  }

  listVisualSceneAssetMappings(productionBriefId?: string): VisualSceneAssetMapping[] {
    return structuredClone(productionBriefId
      ? this.snapshot.visualSceneAssetMappings.filter((mapping) => mapping.productionBriefId === productionBriefId)
      : this.snapshot.visualSceneAssetMappings);
  }

  createPublishingQueueEntry(entry: PublishingQueueEntry): PublishingQueueEntry {
    if (this.snapshot.publishingQueueEntries.some((candidate) => candidate.queueEntryId === entry.queueEntryId)) {
      throw new Error(`Publishing queue entry already exists: ${entry.queueEntryId}`);
    }
    this.snapshot = this.persist({ ...this.snapshot, publishingQueueEntries: [...this.snapshot.publishingQueueEntries, entry] });
    return entry;
  }

  claimPublishingQueueEntry(queueEntryId: string, entry: PublishingQueueEntry): PublishingQueueEntry | undefined {
    const claimed = this.store.claimPublishingQueueEntry
      ? this.store.claimPublishingQueueEntry(queueEntryId, entry)
      : this.snapshot.publishingQueueEntries.find((candidate) => candidate.queueEntryId === queueEntryId && candidate.status === "queued")
        ? entry
        : undefined;
    if (!claimed) {
      return undefined;
    }
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(claimed);
  }

  updatePublishingQueueEntry(queueEntryId: string, expectedStatus: PublishingQueueEntry["status"], entry: PublishingQueueEntry): PublishingQueueEntry | undefined {
    const updated = this.store.updatePublishingQueueEntry
      ? this.store.updatePublishingQueueEntry(queueEntryId, expectedStatus, entry)
      : this.snapshot.publishingQueueEntries.find((candidate) => candidate.queueEntryId === queueEntryId && candidate.status === expectedStatus)
        ? entry
        : undefined;
    if (!updated) {
      return undefined;
    }
    this.snapshot = this.store.loadSnapshot();
    return structuredClone(updated);
  }

  getPublishingQueueEntry(queueEntryId: string): PublishingQueueEntry | undefined {
    const entry = this.snapshot.publishingQueueEntries.find((candidate) => candidate.queueEntryId === queueEntryId);
    return entry ? structuredClone(entry) : undefined;
  }

  getPublishingQueueEntryByProposal(proposalId: string): PublishingQueueEntry | undefined {
    const entry = this.snapshot.publishingQueueEntries.find((candidate) => candidate.proposalId === proposalId);
    return entry ? structuredClone(entry) : undefined;
  }

  listPublishingQueueEntries(): PublishingQueueEntry[] {
    return structuredClone(this.snapshot.publishingQueueEntries);
  }

  listAuditEvents(): { events: AuditEvent[]; available: boolean } {
    if (!this.store.listAuditEvents) {
      return { events: [], available: false };
    }
    return { events: this.store.listAuditEvents(), available: true };
  }

  setCompanyState(companyState: CompanyState): CompanyState {
    this.snapshot = this.persist({
      ...this.snapshot,
      companyState,
    });
    return companyState;
  }

  appendAuditEvent(event: Omit<AuditEvent, "id" | "timestamp"> & Partial<Pick<AuditEvent, "id" | "timestamp">>): AuditEvent {
    const fullEvent: AuditEvent = {
      id: event.id ?? createStableId("audit"),
      timestamp: event.timestamp ?? nowIso(),
      actorId: event.actorId,
      taskId: event.taskId,
      type: event.type,
      message: event.message,
      payload: event.payload,
    };

    this.store.appendAuditEvent(fullEvent);
    return fullEvent;
  }

  private persist(nextSnapshot: RuntimeSnapshot): RuntimeSnapshot {
    return this.store.saveSnapshot(nextSnapshot);
  }
}

export function createStableId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function createTimestamp(): string {
  return nowIso();
}
