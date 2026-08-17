import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MetricoolPublishingAdapter } from "./metricool-publishing-adapter.ts";
import { MetricoolPublishingService, type MetricoolPublishingStore } from "./metricool-publishing-service.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import type { CompanyMemoryEntry, ContentReviewDecisionRecord, PublishingQueueEntry } from "./types.ts";

const futureDate = () => {
  const date = new Date(Date.now() + 3600_000).toISOString();
  return { dateTime: date, timezone: "UTC" };
};

const proposal: CompanyMemoryEntry = {
  id: "mem-publish-A-014",
  type: "evidence",
  source: "A-014/publish-test",
  timestamp: "2026-01-01T00:00:00.000Z",
  confidence: 0.8,
  authority: "recommend",
  status: "proposed",
  content: {
    objective: "Publish the approved post",
    structuredResult: {
      platform: "instagram",
      caption: "A real approved caption #novara",
      media: ["https://cdn.example.test/novara-image.jpg"],
      publicationDate: futureDate(),
    },
  },
};
const decision: ContentReviewDecisionRecord = {
  decisionId: "decision-publish",
  proposalId: proposal.id,
  agentId: "A-014",
  reviewerId: "human",
  decision: "approved",
  recordedAt: "2026-01-01T00:01:00.000Z",
};

function makeStore(initialStatus: PublishingQueueEntry["status"] = "queued") {
  let entry: PublishingQueueEntry = {
    queueEntryId: "queue-publish-1",
    proposalId: proposal.id,
    agentId: "A-014",
    status: initialStatus,
    createdAt: "2026-01-01T00:02:00.000Z",
    updatedAt: "2026-01-01T00:02:00.000Z",
  };
  const audits: unknown[] = [];
  const store: MetricoolPublishingStore = {
    getPublishingQueueEntry: () => structuredClone(entry),
    getMemoryEntry: (proposalId) => proposalId === proposal.id ? structuredClone(proposal) : undefined,
    getContentReviewDecisionByProposal: (proposalId) => proposalId === proposal.id ? structuredClone(decision) : undefined,
    claimPublishingQueueEntry: (_queueEntryId, next) => {
      if (entry.status !== "queued") return undefined;
      entry = structuredClone(next);
      return structuredClone(entry);
    },
    updatePublishingQueueEntry: (_queueEntryId, expectedStatus, next) => {
      if (entry.status !== expectedStatus) return undefined;
      entry = structuredClone(next);
      return structuredClone(entry);
    },
    appendAuditEvent: (event) => {
      audits.push(event);
      return { id: "audit", timestamp: "2026-01-01T00:03:00.000Z", ...event } as never;
    },
  };
  return { store, getEntry: () => structuredClone(entry), audits };
}

// R: the published state and verified fields survive a repository reload.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-metricool-publish-durable-"));
  const firstRepository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  firstRepository.upsertMemory(proposal);
  firstRepository.createContentReviewDecision(decision);
  firstRepository.createPublishingQueueEntry({ queueEntryId: "queue-durable", proposalId: proposal.id, agentId: "A-014", status: "queued", createdAt: "2026-01-01T00:02:00.000Z", updatedAt: "2026-01-01T00:02:00.000Z" });
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const store: MetricoolPublishingStore = {
    getPublishingQueueEntry: (id) => repository.getPublishingQueueEntry(id),
    getMemoryEntry: (id) => repository.getSnapshot().memory.find((entry) => entry.id === id),
    getContentReviewDecisionByProposal: (id) => repository.getContentReviewDecisionByProposal(id),
    claimPublishingQueueEntry: (id, entry) => repository.claimPublishingQueueEntry(id, entry),
    updatePublishingQueueEntry: (id, expected, entry) => repository.updatePublishingQueueEntry(id, expected, entry),
    appendAuditEvent: (event) => repository.appendAuditEvent(event),
  };
  await new MetricoolPublishingService(store, makeAdapter(async () => ({ kind: "response", status: 200, body: { data: { id: 99, uuid: "durable-uuid" } } }))).execute("queue-durable");
  const reloaded = new RuntimeRepository(new FileRuntimeStore(storageRoot)).getPublishingQueueEntry("queue-durable");
  assert.equal(reloaded?.status, "published");
  assert.equal(reloaded?.publishExternalId, 99);
  assert.equal(reloaded?.publishExternalUuid, "durable-uuid");
}

