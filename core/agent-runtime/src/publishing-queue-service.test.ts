import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRuntime } from "./runtime.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { ContentReviewDecisionService, type ContentReviewDecisionStore } from "./content-review-service.ts";
import {
  PublishingQueueEnqueueService,
  PublishingQueueReadService,
  type PublishingQueueEnqueueStore,
  type PublishingQueueReadStore,
} from "./publishing-queue-service.ts";
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

function readStoreFor(repository: RuntimeRepository): PublishingQueueReadStore {
  return {
    listPublishingQueueEntries: () => repository.listPublishingQueueEntries(),
    getPublishingQueueEntry: (queueEntryId) => repository.getPublishingQueueEntry(queueEntryId),
  };
}

// A. Approved A-014 proposal can enter the queue.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-approve-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "queue-approve-1");

  // Repository must be constructed AFTER the writes it needs to observe (see prior fix note).
  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "approved", "decision-queue-approve-1");
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const enqueueService = new PublishingQueueEnqueueService(enqueueStoreFor(repository));
  const result = enqueueService.enqueue({ queueEntryId: "queue-entry-1", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(result.status, "created");
  if (result.status === "created") {
    assert.equal(result.entry.proposalId, proposalId);
    assert.equal(result.entry.agentId, CONTENT_AGENT_ID);
    assert.equal(result.entry.status, "queued");
    repository.createPublishingQueueEntry(result.entry);
  }

  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const listed = new PublishingQueueReadService(readStoreFor(repository)).listEntries();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].proposalId, proposalId);
}

// B. Rejected proposal cannot enter the queue.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-rejected-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "queue-rejected-1");

  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "rejected", "decision-queue-rejected-1");
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const result = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-entry-rejected", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(result.status, "rejected");
  assert.match((result as { reason: string }).reason, /rejected/i);
  assert.equal(repository.listPublishingQueueEntries().length, 0);
}

// C. Proposal with no Content Review decision cannot enter the queue.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-nodecision-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "queue-nodecision-1");

  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const result = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-entry-nodecision", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(result.status, "rejected");
  assert.match((result as { reason: string }).reason, /no recorded review decision/i);
}

// D. Non-A-014 / non-content evidence cannot enter the queue.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-noncontent-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  await runtime.executeSpecialist("A-002", { id: "queue-noncontent-a002", objective: "Evaluate the current opportunity", input: {} });

  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const result = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({
    queueEntryId: "queue-entry-noncontent",
    proposalId: "mem-queue-noncontent-a002-A-002",
    agentId: CONTENT_AGENT_ID,
  });
  assert.equal(result.status, "rejected");
  assert.match((result as { reason: string }).reason, /not found/i);
}

// E. Repeated enqueue attempts obey the explicit duplicate rule (exactly one entry per proposalId; reject clearly).
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-duplicate-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "queue-duplicate-1");

  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "approved", "decision-queue-duplicate-1");
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const first = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-entry-dup-1", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(first.status, "created");
  if (first.status === "created") repository.createPublishingQueueEntry(first.entry);

  const second = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-entry-dup-2", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(second.status, "rejected", "a repeated enqueue attempt for the same proposal must be rejected, not silently duplicated");
  assert.match((second as { reason: string }).reason, /already queued/i);
  assert.equal(repository.listPublishingQueueEntries().length, 1, "no duplicate queue entry may be created");
}

// F. Queue state survives reconstructing the repository/runtime from the same storage root.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-reload-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "queue-reload-1");

  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "approved", "decision-queue-reload-1");
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const created = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-entry-reload-1", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(created.status, "created");
  if (created.status === "created") repository.createPublishingQueueEntry(created.entry);

  const reloadedRepository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const reloadedEntry = reloadedRepository.getPublishingQueueEntryByProposal(proposalId);
  assert.ok(reloadedEntry, "the queue entry must survive reconstructing the repository from the same storage root");
  assert.equal(reloadedEntry?.status, "queued");

  const reloadedRuntime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) reloadedRuntime.registerAgent(definition);
  const reloadedViaRuntime = new RuntimeRepository(new FileRuntimeStore(storageRoot)).getPublishingQueueEntryByProposal(proposalId);
  assert.ok(reloadedViaRuntime, "the queue entry must also survive a fresh Runtime construction from the same storage root");
}

// G. GET/list/read operations do not mutate state.json or audit.log. H. Enqueueing does not alter the original proposal output.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-publishing-queue-purity-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "queue-purity-1");

  let repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  recordDecision(repository, proposalId, "approved", "decision-queue-purity-1");
  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const originalStructuredResult = JSON.stringify(
    (repository.getSnapshot().memory.find((entry) => entry.id === proposalId)?.content as { structuredResult?: unknown })?.structuredResult,
  );

  // Reads must not mutate.
  const stateBeforeReads = readFileSync(path.join(storageRoot, "state.json"), "utf8");
  const auditBeforeReads = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
  const readService = new PublishingQueueReadService(readStoreFor(repository));
  for (let i = 0; i < 5; i += 1) {
    readService.listEntries();
    readService.getEntry("does-not-exist");
  }
  assert.equal(readFileSync(path.join(storageRoot, "state.json"), "utf8"), stateBeforeReads, "repeated reads must not mutate persisted state");
  assert.equal(readFileSync(path.join(storageRoot, "audit.log"), "utf8"), auditBeforeReads, "repeated reads must not append audit events");

  // Enqueueing must not alter the original AI output.
  const enqueueResult = new PublishingQueueEnqueueService(enqueueStoreFor(repository)).enqueue({ queueEntryId: "queue-entry-purity-1", proposalId, agentId: CONTENT_AGENT_ID });
  assert.equal(enqueueResult.status, "created");
  if (enqueueResult.status === "created") repository.createPublishingQueueEntry(enqueueResult.entry);

  repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const afterStructuredResult = JSON.stringify(
    (repository.getSnapshot().memory.find((entry) => entry.id === proposalId)?.content as { structuredResult?: unknown })?.structuredResult,
  );
  assert.equal(afterStructuredResult, originalStructuredResult, "the original proposal structuredResult must remain unchanged after enqueueing");
}

// K. No Metricool, publishing, external HTTP publishing, or AI execution behavior in this service.
{
  const source = readFileSync(new URL("./publishing-queue-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /metricool/i, "publishing queue service must never call Metricool");
  assert.doesNotMatch(source, /fetch\(|node:http|child_process/, "publishing queue service must remain a pure in-process persistence/read boundary");
  assert.doesNotMatch(source, /openai|content-provider/i, "publishing queue service must never execute A-014 or call an AI provider");
}

console.log("Publishing queue service tests passed.");
