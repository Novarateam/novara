import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { AgentRuntime } from "./runtime.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import {
  ContentReviewReadService,
  ContentReviewDecisionService,
  type ContentReviewReadStore,
  type ContentReviewDecisionStore,
} from "./content-review-service.ts";
import type { ContentReviewDecisionRecord } from "./types.ts";
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

function readStoreFor(repository: RuntimeRepository): ContentReviewReadStore {
  return {
    listMemory: () => repository.getSnapshot().memory,
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
  };
}

function decisionStoreFor(repository: RuntimeRepository): ContentReviewDecisionStore {
  return {
    getMemoryEntry: (proposalId) => repository.getSnapshot().memory.find((entry) => entry.id === proposalId),
    getContentReviewDecisionByProposal: (proposalId) => repository.getContentReviewDecisionByProposal(proposalId),
  };
}

async function createProposal(runtime: AgentRuntime, taskId: string, body: Record<string, unknown> = proposalBody) {
  const requester: ContentProviderRequester = async () => openAiEnvelope(body);
  const response = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: taskId, objective: `Objective for ${taskId}`, input: { content: "Some real supplied content." } },
    { contentProvider: { env: { OPENAI_API_KEY: "test-key-not-a-real-secret" }, requester } },
  );
  assert.equal(response.result.status, "completed", "test setup must produce a real completed proposal");
  return `mem-${taskId}-${CONTENT_AGENT_ID}`;
}

// A. Real proposal discovery: persisted proposed A-014 evidence is found; non-content evidence is excluded.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-review-discovery-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

  const proposalId = await createProposal(runtime, "review-discovery-1");

  // Real, unrelated evidence from A-002 must not be mistaken for a content proposal.
  await runtime.executeSpecialist("A-002", { id: "review-discovery-a002", objective: "Evaluate the current opportunity", input: {} });

  // Constructed after the writes above: RuntimeRepository caches its snapshot at construction time.
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const readStore = readStoreFor(repository);
  const readService = new ContentReviewReadService(readStore);
  const proposals = readService.listProposals();

  assert.equal(proposals.length, 1, "only the real A-014 proposal must be discovered");
  assert.equal(proposals[0].proposalId, proposalId);
  assert.equal(proposals[0].status, "proposed");
  assert.equal(proposals[0].structuredResult.platform, "instagram");

  const fetched = readService.getProposal(proposalId);
  assert.ok(fetched, "getProposal must find the persisted proposal");
  assert.equal(fetched?.status, "proposed");

  assert.equal(readService.getProposal("mem-review-discovery-a002-A-002"), undefined, "A-002 evidence must not be retrievable through the content-review boundary");
}

// B. Read purity: repeated list/read operations do not mutate persisted state or the audit log.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-review-purity-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "review-purity-1");
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const stateBefore = readFileSync(path.join(storageRoot, "state.json"), "utf8");
  const auditBefore = readFileSync(path.join(storageRoot, "audit.log"), "utf8");

  const readService = new ContentReviewReadService(readStoreFor(repository));
  for (let i = 0; i < 5; i += 1) {
    readService.listProposals();
    readService.getProposal(proposalId);
  }

  const stateAfter = readFileSync(path.join(storageRoot, "state.json"), "utf8");
  const auditAfter = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
  assert.equal(stateAfter, stateBefore, "repeated reads must not mutate persisted state");
  assert.equal(auditAfter, auditBefore, "repeated reads must not append audit events");
}

// C. Approval: valid proposed content can be approved; decision records required fields;
// approved state and the original AI output survive Runtime reload.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-review-approve-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "review-approve-1");
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const originalEntry = repository.getSnapshot().memory.find((entry) => entry.id === proposalId);
  const originalStructuredResult = JSON.stringify((originalEntry?.content as { structuredResult?: unknown })?.structuredResult);

  const decisionService = new ContentReviewDecisionService(decisionStoreFor(repository));
  const result = decisionService.record({
    decisionId: "decision-approve-1",
    proposalId,
    agentId: CONTENT_AGENT_ID,
    reviewerId: "guido",
    decision: "approved",
  });
  assert.equal(result.status, "created");
  if (result.status === "created") {
    assert.equal(result.record.proposalId, proposalId);
    assert.equal(result.record.agentId, CONTENT_AGENT_ID);
    assert.equal(result.record.reviewerId, "guido");
    assert.equal(result.record.decision, "approved");
    assert.equal(typeof result.record.recordedAt, "string");
    repository.createContentReviewDecision(result.record);
  }

  const afterEntry = repository.getSnapshot().memory.find((entry) => entry.id === proposalId);
  assert.equal(
    JSON.stringify((afterEntry?.content as { structuredResult?: unknown })?.structuredResult),
    originalStructuredResult,
    "the original AI output must remain unchanged after review",
  );

  // Survives a fresh Runtime/repository constructed from the same storage root.
  const reloadedRepository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const reloadedDecision = reloadedRepository.getContentReviewDecisionByProposal(proposalId);
  assert.ok(reloadedDecision, "the approval decision must survive reload from the same storage root");
  assert.equal(reloadedDecision?.decision, "approved");

  const reloadedReadService = new ContentReviewReadService(readStoreFor(reloadedRepository));
  const reloadedProposal = reloadedReadService.getProposal(proposalId);
  assert.equal(reloadedProposal?.status, "approved");
}