function makeAdapter(requester: ConstructorParameters<typeof MetricoolPublishingAdapter>[0]["requester"], reader: ConstructorParameters<typeof MetricoolPublishingAdapter>[0]["reader"] = async () => ({ status: 200 })) {
  return new MetricoolPublishingAdapter({
    env: { METRICOOL_USER_TOKEN: "token-secret", METRICOOL_USER_ID: "user-123", METRICOOL_BLOG_ID: "6694539" },
    requester,
    reader,
  });
}

// A/B/J/Q: valid execution, exact verified REST contract, truthful response persistence, and unchanged proposal.
{
  const { store, getEntry } = makeStore();
  const original = structuredClone(proposal);
  const requests: Array<{ method: string; url: string; headers: Record<string, string>; body: string }> = [];
  const adapter = makeAdapter(async (request) => {
    requests.push(request);
    return {
      kind: "response",
      status: 200,
      body: {
        data: {
          id: 77,
          uuid: "metricool-uuid-77",
          publicationDate: futureDate(),
          creationDate: futureDate(),
          providers: [{ network: "instagram", id: "provider-77", status: "PENDING", publicUrl: "https://app.metricool.com/planner/77", detailedStatus: "accepted" }],
        },
      },
    };
  });
  const result = await new MetricoolPublishingService(store, adapter, () => "attempt-1").execute("queue-publish-1");
  assert.equal(result.status, "published", "valid publish should succeed: " + (result.status === "failed" || result.status === "unknown-result" ? result.reason : ""));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].url, "https://app.metricool.com/api/v2/scheduler/posts?blogId=6694539&userId=user-123");
  assert.equal(requests[0].headers["X-Mc-Auth"], "token-secret");
  const body = JSON.parse(requests[0].body);
  assert.deepEqual(Object.keys(body).sort(), ["autoPublish", "instagramData", "media", "publicationDate", "providers", "text"].sort());
  assert.deepEqual(body.providers, [{ network: "instagram" }]);
  assert.equal(body.text, "A real approved caption #novara");
  assert.deepEqual(body.media, ["https://cdn.example.test/novara-image.jpg"]);
  assert.equal(getEntry().status, "published");
  assert.equal(getEntry().publishExternalId, 77);
  assert.equal(getEntry().publishExternalUuid, "metricool-uuid-77");
  assert.equal(getEntry().publishProviders[0].publicUrl, "https://app.metricool.com/planner/77");
  assert.deepEqual(store.getMemoryEntry(proposal.id), original);
  assert.ok(!JSON.stringify(getEntry()).includes("token-secret"));
}

