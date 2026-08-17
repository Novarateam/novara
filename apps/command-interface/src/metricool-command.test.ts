import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import {
  handleMetricoolPreflightCommand,
  handleMetricoolStatusCommand,
  type MetricoolPreflightWorkflow,
} from "./metricool-command.ts";
import { LocalMetricoolAccessService } from "./metricool-access-service.ts";
import type {
  CompanyMemoryEntry,
  ContentReviewDecisionRecord,
  PublishingQueueEntry,
} from "../../../core/agent-runtime/src/types.ts";

const SECRET = "metricool-command-secret-must-not-leak";
const proposal: CompanyMemoryEntry = {
  id: "mem-command-content-A-014",
  type: "evidence",
  source: "A-014/task-command",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.7,
  authority: "recommend",
  status: "proposed",
  content: {
    objective: "Prepare a social post",
    structuredResult: {
      summary: "A content proposal",
      platform: "instagram",
      hook: "A hook",
      title: "A title",
      caption: "A caption",
      hashtags: ["novara"],
      angle: "education",
      confidence: 0.7,
      reasons: ["Relevant"],
      humanReviewRequired: true,
    },
  },
};
const approved: ContentReviewDecisionRecord = {
  decisionId: "decision-command-approved",
  proposalId: proposal.id,
  agentId: "A-014",
  reviewerId: "guido",
  decision: "approved",
  recordedAt: "2026-01-01T00:05:00.000Z",
};
const queued: PublishingQueueEntry = {
  queueEntryId: "queue-command-1",
  proposalId: proposal.id,
  agentId: "A-014",
  status: "queued",
  createdAt: "2026-01-01T00:10:00.000Z",
  updatedAt: "2026-01-01T00:10:00.000Z",
};

function makeWorkflow(overrides: Partial<MetricoolPreflightWorkflow> = {}) {
  const auditEvents: unknown[] = [];
  const workflow: MetricoolPreflightWorkflow = {
    getPublishingQueueEntry: () => queued,
    getMemoryEntry: (proposalId) => proposalId === proposal.id ? proposal : undefined,
    getContentReviewDecisionByProposal: (proposalId) => proposalId === proposal.id ? approved : undefined,
    appendAuditEvent: (event) => {
      auditEvents.push(event);
      return { id: "audit-command", timestamp: "2026-01-01T00:20:00.000Z", ...event } as never;
    },
    ...overrides,
  };
  return { workflow, auditEvents };
}

const access = new LocalMetricoolAccessService([
  { identity: "publisher-guido", credential: SECRET, operations: ["preflightQueueEntry"] },
]);

// Missing credentials fail closed and do not expose the supplied secret.
{
  const { workflow, auditEvents } = makeWorkflow();
  const result = await handleMetricoolPreflightCommand({ operation: "preflightQueueEntry", queueEntryId: queued.queueEntryId }, undefined, workflow, access);
  assert.equal(result.status, "invalid-request");
  assert.ok(!JSON.stringify(result).includes(SECRET));
  assert.equal(auditEvents.length, 1);
  assert.equal((auditEvents[0] as { type: string }).type, "metricool.authentication_rejected");
}

// Wrong credentials fail closed without invoking the lifecycle workflow.
{
  let workflowCalls = 0;
  const { workflow, auditEvents } = makeWorkflow({
    getPublishingQueueEntry: () => {
      workflowCalls += 1;
      return queued;
    },
  });
  const result = await handleMetricoolPreflightCommand({ operation: "preflightQueueEntry", queueEntryId: queued.queueEntryId }, "wrong-key", workflow, access);
  assert.equal(result.status, "invalid-request");
  assert.equal(workflowCalls, 0);
  assert.equal((auditEvents[0] as { type: string }).type, "metricool.authentication_rejected");
}

// An authenticated identity controls authorization; unsupported operations cannot be smuggled through.
{
  const { workflow, auditEvents } = makeWorkflow();
  const result = await handleMetricoolPreflightCommand({ operation: "publishPost" as never, queueEntryId: queued.queueEntryId }, SECRET, workflow, access);
  assert.equal(result.status, "invalid-request");
  assert.equal(auditEvents.length, 1);
  assert.equal((auditEvents[0] as { type: string }).type, "metricool.authorization_rejected");
  assert.ok(!JSON.stringify(result).includes(SECRET));
}

// Valid local access reaches the real preflight boundary, which fails closed here because no
// Metricool API key is configured. The command does not invent a successful readiness result.
{
  const { workflow, auditEvents } = makeWorkflow();
  const result = await handleMetricoolPreflightCommand({ operation: "preflightQueueEntry", queueEntryId: queued.queueEntryId }, SECRET, workflow, access);
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.result.status, "not-configured");
    assert.ok(!JSON.stringify(result).includes(SECRET));
  }
  assert.equal((auditEvents.at(-1) as { type: string }).type, "metricool.preflight_checked");
}

// Proposal, queue, and approval lifecycle failures are returned by the command without any
// external readiness check or mutation.
for (const scenario of [
  {
    name: "missing queue entry",
    workflow: makeWorkflow({ getPublishingQueueEntry: () => undefined }).workflow,
    expected: /not found/i,
  },
  {
    name: "not queued",
    workflow: makeWorkflow({ getPublishingQueueEntry: () => ({ ...queued, status: "not-queued" as never }) }).workflow,
    expected: /not "queued"/i,
  },
  {
    name: "not approved",
    workflow: makeWorkflow({ getContentReviewDecisionByProposal: () => ({ ...approved, decision: "rejected" }) }).workflow,
    expected: /not approved/i,
  },
]) {
  const result = await handleMetricoolPreflightCommand({ operation: "preflightQueueEntry", queueEntryId: queued.queueEntryId }, SECRET, scenario.workflow, access);
  assert.equal(result.status, "ok", scenario.name);
  if (result.status === "ok") {
    assert.equal(result.result.status, "validation-failed", "invalid lifecycle evidence must fail before readiness");
    if (scenario.expected) assert.match((result.result as { reason: string }).reason, scenario.expected);
  }
}

// GET status is read-only. With missing configuration it does not write runtime files or audit entries.
{
  const statePath = "./.novara/runtime/state.json";
  const auditPath = "./.novara/runtime/audit.log";
  const beforeState = statSync(statePath, { throwIfNoEntry: false })?.mtimeMs;
  const beforeAudit = statSync(auditPath, { throwIfNoEntry: false })?.mtimeMs;
  const result = await handleMetricoolStatusCommand();
  assert.equal(result.status, "ok");
  assert.equal(result.state, "not-configured");
  const afterState = statSync(statePath, { throwIfNoEntry: false })?.mtimeMs;
  const afterAudit = statSync(auditPath, { throwIfNoEntry: false })?.mtimeMs;
  assert.equal(afterState, beforeState);
  assert.equal(afterAudit, beforeAudit);
}

// Static safety checks: no scheduler, retry loop, bulk action, or social-post action is present.
{
  const commandSource = readFileSync(new URL("./metricool-command.ts", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(commandSource, /setInterval|setTimeout|cron|retry|bulk/i);
  assert.doesNotMatch(commandSource, /schedulePost|postToInstagram|publishPost|createPost/i);
  assert.doesNotMatch(serverSource, /schedulePost|postToInstagram|publishPost|createPost/i);
}

console.log("Metricool command tests passed.");