// D. Rejection: valid proposed content can be rejected with a reason; rejected state survives reload.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-review-reject-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "review-reject-1");
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const decisionService = new ContentReviewDecisionService(decisionStoreFor(repository));
  const result = decisionService.record({
    decisionId: "decision-reject-1",
    proposalId,
    agentId: CONTENT_AGENT_ID,
    reviewerId: "guido",
    decision: "rejected",
    reason: "Tone does not match brand voice.",
  });
  assert.equal(result.status, "created");
  if (result.status === "created") {
    assert.equal(result.record.reason, "Tone does not match brand voice.");
    repository.createContentReviewDecision(result.record);
  }

  // Reason/comment is bounded.
  const overlongReason = "x".repeat(600);
  const overlong = decisionService.record({
    decisionId: "decision-reject-overlong",
    proposalId: "irrelevant-because-length-checked-first",
    agentId: CONTENT_AGENT_ID,
    reviewerId: "guido",
    decision: "rejected",
    reason: overlongReason,
  });
  assert.equal(overlong.status, "rejected");
  assert.match((overlong as { reason: string }).reason, /500 characters/);

  const reloadedRepository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  const reloadedDecision = reloadedRepository.getContentReviewDecisionByProposal(proposalId);
  assert.equal(reloadedDecision?.decision, "rejected");
  assert.equal(reloadedDecision?.reason, "Tone does not match brand voice.");
}

// E. Invalid operations fail closed with clear reasons.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-review-invalid-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);
  const proposalId = await createProposal(runtime, "review-invalid-1");
  await runtime.executeSpecialist("A-002", { id: "review-invalid-a002", objective: "Evaluate the current opportunity", input: {} });
  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));

  const decisionService = new ContentReviewDecisionService(decisionStoreFor(repository));

  // Unknown proposal.
  const unknown = decisionService.record({ decisionId: "d-unknown", proposalId: "mem-does-not-exist", agentId: CONTENT_AGENT_ID, reviewerId: "guido", decision: "approved" });
  assert.equal(unknown.status, "rejected");
  assert.match((unknown as { reason: string }).reason, /not found/i);

  // Malformed/missing decision value.
  const invalidDecision = decisionService.record({ decisionId: "d-bad-decision", proposalId, agentId: CONTENT_AGENT_ID, reviewerId: "guido", decision: "maybe" as never });
  assert.equal(invalidDecision.status, "rejected");
  assert.match((invalidDecision as { reason: string }).reason, /invalid content review decision/i);

  // Missing required fields.
  const missingReviewer = decisionService.record({ decisionId: "d-missing", proposalId, agentId: CONTENT_AGENT_ID, reviewerId: "", decision: "approved" });
  assert.equal(missingReviewer.status, "rejected");

  // Non-content evidence cannot be approved through the content-review boundary.
  const wrongEntry = decisionService.record({ decisionId: "d-wrong-entry", proposalId: "mem-review-invalid-a002-A-002", agentId: CONTENT_AGENT_ID, reviewerId: "guido", decision: "approved" });
  assert.equal(wrongEntry.status, "rejected");
  assert.match((wrongEntry as { reason: string }).reason, /not found/i);

  // Duplicate/conflicting decision: exactly-once immutable rule.
  const first = decisionService.record({ decisionId: "d-first", proposalId, agentId: CONTENT_AGENT_ID, reviewerId: "guido", decision: "approved" });
  assert.equal(first.status, "created");
  if (first.status === "created") repository.createContentReviewDecision(first.record);

  const duplicateSame = decisionService.record({ decisionId: "d-dup-same", proposalId, agentId: CONTENT_AGENT_ID, reviewerId: "guido", decision: "approved" });
  assert.equal(duplicateSame.status, "rejected", "a repeat of the same decision must still be rejected (exactly-once rule)");
  assert.match((duplicateSame as { reason: string }).reason, /already has a recorded review decision/i);

  const duplicateConflicting = decisionService.record({ decisionId: "d-dup-conflict", proposalId, agentId: CONTENT_AGENT_ID, reviewerId: "someone-else", decision: "rejected" });
  assert.equal(duplicateConflicting.status, "rejected", "a conflicting decision after one is already recorded must be rejected");
}

// G. No publication: this module never contacts Metricool or any external publishing API.
{
  const source = readFileSync(new URL("./content-review-service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /metricool/i, "content review must never call Metricool");
  assert.doesNotMatch(source, /fetch\(|node:http|child_process/, "content review must remain a pure in-process persistence/read boundary");
}

console.log("Content review service tests passed.");
