import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handlePublishingQueueReadCommand,
  handlePublishingQueueEnqueueCommand,
  type PublishingQueueEnqueueWorkflow,
} from "./publishing-queue-command.ts";
import { LocalPublishingQueueAccessService } from "./publishing-queue-access-service.ts";
import type {
  CompanyMemoryEntry,
  ContentReviewDecisionRecord,
  PublishingQueueEntry,
} from "../../../core/agent-runtime/src/types.ts";

const approvedEntry: CompanyMemoryEntry = {
  id: "mem-task-approved-A-014",
  type: "evidence",
  source: "A-014/task-approved",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.6,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Propose a post", structuredResult: { summary: "s", platform: "instagram", hook: "h", title: "t", caption: "c", hashtags: ["a"], angle: "an", confidence: 0.6, reasons: ["r"], humanReviewRequired: true } },
};

const rejectedEntry: CompanyMemoryEntry = {
  id: "mem-task-rejected-A-014",
  type: "evidence",
  source: "A-014/task-rejected",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.4,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Propose a post", structuredResult: { summary: "s2" } },
};

const nonContentEntry: CompanyMemoryEntry = {
  id: "mem-other-A-002",
  type: "evidence",
  source: "A-002/other",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.5,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Evaluate opportunity", structuredResult: { title: "Novara Socials growth sprint" } },
};

const approvedDecision: ContentReviewDecisionRecord = {
  decisionId: "decision-approved",
  proposalId: "mem-task-approved-A-014",
  agentId: "A-014",
  reviewerId: "guido",
  decision: "approved",
  recordedAt: "2026-01-01T00:05:00.000Z",
};

const rejectedDecision: ContentReviewDecisionRecord = {
  decisionId: "decision-rejected",
  proposalId: "mem-task-rejected-A-014",
  agentId: "A-014",
  reviewerId: "guido",
  decision: "rejected",
  recordedAt: "2026-01-01T00:05:00.000Z",
};

// Read boundary: contract shape, using an in-memory fake store (no real file I/O).
{
  const entries: PublishingQueueEntry[] = [
    { queueEntryId: "queue-1", proposalId: "mem-task-approved-A-014", agentId: "A-014", status: "queued", createdAt: "2026-01-01T00:10:00.000Z", updatedAt: "2026-01-01T00:10:00.000Z" },
  ];
  const readStore = {
    listPublishingQueueEntries: () => entries,
    getPublishingQueueEntry: (queueEntryId: string) => entries.find((entry) => entry.queueEntryId === queueEntryId),
  };

  const list = handlePublishingQueueReadCommand({ operation: "listEntries" }, readStore);
  assert.equal(list.status, "ok");
  if (list.status === "ok") {
    const data = list.data as Array<Record<string, unknown>>;
    assert.equal(data.length, 1);
    assert.deepEqual(
      Object.keys(data[0]).sort(),
      ["agentId", "createdAt", "proposalId", "queueEntryId", "status", "updatedAt"],
      "UI-facing read contract must expose exactly the expected fields",
    );
  }

  const single = handlePublishingQueueReadCommand({ operation: "getEntry", queueEntryId: "queue-1" }, readStore);
  assert.equal(single.status, "ok");

  const missingId = handlePublishingQueueReadCommand({ operation: "getEntry" }, readStore);
  assert.equal(missingId.status, "invalid-request");

  const notFound = handlePublishingQueueReadCommand({ operation: "getEntry", queueEntryId: "does-not-exist" }, readStore);
  assert.equal(notFound.status, "invalid-request");

  const unknownOp = handlePublishingQueueReadCommand({ operation: "unknown" as never }, readStore);
  assert.equal(unknownOp.status, "invalid-request");
}

