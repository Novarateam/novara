import { createTimestamp, type RuntimeRepository } from "./persistence.ts";
import type {
  AgentDefinition,
  AgentProfile,
  AuthorityLevel,
  CoordinationRequest,
} from "./types.ts";

const authorityRank: Record<AuthorityLevel, number> = {
  observe: 0,
  recommend: 1,
  execute_with_approval: 2,
  autonomous: 3,
  delegate: 4,
};

function requireNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Agent definition requires a non-empty ${field}.`);
  }
}

function requireStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Agent definition requires ${field} to be a string array.`);
  }
}

export function validateAgentDefinition(definition: AgentDefinition): void {
  if (!definition || typeof definition !== "object") {
    throw new Error("Agent definition must be an object.");
  }

  for (const field of ["id", "name", "version", "mission", "description"] as const) {
    requireNonEmptyString(definition[field], field);
  }

  for (const field of ["capabilities", "allowedInputs", "expectedOutputs", "limitations"] as const) {
    requireStringArray(definition[field], field);
  }

  if (!Object.prototype.hasOwnProperty.call(authorityRank, definition.authorityLevel)) {
    throw new Error("Agent definition has an invalid authorityLevel.");
  }

  if (definition.executionState !== "implemented" && definition.executionState !== "planned") {
    throw new Error("Agent definition has an invalid executionState.");
  }

  if (!Array.isArray(definition.approvalRequirements) || !Array.isArray(definition.declaredPerformanceSignals)) {
    throw new Error("Agent definition requires approvalRequirements and declaredPerformanceSignals arrays.");
  }
}

export function createAgentProfile(
  definition: AgentDefinition,
  existing: AgentProfile | undefined,
  memoryScopeIds: string[],
): AgentProfile {
  const timestamp = createTimestamp();
  return {
    ...definition,
    status: existing?.status ?? definition.status,
    departmentId: existing?.departmentId ?? null,
    toolIds: existing?.toolIds ?? [],
    memoryScopeIds: existing?.memoryScopeIds ?? memoryScopeIds,
    metrics: existing?.metrics ?? {},
    workload: existing?.workload ?? { activeTaskIds: [], queueDepth: 0 },
    authority: definition.authorityLevel,
    limits: existing?.limits ?? { maxConcurrentTasks: 1, maxTaskCost: null },
    performance: existing?.performance ?? { completedTasks: 0, failedTasks: 0, escalatedTasks: 0 },
    cost: existing?.cost ?? { currency: "USD", total: 0 },
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

export class AgentRegistry {
  private readonly definitions = new Map<string, AgentDefinition>();
  private readonly repository: RuntimeRepository;
  private readonly createProfile: (definition: AgentDefinition, existing?: AgentProfile) => AgentProfile;

  constructor(repository: RuntimeRepository, createProfile: (definition: AgentDefinition, existing?: AgentProfile) => AgentProfile) {
    this.repository = repository;
    this.createProfile = createProfile;
  }

  register(definition: AgentDefinition): AgentProfile {
    validateAgentDefinition(definition);
    if (this.definitions.has(definition.id)) {
      throw new Error(`Agent already registered: ${definition.id}`);
    }

    const existing = this.repository.getSnapshot().agents.find((agent) => agent.id === definition.id);
    const profile = this.createProfile(definition, existing);
    this.repository.upsertAgent(profile);
    this.definitions.set(definition.id, definition);
    return profile;
  }

  get(agentId: string): AgentDefinition | undefined {
    return this.definitions.get(agentId);
  }

  list(): AgentDefinition[] {
    return Array.from(this.definitions.values());
  }

  findEligibleCandidates(request: Pick<CoordinationRequest, "requiredCapability" | "requiredAuthority">): AgentProfile[] {
    const requiredAuthority = request.requiredAuthority ?? "recommend";
    return this.list()
      .filter((definition) => definition.executionState === "implemented")
      .filter((definition) => definition.status === "observed" || definition.status === "trusted" || definition.status === "autonomous" || definition.status === "delegated")
      .filter((definition) => definition.capabilities.includes(request.requiredCapability))
      .filter((definition) => authorityRank[definition.authorityLevel] >= authorityRank[requiredAuthority])
      .map((definition) => this.repository.getSnapshot().agents.find((agent) => agent.id === definition.id))
      .filter((profile): profile is AgentProfile => profile !== undefined)
      .filter((profile) => profile.workload.activeTaskIds.length < profile.limits.maxConcurrentTasks)
      .sort((left, right) => left.workload.queueDepth - right.workload.queueDepth || left.name.localeCompare(right.name));
  }
}