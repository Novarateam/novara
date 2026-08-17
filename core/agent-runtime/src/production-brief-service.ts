import { isContentProposalEntry } from "./content-review-service.ts";
import type {
  CompanyMemoryEntry,
  ProductionBrief,
  ProductionCaptionRequirements,
  ProductionVisualSegment,
} from "./types.ts";

const CONTENT_AGENT_ID = "A-014" as const;
const DEFAULT_PLAN_VERSION = "1";

export interface ProductionBriefRepository {
  listProductionBriefsByProposal(proposalId: string): ProductionBrief[];
  createProductionBrief(brief: ProductionBrief): ProductionBrief | undefined;
}

export type ProductionBriefNormalizationResult =
  | { status: "created"; brief: ProductionBrief }
  | { status: "unchanged"; brief: ProductionBrief }
  | { status: "updated"; brief: ProductionBrief };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readVisualPlan(value: unknown): ProductionVisualSegment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const raw = record(item);
    const description = nonEmptyString(raw.description);
    if (!description) return [];
    const durationSeconds = positiveNumber(raw.durationSeconds);
    return [{ sequence: typeof raw.sequence === "number" && raw.sequence > 0 ? raw.sequence : index + 1, description, ...(durationSeconds ? { durationSeconds } : {}) }];
  });
}

function readCaptionRequirements(value: unknown): ProductionCaptionRequirements | undefined {
  const raw = record(value);
  if (typeof raw.burnedIn !== "boolean") return undefined;
  const language = nonEmptyString(raw.language);
  const style = nonEmptyString(raw.style);
  return { burnedIn: raw.burnedIn, ...(language ? { language } : {}), ...(style ? { style } : {}) };
}

function briefContent(brief: ProductionBrief): Omit<ProductionBrief, "createdAt" | "updatedAt" | "productionBriefId" | "productionPlanVersion" | "revision"> {
  const { createdAt: _createdAt, updatedAt: _updatedAt, productionBriefId: _productionBriefId, productionPlanVersion: _productionPlanVersion, revision: _revision, ...content } = brief;
  return content;
}

function sameBriefContent(left: ProductionBrief, right: ProductionBrief): boolean {
  return JSON.stringify(briefContent(left)) === JSON.stringify(briefContent(right));
}

function withRevision(brief: ProductionBrief, revision: number, now: string): ProductionBrief {
  return {
    ...brief,
    revision,
    productionBriefId: `production-brief-${brief.proposalId}-r${revision}`,
    createdAt: now,
    updatedAt: now,
  };
}

function missingRequirements(plan: Record<string, unknown>, brief: {
  targetPlatform?: string;
  contentScript?: string;
  narrationScript?: string;
  visualPlan: ProductionVisualSegment[];
  aspectRatio?: string;
  targetDurationSeconds?: number;
  captionRequirements?: ProductionCaptionRequirements;
}): string[] {
  const missing: string[] = [];
  if (!brief.targetPlatform) missing.push("targetPlatform");
  if (!brief.contentScript) missing.push("contentScript");
  if (!brief.narrationScript) missing.push("narrationScript");
  if (brief.visualPlan.length === 0) missing.push("visualPlan");
  if (plan.requiredMediaType !== "short-form-video") missing.push("requiredMediaType");
  if (!brief.aspectRatio) missing.push("aspectRatio");
  if (!brief.targetDurationSeconds) missing.push("targetDurationSeconds");
  if (!brief.captionRequirements) missing.push("captionRequirements");
  return missing;
}

/** Purely derives a Production Brief. It never mutates the proposal or persistence. */
export function normalizeProductionBrief(proposal: CompanyMemoryEntry, now = new Date().toISOString()): ProductionBrief | undefined {
  if (!isContentProposalEntry(proposal)) return undefined;

  const structuredResult = record(record(proposal.content).structuredResult);
  const plan = record(structuredResult.productionPlan);
  const targetPlatform = nonEmptyString(plan.targetPlatform) ?? nonEmptyString(structuredResult.platform);
  const contentScript = nonEmptyString(plan.contentScript);
  const narrationScript = nonEmptyString(plan.narrationScript);
  const visualPlan = readVisualPlan(plan.visualPlan);
  const aspectRatio = nonEmptyString(plan.aspectRatio);
  const targetDurationSeconds = positiveNumber(plan.targetDurationSeconds);
  const captionRequirements = readCaptionRequirements(plan.captionRequirements);
  const missing = missingRequirements(plan, { targetPlatform, contentScript, narrationScript, visualPlan, aspectRatio, targetDurationSeconds, captionRequirements });
  const productionPlanVersion = nonEmptyString(plan.productionPlanVersion) ?? DEFAULT_PLAN_VERSION;

  return {
    productionBriefId: `production-brief-${proposal.id}-r1`,
    proposalId: proposal.id,
    agentId: CONTENT_AGENT_ID,
    productionPlanVersion,
    revision: 1,
    ...(targetPlatform ? { targetPlatform } : {}),
    ...(contentScript ? { contentScript } : {}),
    ...(narrationScript ? { narrationScript } : {}),
    visualPlan,
    ...(plan.requiredMediaType === "short-form-video" ? { requiredMediaType: "short-form-video" as const } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(targetDurationSeconds ? { targetDurationSeconds } : {}),
    ...(captionRequirements ? { captionRequirements } : {}),
    productionReadiness: missing.length === 0 ? "ready" : "not-ready",
    missingRequirements: missing,
    createdAt: now,
    updatedAt: now,
  };
}

/** Explicit append-only mutation boundary. Changed material content creates a new immutable revision. */
export function normalizeAndPersistProductionBrief(
  proposal: CompanyMemoryEntry,
  repository: ProductionBriefRepository,
  now = new Date().toISOString(),
): ProductionBriefNormalizationResult | undefined {
  const normalized = normalizeProductionBrief(proposal, now);
  if (!normalized) return undefined;

  const briefs = repository.listProductionBriefsByProposal(proposal.id);
  const current = briefs[0];
  if (!current) {
    const created = repository.createProductionBrief(withRevision(normalized, 1, now));
    if (!created) throw new Error("Production Brief revision could not be persisted.");
    return { status: "created", brief: created };
  }
  if (sameBriefContent(current, normalized)) {
    return { status: "unchanged", brief: current };
  }

  const nextRevision = Math.max(...briefs.map((brief) => brief.revision ?? 0), 0) + 1;
  const updated = repository.createProductionBrief(withRevision(normalized, nextRevision, now));
  if (!updated) throw new Error("Production Brief revision could not be persisted.");
  return { status: "updated", brief: updated };
}