// C/D/E/F/G/H/I/J: all validation and readiness failures happen before the external POST.
for (const scenario of [
  ["missing queue entry", (store: MetricoolPublishingStore) => ({ ...store, getPublishingQueueEntry: () => undefined }), /not found/i],
  ["wrong agent", (store: MetricoolPublishingStore) => ({ ...store, getPublishingQueueEntry: () => ({ ...makeStore().getEntry(), agentId: "A-002" }) }), /Content Agent/i],
  ["rejected review", (store: MetricoolPublishingStore) => ({ ...store, getContentReviewDecisionByProposal: () => ({ ...decision, decision: "rejected" as const }) }), /not approved/i],
  ["unsupported platform", (store: MetricoolPublishingStore) => ({ ...store, getMemoryEntry: () => ({ ...proposal, content: { ...proposal.content, structuredResult: { ...(proposal.content as Record<string, unknown>).structuredResult as Record<string, unknown>, platform: "tiktok" } } }) }), /Only Instagram/i],
  ["missing media", (store: MetricoolPublishingStore) => ({ ...store, getMemoryEntry: () => ({ ...proposal, content: { ...proposal.content, structuredResult: { platform: "instagram", caption: "text", publicationDate: futureDate() } } }) }), /media URL/i],
  ["missing config", (store: MetricoolPublishingStore) => store, /requires METRICOOL_USER_TOKEN/i],
] as const) {
  const { store } = makeStore();
  const scenarioStore = scenario[1](store);
  let calls = 0;
  const adapter = scenario[0] === "missing config"
    ? new MetricoolPublishingAdapter({ env: {}, requester: async () => { calls += 1; return { kind: "response", status: 200, body: {} }; } })
    : makeAdapter(async () => { calls += 1; return { kind: "response", status: 200, body: {} }; });
  const result = await new MetricoolPublishingService(scenarioStore, adapter).execute("queue-publish-1");
  assert.equal(result.status, "failed", scenario[0]);
  assert.match(result.reason, scenario[2], scenario[0]);
  assert.equal(calls, 0, `${scenario[0]} must not call Metricool`);
}

// H: non-queued, published, and unknown-result states are terminal for automatic execution.
for (const status of ["publishing", "published", "unknown-result"] as const) {
  const { store } = makeStore(status);
  let calls = 0;
  const result = await new MetricoolPublishingService(store, makeAdapter(async () => { calls += 1; return { kind: "response", status: 200, body: {} }; })).execute("queue-publish-1");
  assert.equal(result.status, "failed");
  assert.equal(calls, 0);
}

// K/L/M/N: definitive failure is failed; transport failure is unknown-result and never retried.
{
  const { store, getEntry } = makeStore();
  const failed = await new MetricoolPublishingService(store, makeAdapter(async () => ({ kind: "response", status: 401, body: { error: "rejected" } }))).execute("queue-publish-1");
  assert.equal(failed.status, "failed");
  assert.equal(getEntry().status, "failed");
}
{
  const { store, getEntry } = makeStore();
  let calls = 0;
  const adapter = makeAdapter(async () => { calls += 1; return { kind: "transport-error", code: "timeout", reason: "unknown result" }; });
  const service = new MetricoolPublishingService(store, adapter);
  const first = await service.execute("queue-publish-1");
  const second = await service.execute("queue-publish-1");
  assert.equal(first.status, "unknown-result");
  assert.equal(second.status, "failed");
  assert.equal(getEntry().status, "unknown-result");
  assert.equal(calls, 1);
}

// I: concurrent calls share one durable claim and at most one external request.
{
  const { store } = makeStore();
  let calls = 0;
  const adapter = makeAdapter(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { kind: "response", status: 200, body: { data: { id: 88, providers: [{ network: "instagram", status: "PENDING" }] } } };
  });
  const [first, second] = await Promise.all([
    new MetricoolPublishingService(store, adapter, () => "attempt-a").execute("queue-publish-1"),
    new MetricoolPublishingService(store, adapter, () => "attempt-b").execute("queue-publish-1"),
  ]);
  assert.equal(calls, 1);
  assert.equal([first.status, second.status].filter((status) => status === "published").length, 1);
}

// O/S: execution is explicit service code; no polling/startup/page-load path invokes it.
{
  const appSource = readFileSync(new URL("../../../apps/command-interface/public/app.js", import.meta.url), "utf8");
  const serverSource = readFileSync(new URL("../../../apps/command-interface/src/server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /setInterval[^\n]*(publishing-execute|metricool-publish)|loadPublishingQueue[^\n]*(publishing-execute|metricool-publish)/i);
  assert.doesNotMatch(serverSource, /setInterval.*publishing-execute|MetricoolPublishingService.*setInterval/i);
}

console.log("Metricool publishing service tests passed.");
