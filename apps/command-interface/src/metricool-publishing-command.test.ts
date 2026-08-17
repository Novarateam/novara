import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MetricoolPublishingAdapter } from "../../../core/agent-runtime/src/metricool-publishing-adapter.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, PublishingQueueEntry } from "../../../core/agent-runtime/src/types.ts";
import { handleMetricoolPublishingCommand, type MetricoolPublishingCommand } from "./metricool-publishing-command.ts";
import { LocalMetricoolPublishingAccessService } from "./metricool-publishing-access-service.ts";
import type { MetricoolPublishingStore } from "../../../core/agent-runtime/src/metricool-publishing-service.ts";

const credential = "publish-local-secret";
const proposal: CompanyMemoryEntry = {
  id: "mem-command-publish-A-014",
  type: "evidence",
  source: "A-014/command-publish",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.8,
  authority: "recommend",
  status: "proposed",
  content: { structuredResult: { platform: "instagram", caption: "Approved text", media: ["https://cdn.example.test/image.jpg"], publicationDate: { dateTime: new Date(Date.now() + 3600_000).toISOString(), timezone: "UTC" } } },
};
const decision: ContentReviewDecisionRecord = { decisionId: "decision-command-publish", proposalId: proposal.id, agentId: "A-014", reviewerId: "human", decision: "approved", recordedAt: "2026-01-01T00:01:00.000Z" };

function storeFor(status: PublishingQueueEntry["status"] = "queued") {
  let entry: PublishingQueueEntry = { queueEntryId: "queue-command-publish", proposalId: proposal.id, agentId: "A-014", status, createdAt: "2026-01-01T00:02:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z" };
  const audits: unknown[] = [];
  const store: MetricoolPublishingStore = {
    getPublishingQueueEntry: () => structuredClone(entry),
    getMemoryEntry: () => structuredClone(proposal),
    getContentReviewDecisionByProposal: () => structuredClone(decision),
    claimPublishingQueueEntry: (_id, next) => entry.status === "queued" ? (entry = structuredClone(next), structuredClone(entry)) : undefined,
    updatePublishingQueueEntry: (_id, expected, next) => entry.status === expected ? (entry = structuredClone(next), structuredClone(entry)) : undefined,
    appendAuditEvent: (event) => { audits.push(event); return { id: "audit", timestamp: "2026-01-01T00:03:00.000Z", ...event } as never; },
  };
  return { store, audits, getEntry: () => structuredClone(entry) };
}

const access = new LocalMetricoolPublishingAccessService([{ identity: "human-publisher", credential, operations: ["publishQueueEntry"] }]);
const successfulAdapter = () => new MetricoolPublishingAdapter({
  env: { METRICOOL_USER_TOKEN: "token", METRICOOL_USER_ID: "user", METRICOOL_BLOG_ID: "6694539" },
  reader: async () => ({ status: 200 }),
  requester: async () => ({ kind: "response", status: 200, body: { data: { id: 1, providers: [{ network: "instagram", status: "PENDING" }] } } }),
});

// Missing/wrong credentials and unsupported operations fail before the adapter is reached.
for (const [supplied, operation] of [[undefined, "publishQueueEntry"], ["wrong", "publishQueueEntry"], [credential, "preflightQueueEntry"]] as const) {
  const { store, audits } = storeFor();
  let calls = 0;
  const adapter = new MetricoolPublishingAdapter({ env: {}, requester: async () => { calls += 1; return { kind: "response", status: 200, body: {} }; } });
  const result = await handleMetricoolPublishingCommand({ operation: operation as MetricoolPublishingCommand["operation"], queueEntryId: "queue-command-publish" }, supplied, store, access, adapter);
  assert.equal(result.status, "invalid-request");
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(result).includes(credential));
  assert.equal(audits.length, 1);
}

// Explicit authorized command reaches the real execution service and returns only safe result data.
{
  const { store, getEntry } = storeFor();
  const result = await handleMetricoolPublishingCommand({ operation: "publishQueueEntry", queueEntryId: "queue-command-publish" }, credential, store, access, successfulAdapter());
  assert.equal(result.status, "ok");
  if (result.status === "ok") assert.equal(result.result.status, "published");
  assert.equal(getEntry().status, "published");
  assert.ok(!JSON.stringify(result).includes(credential));
}

// GET/read surfaces remain free of this mutation boundary and no autonomous trigger is introduced.
{
  const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
  const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(serverSource, /\/api\/publishing-execute/);
  assert.doesNotMatch(appSource, /setInterval\([^\n]*publishing-execute|fetch\("\/api\/publishing-execute"\).*load/);
}

console.log("Metricool publishing command tests passed.");
