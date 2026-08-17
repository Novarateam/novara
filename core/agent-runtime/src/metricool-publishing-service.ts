import { randomUUID } from "node:crypto";
import { isContentProposalEntry } from "./content-review-service.ts";
import { MetricoolPublishingAdapter, type MetricoolPublishOutcome } from "./metricool-publishing-adapter.ts";
import { RuntimeRepository } from "./persistence.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, PublishingQueueEntry } from "./types.ts";

const CONTENT_AGENT_ID = "A-014";

type PublishResult =
  | { status: "published"; queueEntryId: string; proposalId: string }
  | { status: "failed" | "unknown-result"; queueEntryId: string; reason: string };

export interface MetricoolPublishingStore {
  getPublishingQueueEntry(queueEntryId: string): PublishingQueueEntry | undefined;
  getMemoryEntry(proposalId: string): CompanyMemoryEntry | undefined;
  getContentReviewDecisionByProposal(proposalId: string): ContentReviewDecisionRecord | undefined;
  claimPublishingQueueEntry(queueEntryId: string, entry: PublishingQueueEntry): PublishingQueueEntry | undefined;
  updatePublishingQueueEntry(queueEntryId: string, expectedStatus: PublishingQueueEntry["status"], entry: PublishingQueueEntry): PublishingQueueEntry | undefined;
  appendAuditEvent: RuntimeRepository["appendAuditEvent"];
}

function structuredResult(entry: CompanyMemoryEntry): Record<string, unknown> {
  return ((entry.content ?? {}) as Record<string, unknown>).structuredResult as Record<string, unknown> ?? {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMedia(result: Record<string, unknown>): string[] {
  const candidates = result.media ?? result.mediaUrls ?? result.publicMediaUrls;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((value): value is string => typeof value === "string" && /^https:\/\//i.test(value.trim())).map((value) => value.trim());
}

function readPublicationDate(result: Record<string, unknown>): { dateTime: string; timezone: string } | undefined {
  const value = result.publicationDate;
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const dateTime = stringValue(raw.dateTime);
    const timezone = stringValue(raw.timezone);
    if (dateTime && timezone) return { dateTime, timezone };
  }
  const dateTime = stringValue(result.publicationDateTime);
  const timezone = stringValue(result.timezone);
  return dateTime && timezone ? { dateTime, timezone } : undefined;
}

function validateTarget(result: Record<string, unknown>): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  const platform = stringValue(result.platform)?.toLowerCase();
  if (platform !== "instagram") return { ok: false, reason: "Only Instagram publishing is supported in this phase." };
  const text = stringValue(result.caption) ?? stringValue(result.text);
  if (!text) return { ok: false, reason: "Instagram publishing requires non-empty post text." };
  const media = readMedia(result);
  if (media.length === 0) return { ok: false, reason: "Instagram publishing requires at least one real public HTTPS media URL; the proposal contains none." };
  const publicationDate = readPublicationDate(result);
  if (!publicationDate) return { ok: false, reason: "Instagram publishing requires a future publicationDate with dateTime and timezone." };
  let timezoneValid = false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: publicationDate.timezone }).format();
    timezoneValid = true;
  } catch {
    timezoneValid = false;
  }
  const timestamp = Date.parse(publicationDate.dateTime);
  if (!timezoneValid || !Number.isFinite(timestamp) || timestamp <= Date.now()) {
    return { ok: false, reason: "Instagram publicationDate must be a valid future dateTime with a valid timezone." };
  }
  return {
    ok: true,
    body: {
      providers: [{ network: "instagram" }],
      publicationDate,
      text,
      media,
      autoPublish: true,
      instagramData: { type: "POST" },
    },
  };
}

