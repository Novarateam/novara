import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  handleContentReviewReadCommand,
  handleContentReviewDecisionCommand,
  type ContentReviewDecisionWorkflow,
} from "./content-review-command.ts";
import { LocalContentReviewAccessService } from "./content-review-access-service.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord } from "../../../core/agent-runtime/src/types.ts";

const contentEntry: CompanyMemoryEntry = {
  id: "mem-task-1-A-014",
  type: "evidence",
  source: "A-014/task-1",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.6,
  authority: "recommend",
  status: "proposed",
  content: { objective: "Propose a post", structuredResult: { summary: "s", platform: "instagram", hook: "h", title: "t", caption: "c", hashtags: ["a"], angle: "an", confidence: 0.6, reasons: ["r"], humanReviewRequired: true } },
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

// Read boundary: contract shape and filtering, using an in-memory fake store (no real file I/O).
{
  const memory = [contentEntry, nonContentEntry];
  const decisions: ContentReviewDecisionRecord[] = [];
  const readStore = {
    listMemory: () => memory,
    getContentReviewDecisionByProposal: (proposalId: string) => decisions.find((entry) => entry.proposalId === proposalId),
  };

  const list = handleContentReviewReadCommand({ operation: "listProposals" }, readStore);
  assert.equal(list.status, "ok");
  if (list.status === "ok") {
    const data = list.data as Array<Record<string, unknown>>;
    assert.equal(data.length, 1, "non-content evidence must be excluded");
    assert.deepEqual(
      Object.keys(data[0]).sort(),
      ["agentId", "createdAt", "decision", "objective", "proposalId", "status", "structuredResult"],
      "UI-facing read contract must expose exactly the expected fields",
    );
    assert.equal(data[0].proposalId, "mem-task-1-A-014");
    assert.equal(data[0].status, "proposed");
  }

  const single = handleContentReviewReadCommand({ operation: "getProposal", proposalId: "mem-task-1-A-014" }, readStore);
  assert.equal(single.status, "ok");

  const missingId = handleContentReviewReadCommand({ operation: "getProposal" }, readStore);
  assert.equal(missingId.status, "invalid-request");

  const notFound = handleContentReviewReadCommand({ operation: "getProposal", proposalId: "mem-other-A-002" }, readStore);
  assert.equal(notFound.status, "invalid-request", "non-content evidence must not be retrievable through this boundary");

  const unknownOp = handleContentReviewReadCommand({ operation: "unknown" as never }, readStore);
  assert.equal(unknownOp.status, "invalid-request");
}

// Mutation boundary: access control, authenticated identity, audit, and duplicate-decision behavior.
{
  const memory = [contentEntry, nonContentEntry];
  const decisions: ContentReviewDecisionRecord[] = [];
  const auditEvents: Array<{ actorId: string; type: string; message: string; payload?: Record<string, unknown> }> = [];

  const workflow: ContentReviewDecisionWorkflow = {
    getMemoryEntry: (proposalId) => memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => decisions.find((entry) => entry.proposalId === proposalId),
    createContentReviewDecision: (record) => {
      decisions.push(record);
      return record;
    },
    appendAuditEvent: (event) => {
      auditEvents.push(event as never);
      return { id: "audit-id", timestamp: "2026-01-01T00:00:00.000Z", ...event } as never;
    },
  };

  const access = new LocalContentReviewAccessService([
    { identity: "reviewer-guido", credential: "approve-key", operations: ["approveProposal"] },
    { identity: "reviewer-guido", credential: "reject-key", operations: ["rejectProposal"] },
  ]);

  // Missing credential fails closed.
  const missingCred = handleContentReviewDecisionCommand({ operation: "approveProposal", proposalId: "mem-task-1-A-014" }, undefined, workflow, access);
  assert.equal(missingCred.status, "invalid-request");
  assert.equal(auditEvents.at(-1)?.type, "content_review.authentication_rejected");

  // Wrong credential fails closed.
  const wrongCred = handleContentReviewDecisionCommand({ operation: "approveProposal", proposalId: "mem-task-1-A-014" }, "not-a-real-key", workflow, access);
  assert.equal(wrongCred.status, "invalid-request");

  // Correct credential but wrong operation for that credential fails closed.
  const wrongOperation = handleContentReviewDecisionCommand({ operation: "rejectProposal", proposalId: "mem-task-1-A-014" }, "approve-key", workflow, access);
  assert.equal(wrongOperation.status, "invalid-request");
  assert.equal(auditEvents.at(-1)?.type, "content_review.authorization_rejected");

  // Authorized approval: reviewer identity comes only from the authenticated credential.
  const approved = handleContentReviewDecisionCommand({ operation: "approveProposal", proposalId: "mem-task-1-A-014" }, "approve-key", workflow, access);
  assert.equal(approved.status, "ok");
  assert.equal(approved.result.status, "created");
  if (approved.result.status === "created") {
    assert.equal(approved.result.record.reviewerId, "reviewer-guido");
    assert.equal(approved.result.record.proposalId, "mem-task-1-A-014");
    assert.equal(approved.result.record.agentId, "A-014");
    assert.equal(approved.result.record.decision, "approved");
  }
  assert.equal(auditEvents.at(-1)?.type, "content_review.decision_recorded");
  assert.equal(decisions.length, 1);

  // Duplicate/conflicting decision: exactly-once rule enforced at the command boundary too.
  const duplicate = handleContentReviewDecisionCommand({ operation: "rejectProposal", proposalId: "mem-task-1-A-014" }, "reject-key", workflow, access);
  assert.equal(duplicate.status, "ok");
  assert.equal(duplicate.result.status, "rejected", "a conflicting decision after one is already recorded must be rejected, not silently applied");
  assert.equal(auditEvents.at(-1)?.type, "content_review.decision_rejected");
  assert.equal(decisions.length, 1, "no second decision may be recorded for the same proposal");

  // Non-content evidence cannot be approved through the content-review boundary.
  const wrongEntry = handleContentReviewDecisionCommand({ operation: "approveProposal", proposalId: "mem-other-A-002" }, "approve-key", workflow, access);
  assert.equal(wrongEntry.result.status, "rejected");

  // Unknown proposal id fails clearly.
  const unknownProposal = handleContentReviewDecisionCommand({ operation: "approveProposal", proposalId: "mem-does-not-exist" }, "approve-key", workflow, access);
  assert.equal(unknownProposal.result.status, "rejected");

  // Missing proposalId is a clean invalid-request, not a thrown exception.
  const missingProposalId = handleContentReviewDecisionCommand({ operation: "approveProposal" }, "approve-key", workflow, access);
  assert.equal(missingProposalId.status, "invalid-request");
}

// G. No publication: neither the read nor the decision command contacts Metricool or any publishing API.
{
  const readSource = readFileSync(new URL("./content-review-command.ts", import.meta.url), "utf8");
  assert.doesNotMatch(readSource, /metricool/i, "content review command boundary must never call Metricool");
  assert.doesNotMatch(readSource, /publish|schedulePost|external.?action/i, "content review command boundary must not introduce publishing capability");
}

console.log("Content review command tests passed.");