// Mutation boundary: access control, eligibility rules, audit, and duplicate-entry behavior.
{
  const memory = [approvedEntry, rejectedEntry, nonContentEntry];
  const decisions: ContentReviewDecisionRecord[] = [approvedDecision, rejectedDecision];
  const queueEntries: PublishingQueueEntry[] = [];
  const auditEvents: Array<{ actorId: string; type: string; message: string; payload?: Record<string, unknown> }> = [];

  const workflow: PublishingQueueEnqueueWorkflow = {
    getMemoryEntry: (proposalId) => memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => decisions.find((entry) => entry.proposalId === proposalId),
    getPublishingQueueEntryByProposal: (proposalId) => queueEntries.find((entry) => entry.proposalId === proposalId),
    createPublishingQueueEntry: (entry) => {
      queueEntries.push(entry);
      return entry;
    },
    appendAuditEvent: (event) => {
      auditEvents.push(event as never);
      return { id: "audit-id", timestamp: "2026-01-01T00:00:00.000Z", ...event } as never;
    },
  };

  const access = new LocalPublishingQueueAccessService([
    { identity: "publisher-guido", credential: "enqueue-key", operations: ["enqueueProposal"] },
  ]);

  // Missing credential fails closed. GET-shaped omission (no credential) must not create anything.
  const missingCred = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal", proposalId: "mem-task-approved-A-014" }, undefined, workflow, access);
  assert.equal(missingCred.status, "invalid-request");
  assert.equal(auditEvents.at(-1)?.type, "publishing_queue.authentication_rejected");
  assert.equal(queueEntries.length, 0);

  // Wrong credential fails closed.
  const wrongCred = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal", proposalId: "mem-task-approved-A-014" }, "not-a-real-key", workflow, access);
  assert.equal(wrongCred.status, "invalid-request");
  assert.equal(queueEntries.length, 0);

  // Rejected proposal cannot be enqueued even with valid credentials.
  const rejectedAttempt = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal", proposalId: "mem-task-rejected-A-014" }, "enqueue-key", workflow, access);
  assert.equal(rejectedAttempt.result.status, "rejected");
  assert.equal(queueEntries.length, 0);

  // Non-content evidence cannot be enqueued.
  const nonContentAttempt = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal", proposalId: "mem-other-A-002" }, "enqueue-key", workflow, access);
  assert.equal(nonContentAttempt.result.status, "rejected");
  assert.equal(queueEntries.length, 0);

  // Authorized enqueue of an approved proposal succeeds and is durable in the workflow store.
  const approved = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal", proposalId: "mem-task-approved-A-014" }, "enqueue-key", workflow, access);
  assert.equal(approved.status, "ok");
  assert.equal(approved.result.status, "created");
  if (approved.result.status === "created") {
    assert.equal(approved.result.entry.proposalId, "mem-task-approved-A-014");
    assert.equal(approved.result.entry.agentId, "A-014");
    assert.equal(approved.result.entry.status, "queued");
  }
  assert.equal(auditEvents.at(-1)?.type, "publishing_queue.entry_created");
  assert.equal(queueEntries.length, 1);

  // Duplicate enqueue attempt is rejected, not silently duplicated.
  const duplicate = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal", proposalId: "mem-task-approved-A-014" }, "enqueue-key", workflow, access);
  assert.equal(duplicate.result.status, "rejected");
  assert.match((duplicate.result as { reason: string }).reason, /already queued/i);
  assert.equal(auditEvents.at(-1)?.type, "publishing_queue.enqueue_rejected");
  assert.equal(queueEntries.length, 1, "no second queue entry may be created for the same proposal");

  // Missing proposalId is a clean invalid-request.
  const missingProposalId = handlePublishingQueueEnqueueCommand({ operation: "enqueueProposal" }, "enqueue-key", workflow, access);
  assert.equal(missingProposalId.status, "invalid-request");
}

// K. No Metricool, publishing, or external HTTP publishing in the command boundary.
{
  const source = readFileSync(new URL("./publishing-queue-command.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /metricool/i, "publishing queue command boundary must never call Metricool");
  assert.doesNotMatch(source, /\bpublish\b|schedulePost/i, "publishing queue command boundary must not introduce publishing capability yet");
}

console.log("Publishing queue command tests passed.");
