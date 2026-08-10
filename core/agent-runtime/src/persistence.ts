import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AgentProfile,
  AuditEvent,
  CompanyMemoryEntry,
  CompanyState,
  Department,
  MemoryScopeBinding,
  MemoryScope,
  MessageEnvelope,
  PermissionPolicy,
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
    agents: Array.isArray(doc.agents) ? doc.agents : base.agents,
    departments: Array.isArray(doc.departments) ? doc.departments : base.departments,
    tasks: Array.isArray(doc.tasks) ? doc.tasks : base.tasks,
    messages: Array.isArray(doc.messages) ? doc.messages : base.messages,
    memory: Array.isArray(doc.memory) ? doc.memory : base.memory,
    memoryScopes: Array.isArray(doc.memoryScopes) ? doc.memoryScopes : base.memoryScopes,
    memoryScopeBindings: Array.isArray(doc.memoryScopeBindings) ? doc.memoryScopeBindings : base.memoryScopeBindings,
    permissionPolicies: Array.isArray(doc.permissionPolicies) ? doc.permissionPolicies : base.permissionPolicies,
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
  appendAuditEvent(event: AuditEvent): void;
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

  appendAuditEvent(event: AuditEvent): void {
    this.ensureStorageRoot();
    appendFileSync(this.auditFilePath, toAuditLine(event), "utf8");
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
}

export class RuntimeRepository {
  private snapshot: RuntimeSnapshot;
  private readonly store: RuntimeStore;

  constructor(store: RuntimeStore) {
    this.store = store;
    this.snapshot = store.loadSnapshot();
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