function persistOutcome(store: MetricoolPublishingStore, entry: PublishingQueueEntry, outcome: MetricoolPublishOutcome, attemptId: string): PublishResult {
  const completedAt = new Date().toISOString();
  if (outcome.status === "published") {
    const data = outcome.response.data;
    const updated: PublishingQueueEntry = {
      ...entry,
      status: "published",
      updatedAt: completedAt,
      publishCompletedAt: completedAt,
      publishExternalId: data?.id,
      publishExternalUuid: data?.uuid,
      publishPublicationDate: data?.publicationDate?.dateTime,
      publishCreationDate: data?.creationDate?.dateTime,
      publishProviders: data?.providers,
    };
    store.updatePublishingQueueEntry(entry.queueEntryId, "publishing", updated);
    return { status: "published", queueEntryId: entry.queueEntryId, proposalId: entry.proposalId };
  }
  const updated: PublishingQueueEntry = {
    ...entry,
    status: outcome.status,
    updatedAt: completedAt,
    publishCompletedAt: completedAt,
    publishErrorCode: outcome.code,
    publishErrorReason: outcome.reason,
  };
  store.updatePublishingQueueEntry(entry.queueEntryId, "publishing", updated);
  store.appendAuditEvent({ actorId: "human-publisher", type: `metricool.publish_${outcome.status === "failed" ? "failed" : "unknown_result"}`, message: outcome.reason, payload: { queueEntryId: entry.queueEntryId, proposalId: entry.proposalId, attemptId, code: outcome.code } });
  return { status: outcome.status, queueEntryId: entry.queueEntryId, reason: outcome.reason };
}

export class MetricoolPublishingService {
  private readonly store: MetricoolPublishingStore;
  private readonly adapter: MetricoolPublishingAdapter;
  private readonly createAttemptId: () => string;

  constructor(store: MetricoolPublishingStore, adapter = new MetricoolPublishingAdapter(), createAttemptId = () => `publish-${randomUUID()}`) {
    this.store = store;
    this.adapter = adapter;
    this.createAttemptId = createAttemptId;
  }

  async execute(queueEntryId: string): Promise<PublishResult> {
    const trimmedId = String(queueEntryId ?? "").trim();
    if (!trimmedId) return { status: "failed", queueEntryId: trimmedId, reason: "queueEntryId is required." };
    const current = this.store.getPublishingQueueEntry(trimmedId);
    if (!current) return { status: "failed", queueEntryId: trimmedId, reason: "Publishing queue entry was not found." };
    if (current.status !== "queued") return { status: "failed", queueEntryId: trimmedId, reason: `Queue entry is ${current.status} and cannot be published again.` };
    if (current.agentId !== CONTENT_AGENT_ID) return { status: "failed", queueEntryId: trimmedId, reason: "Queue entry does not reference the Content Agent." };
    const proposal = this.store.getMemoryEntry(current.proposalId);
    if (!proposal || !isContentProposalEntry(proposal)) return { status: "failed", queueEntryId: trimmedId, reason: "Referenced content proposal was not found or is invalid." };
    const decision = this.store.getContentReviewDecisionByProposal(current.proposalId);
    if (!decision || decision.decision !== "approved") return { status: "failed", queueEntryId: trimmedId, reason: "Referenced proposal was not approved through Content Review." };
    const target = validateTarget(structuredResult(proposal));
    if (!target.ok) return { status: "failed", queueEntryId: trimmedId, reason: target.reason };
    const readiness = await this.adapter.checkReadiness();
    if (readiness.status !== "ready") return { status: "failed", queueEntryId: trimmedId, reason: readiness.reason };

    const attemptId = this.createAttemptId();
    const startedAt = new Date().toISOString();
    const publishingEntry: PublishingQueueEntry = { ...current, status: "publishing", updatedAt: startedAt, publishAttemptId: attemptId, publishStartedAt: startedAt, publishTargetPlatform: "instagram" };
    const claimed = this.store.claimPublishingQueueEntry(trimmedId, publishingEntry);
    if (!claimed) return { status: "failed", queueEntryId: trimmedId, reason: "Queue entry was claimed by another publish attempt or is no longer queued." };

    const outcome = await this.adapter.publish(target.body);
    return persistOutcome(this.store, claimed, outcome, attemptId);
  }
}
