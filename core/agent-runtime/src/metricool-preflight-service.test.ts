import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRuntime } from "./runtime.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { ContentReviewDecisionService, type ContentReviewDecisionStore } from "./content-review-service.ts";
import { PublishingQueueEnqueueService, type PublishingQueueEnqueueStore } from "./publishing-queue-service.ts";
import { MetricoolPreflightService, type MetricoolPreflightStore } from "./metricool-preflight-service.ts";
import type { MetricoolReadiness } from "./metricool-adapter.ts";
import type { ContentProviderRequester } from "./content-provider.ts";

const CONTENT_AGENT_ID = "A-014";

function openAiEnvelope(body: Record<string, unknown>): unknown {
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}

const proposalBody = {
  summary: "Summary of the supplied content.",
  platform: "instagram",
  hook: "A compelling hook.",
  title: "A working title",
  caption: "The full caption text.",
  hashtags: ["novara", "launch"],
  angle: "curiosity",
  confidence: 0.65,
  reasons: ["Clear narrative.", "Relevant to audience."],
};

async function createProposal(runtime: AgentRuntime, taskId: string) {
  const requester: ContentProviderRequester = async () => openAiEnvelope(proposalBody);
  const response = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: taskId, objective: `Objective for ${taskId}`, input: { content: "Some real supplied content." } },
    { contentProvider: { env: { OPENAI_API_KEY: "test-key-not-a-real-secret" }, requester } },
  );
  assert.equal(response.result.status, "completed", "test setup must produce a real completed proposal");
  return `mem-${taskId}-${CONTENT_AGENT_ID}`;
}

function decisionStoreFor(repository: RuntimeRepository): ContentReviewDecisionStore {
  return {
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
  };
}

function recordDecision(repository: RuntimeRepository, proposalId: string, decision: "approved" | "rejected", decisionId: string) {
  const service = new ContentReviewDecisionService(decisionStoreFor(repository));
  const result = service.record({ decisionId, proposalId, agentId: CONTENT_AGENT_ID, reviewerId: "guido", decision });
  assert.equal(result.status, "created", "test setup must record a real decision");
  if (result.status === "created") repository.createContentReviewDecision(result.record);
}

function enqueueStoreFor(repository: RuntimeRepository): PublishingQueueEnqueueStore {
  return {
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
    getPublishingQueueEntryByProposal: (proposalId) => repository.getPublishingQueueEntryByProposal(proposalId),
  };
}

function preflightStoreFor(repository: RuntimeRepository): MetricoolPreflightStore {
  return {
    getPublishingQueueEntry: (queueEntryId) => repository.getPublishingQueueEntry(queueEntryId),
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
  };
}

const readyReadiness = async (): Promise<MetricoolReadiness> => ({ state: "ready", reason: "fake ready for test" });
const notConfiguredReadiness = async (): Promise<MetricoolReadiness> => ({ state: "not-configured", reason: "fake not configured for test" });

// F. Only a real queued entry can reach "ready".
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-metricool-preflight-ready-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "preflight-ready-1");

  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "approved", "decision-preflight-ready-1");
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const enqueued = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-preflight-ready-1", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(enqueued.status, "created");
  if (enqueued.status === "created") repository.createPublishingQueueEntry(enqueued.entry);
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const service = new MetricoolPreflightService(preflightStoreFor(repository), readyReadiness);
  const result = await service.preflight("queue-preflight-ready-1");
  assert.equal(result.status, "ready");
  if (result.status === "ready") {
    assert.equal(result.proposalId, proposalId);
    assert.equal(result.queueEntryId, "queue-preflight-ready-1");
  }

  const notConfiguredService = new MetricoolPreflightService(preflightStoreFor(repository), notConfiguredReadiness);
  const notConfiguredResult = await notConfiguredService.preflight("queue-preflight-ready-1");
  assert.equal(notConfiguredResult.status, "not-configured");
}

