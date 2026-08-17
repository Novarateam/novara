import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { isContentProposalEntry } from "./content-review-service.ts";
import { normalizeAndPersistProductionBrief, normalizeProductionBrief } from "./production-brief-service.ts";
import type { CompanyMemoryEntry } from "./types.ts";

const incompleteProposal: CompanyMemoryEntry = {
  id: "mem-production-incomplete-A-014",
  type: "evidence",
  source: "A-014/production-incomplete",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.7,
  authority: "recommend",
  status: "proposed",
  content: {
    objective: "Prepare a social post",
    structuredResult: {
      summary: "A proposal",
      platform: "instagram",
      caption: "A caption remains content-review material, not a generated asset.",
    },
  },
};

const completeProposal: CompanyMemoryEntry = {
  ...incompleteProposal,
  id: "mem-production-complete-A-014",
  source: "A-014/production-complete",
  content: {
    ...incompleteProposal.content,
    structuredResult: {
      ...(incompleteProposal.content as Record<string, unknown>).structuredResult as Record<string, unknown>,
      productionPlan: {
        productionPlanVersion: "1",
        targetPlatform: "instagram",
        contentScript: "Show the problem, explain the insight, and close with one useful action.",
        narrationScript: "Here is the problem. Here is the insight. Here is the action.",
        visualPlan: [
          { sequence: 1, description: "Opening branded title", durationSeconds: 4 },
          { sequence: 2, description: "Supporting visual with caption", durationSeconds: 8 },
        ],
        requiredMediaType: "short-form-video",
        aspectRatio: "9:16",
        targetDurationSeconds: 20,
        captionRequirements: { burnedIn: true, language: "en", style: "high-contrast" },
      },
    },
  },
};

const nonContentEvidence: CompanyMemoryEntry = {
  ...completeProposal,
  id: "mem-production-noncontent-A-002",
  source: "A-002/opportunity",
};

// A/B/D: existing proposals remain valid, and normalization is read-only and non-mutating.
{
  assert.equal(isContentProposalEntry(incompleteProposal), true);
  const before = JSON.stringify((incompleteProposal.content as Record<string, unknown>).structuredResult);
  const brief = normalizeProductionBrief(incompleteProposal, "2026-01-02T00:00:00.000Z");
  const after = JSON.stringify((incompleteProposal.content as Record<string, unknown>).structuredResult);
  assert.equal(after, before, "normalization must not mutate the original structuredResult");
  assert.ok(brief);
  assert.equal(brief?.productionReadiness, "not-ready");
  assert.deepEqual(brief?.missingRequirements, [
    "contentScript",
    "narrationScript",
    "visualPlan",
    "requiredMediaType",
    "aspectRatio",
    "targetDurationSeconds",
    "captionRequirements",
  ]);
  assert.equal(brief?.targetPlatform, "instagram", "existing platform may be preserved as known proposal data");
}

// C: a complete production plan derives a ready brief without external work.
{
  const brief = normalizeProductionBrief(completeProposal, "2026-01-02T00:00:00.000Z");
  assert.ok(brief);
  assert.equal(brief?.productionBriefId, "production-brief-mem-production-complete-A-014-r1");
  assert.equal(brief?.revision, 1);
  assert.equal(brief?.proposalId, completeProposal.id);
  assert.equal(brief?.agentId, "A-014");
  assert.equal(brief?.productionReadiness, "ready");
  assert.deepEqual(brief?.visualPlan, [
    { sequence: 1, description: "Opening branded title", durationSeconds: 4 },
    { sequence: 2, description: "Supporting visual with caption", durationSeconds: 8 },
  ]);
  assert.deepEqual(brief?.captionRequirements, { burnedIn: true, language: "en", style: "high-contrast" });
  assert.deepEqual(brief?.missingRequirements, []);
}

// E: non-A-014 evidence cannot cross the Production Brief boundary.
{
  assert.equal(normalizeProductionBrief(nonContentEvidence), undefined);
}

// F: unchanged normalization is idempotent, while a material change appends a new immutable revision.
{
  const writes: unknown[] = [];
  const records: NonNullable<ReturnType<typeof normalizeProductionBrief>>[] = [];
  const repository = {
    listProductionBriefsByProposal: (proposalId: string) => records.filter((brief) => brief.proposalId === proposalId).sort((left, right) => right.revision - left.revision),
    createProductionBrief: (brief: NonNullable<ReturnType<typeof normalizeProductionBrief>>) => {
      writes.push(brief);
      records.push(brief);
      return brief;
    },
  };
  const first = normalizeAndPersistProductionBrief(completeProposal, repository, "2026-01-02T00:00:00.000Z");
  const second = normalizeAndPersistProductionBrief(completeProposal, repository, "2026-01-03T00:00:00.000Z");
  assert.equal(first?.status, "created");
  assert.equal(second?.status, "unchanged");
  assert.equal(writes.length, 1, "repeated unchanged normalization must not create a duplicate record");

  const changedProposal: CompanyMemoryEntry = structuredClone(completeProposal);
  ((changedProposal.content as Record<string, unknown>).structuredResult as Record<string, unknown>).productionPlan = {
    ...(((completeProposal.content as Record<string, unknown>).structuredResult as Record<string, unknown>).productionPlan as Record<string, unknown>),
    narrationScript: "A changed narration requires a new human approval.",
  };
  const changed = normalizeAndPersistProductionBrief(changedProposal, repository, "2026-01-04T00:00:00.000Z");
  assert.equal(changed?.status, "updated");
  assert.equal(changed?.brief.revision, 2);
  assert.notEqual(changed?.brief.productionBriefId, first?.brief.productionBriefId);
  assert.equal(records.length, 2, "the old revision must remain durable history");
  assert.equal(repository.listProductionBriefsByProposal(completeProposal.id)[0].productionBriefId, changed?.brief.productionBriefId, "the highest revision must be current");
}

// G: persisted Production Brief survives repository reload.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-production-brief-reload-"));
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const result = normalizeAndPersistProductionBrief(completeProposal, repository, "2026-01-02T00:00:00.000Z");
  assert.equal(result?.status, "created");
  const reloaded = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const brief = reloaded.getProductionBriefByProposal(completeProposal.id);
  assert.equal(brief?.productionReadiness, "ready");
  assert.equal(brief?.productionBriefId, result?.brief.productionBriefId);
  assert.equal(reloaded.listProductionBriefsByProposal(completeProposal.id).length, 1);
}

// H: normalization persistence is explicit; read-only repository reads do not change state or audit log.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-production-brief-read-"));
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const statePath = path.join(storageRoot, "state.json");
  const auditPath = path.join(storageRoot, "audit.log");
  const stateBefore = readFileSync(statePath, "utf8");
  const auditBefore = existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "";
  assert.equal(repository.getProductionBriefByProposal(completeProposal.id), undefined);
  assert.deepEqual(repository.listProductionBriefs(), []);
  assert.equal(readFileSync(statePath, "utf8"), stateBefore);
  assert.equal(existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "", auditBefore);
}

// I/J: this phase contains no automatic execution, provider invocation, rendering, or publishing path.
{
  const source = readFileSync(new URL("./production-brief-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /fetch\(|http:\/\/|https:\/\//i);
  assert.doesNotMatch(source, /ElevenLabs|FFmpeg|Metricool|RevenueCat|Obsidian|OpenAI/i);
  assert.doesNotMatch(source, /render|publish|generateVideo|setInterval|setTimeout/i);
}

console.log("Production Brief service tests passed.");