// G. Missing queue entry fails closed.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-metricool-preflight-missing-"));
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const service = new MetricoolPreflightService(preflightStoreFor(repository), readyReadiness);
  const result = await service.preflight("queue-does-not-exist");
  assert.equal(result.status, "validation-failed");
  assert.match((result as { reason: string }).reason, /not found/i);
}

// H. Non-queued entry fails closed (e.g. proposal was approved but never enqueued).
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-metricool-preflight-nonqueued-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "preflight-nonqueued-1");
  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "approved", "decision-preflight-nonqueued-1");
  // Manually create a queue entry with a non-"queued" status to prove the check rejects it.
  repository.createPublishingQueueEntry({ queueEntryId: "queue-preflight-nonqueued-1", proposalId, agentId: CONTENT_AGENT_ID, status: "queued", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  // Simulate a non-"queued" status via a store override (status field is otherwise append-only/immutable in the real repository).
  const overrideStore: MetricoolPreflightStore = {
    ...preflightStoreFor(repository),
    getPublishingQueueEntry: (queueEntryId) => {
      const entry = repository.getPublishingQueueEntry(queueEntryId);
      return entry ? { ...entry, status: "not-queued" as never } : undefined;
    },
  };
  const service = new MetricoolPreflightService(overrideStore, readyReadiness);
  const result = await service.preflight("queue-preflight-nonqueued-1");
  assert.equal(result.status, "validation-failed");
  assert.match((result as { reason: string }).reason, /not "queued"/i);
}

// I. Rejected / unreviewed / non-content proposals cannot bypass the lifecycle through this adapter.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-metricool-preflight-invalid-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

  // Rejected proposal: never reaches the queue at all (PublishingQueueEnqueueService already
  // blocks this - proven in publishing-queue-service.test.ts). Confirm the preflight boundary
  // also fails closed on a queue entry that references a rejected proposal, in case one is
  // ever constructed out-of-band.
  const rejectedProposalId = await createProposal(runtime, "preflight-rejected-1");
  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, rejectedProposalId, "rejected", "decision-preflight-rejected-1");
  repository.createPublishingQueueEntry({ queueEntryId: "queue-preflight-rejected-1", proposalId: rejectedProposalId, agentId: CONTENT_AGENT_ID, status: "queued", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const rejectedResult = await new MetricoolPreflightService(preflightStoreFor(repository), readyReadiness).preflight("queue-preflight-rejected-1");
  assert.equal(rejectedResult.status, "validation-failed");
  assert.match((rejectedResult as { reason: string }).reason, /not approved/i);

  // Non-content evidence: construct an out-of-band queue entry referencing A-002 evidence.
  await runtime.executeSpecialist("A-002", { id: "preflight-noncontent-a002", objective: "Evaluate the current opportunity", input: {} });
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  repository.createPublishingQueueEntry({ queueEntryId: "queue-preflight-noncontent-1", proposalId: "mem-preflight-noncontent-a002-A-002", agentId: CONTENT_AGENT_ID, status: "queued", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" });
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const nonContentResult = await new MetricoolPreflightService(preflightStoreFor(repository), readyReadiness).preflight("queue-preflight-noncontent-1");
  assert.equal(nonContentResult.status, "validation-failed");
  assert.match((nonContentResult as { reason: string }).reason, /not found|not valid content evidence/i);
}

// D/E (static): the preflight service never creates queue entries and never executes A-014 or another specialist.
{
  const source = readFileSync(new URL("./metricool-preflight-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /createPublishingQueueEntry|executeSpecialist|\.execute\(/, "the preflight service must never create queue entries or execute a specialist");
  assert.doesNotMatch(source, /content-provider|openai/i, "the preflight service must never call the AI provider");
  assert.doesNotMatch(source, /metricool\.com|instagram|tiktok|youtube/i, "the preflight service must never contain a hardcoded external publishing endpoint");
}

console.log("Metricool preflight service tests passed.");
