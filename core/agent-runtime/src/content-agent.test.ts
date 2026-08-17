import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { getAgentDefinitions } from "./agent.ts";
import { FileRuntimeStore, RuntimeRepository } from "./persistence.ts";
import { normalizeProductionBrief } from "./production-brief-service.ts";
import { AgentRuntime } from "./runtime.ts";
import { parseProviderPayload } from "./content-provider.ts";
import type { ContentProviderRequester } from "./content-provider.ts";

const CONTENT_AGENT_ID = "A-014";

function openAiEnvelope(body: Record<string, unknown>): unknown {
  return { choices: [{ message: { content: JSON.stringify(body) } }] };
}

const validProposalBody = {
  summary: "A short explainer about the supplied content.",
  platform: "instagram",
  hook: "You will not believe what happened next.",
  title: "The surprising truth",
  caption: "Here is the caption text for the post.",
  hashtags: ["novara", "contentagent"],
  angle: "curiosity",
  confidence: 0.72,
  reasons: ["The content has a clear narrative arc.", "The topic matches audience interest."],
};

const completeProductionPlan = {
  contentScript: "Open with the customer problem, explain the insight, and close with one useful action.",
  narrationScript: "Here is the problem. Here is the insight. Here is the action.",
  visualPlan: [
    { sequence: 1, description: "Opening branded title", durationSeconds: 4 },
    { sequence: 2, description: "Supporting visual with caption", durationSeconds: 8 },
  ],
  requiredMediaType: "short-form-video",
  aspectRatio: "9:16",
  targetDurationSeconds: 12,
  captionRequirements: { burnedIn: true, language: "en", style: "high-contrast" },
};

// 1. Agent registration
{
  const definitions = getAgentDefinitions();
  const contentDefinition = definitions.find((definition) => definition.id === CONTENT_AGENT_ID);
  assert.ok(contentDefinition, "the Content Agent must be present in getAgentDefinitions()");
  assert.equal(contentDefinition?.executionState, "implemented", "Content Agent must be implemented, not planned");
  assert.equal(contentDefinition?.authorityLevel, "recommend", "Content Agent must be recommendation-only");
  assert.deepEqual(contentDefinition?.capabilities, ["content_analysis"], "Content Agent must declare exactly one narrow capability");
  assert.ok(
    contentDefinition?.approvalRequirements.some((requirement) => requirement.action === "external_action" && requirement.required),
    "Content Agent must require approval for any external action (no publishing authority)",
  );
  assert.ok(
    contentDefinition?.approvalRequirements.some((requirement) => requirement.action === "execution" && requirement.required),
    "Content Agent must require approval before execution can be treated as final",
  );

  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-agent-registration-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of definitions) runtime.registerAgent(definition);
  const registered = runtime.listAgents().find((agent) => agent.id === CONTENT_AGENT_ID);
  assert.equal(registered?.authorityLevel, "recommend");
  assert.equal(registered?.executionState, "implemented");
}

// 2. Input validation: missing/invalid content fails clearly, closed (no provider call attempted).
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-agent-input-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

  const requesterThatMustNotBeCalled: ContentProviderRequester = async () => {
    throw new Error("The provider must never be called when input validation fails.");
  };

  const missing = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-missing", objective: "Propose a post", input: {} },
    { contentProvider: { requester: requesterThatMustNotBeCalled } },
  );
  assert.equal(missing.result.status, "failed");
  assert.match(missing.result.error ?? "", /non-empty string input\.content/i);

  const invalid = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-invalid", objective: "Propose a post", input: { content: 12345 } },
    { contentProvider: { requester: requesterThatMustNotBeCalled } },
  );
  assert.equal(invalid.result.status, "failed");
  assert.match(invalid.result.error ?? "", /non-empty string input\.content/i);
}

// 3. Provider boundary
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-agent-provider-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

  // Missing API key fails closed.
  const missingKey = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-no-key", objective: "Propose a post", input: { content: "Some real content to analyse." } },
    { contentProvider: { env: {} } },
  );
  assert.equal(missingKey.result.status, "failed");
  assert.match(missingKey.result.error ?? "", /OPENAI_API_KEY is missing/);

  // Provider failure fails clearly.
  const providerFailure: ContentProviderRequester = async () => {
    throw new Error("simulated provider outage");
  };
  const failed = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-provider-failure", objective: "Propose a post", input: { content: "Some real content to analyse." } },
    { contentProvider: { env: { OPENAI_API_KEY: "test-key-not-a-real-secret" }, requester: providerFailure } },
  );
  assert.equal(failed.result.status, "failed");
  assert.match(failed.result.error ?? "", /simulated provider outage/);

  // Malformed provider response is rejected, not silently accepted.
  const malformedRequester: ContentProviderRequester = async () => ({ unexpected: "shape" });
  const malformed = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-malformed", objective: "Propose a post", input: { content: "Some real content to analyse." } },
    { contentProvider: { env: { OPENAI_API_KEY: "test-key-not-a-real-secret" }, requester: malformedRequester } },
  );
  assert.equal(malformed.result.status, "failed");
  assert.match(malformed.result.error ?? "", /malformed|did not contain a message body/i);

  assert.throws(() => parseProviderPayload({ choices: [] }), /malformed|message body/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, confidence: 5 })), /confidence/i);
  assert.deepEqual(
    parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: completeProductionPlan })).productionPlan,
    completeProductionPlan,
    "a complete production plan must be preserved unchanged",
  );
  assert.deepEqual(
    parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { visualPlan: [{ description: "First scene" }, { description: "Second scene" }] } })).productionPlan?.visualPlan,
    [{ sequence: 1, description: "First scene" }, { sequence: 2, description: "Second scene" }],
    "missing visual sequence values must normalize to their one-based array order",
  );
  assert.deepEqual(
    parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { visualPlan: [{ sequence: 8, description: "Explicit scene" }] } })).productionPlan?.visualPlan,
    [{ sequence: 8, description: "Explicit scene" }],
    "valid explicit visual sequences must be preserved",
  );
  assert.deepEqual(
    parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { contentScript: "A truthful partial script." } })).productionPlan,
    { contentScript: "A truthful partial script." },
    "an incomplete production plan remains reviewable rather than being invented or marked ready",
  );
  const incompleteProposal = parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { contentScript: "A truthful partial script." } }));
  const incompleteBrief = normalizeProductionBrief({
    id: "mem-incomplete-plan-A-014",
    type: "evidence",
    source: "A-014/incomplete-plan",
    timestamp: "2026-08-14T00:00:00.000Z",
    confidence: incompleteProposal.confidence,
    authority: "recommend",
    status: "proposed",
    content: { structuredResult: incompleteProposal },
  });
  assert.equal(incompleteBrief?.productionReadiness, "not-ready", "a partial provider plan must not pass the existing Production Brief readiness gate");
  assert.ok(incompleteBrief?.missingRequirements.includes("narrationScript"));
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { contentScript: "" } })), /productionPlan\.contentScript/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { narrationScript: "" } })), /productionPlan\.narrationScript/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { visualPlan: [{ sequence: 0, description: "Scene" }] } })), /visualPlan\[0\]\.sequence/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { visualPlan: [{ sequence: 1, description: "", durationSeconds: 1 }] } })), /visualPlan\[0\]\.description/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { visualPlan: [{ sequence: 1, description: "Scene", durationSeconds: 0 }] } })), /visualPlan\[0\]\.durationSeconds/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { requiredMediaType: "image" } })), /requiredMediaType/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { aspectRatio: "" } })), /aspectRatio/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { targetDurationSeconds: 0 } })), /targetDurationSeconds/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { captionRequirements: { burnedIn: "yes" } } })), /captionRequirements\.burnedIn/i);
  assert.throws(() => parseProviderPayload(openAiEnvelope({ ...validProposalBody, productionPlan: { captionRequirements: { burnedIn: true, language: "" } } })), /captionRequirements\.language/i);

  // Raw API key must never leak into errors, audit, or persisted state — even on success.
  const secretKey = "sk-test-should-never-leak-1234567890";
  const successfulRequester: ContentProviderRequester = async () => openAiEnvelope(validProposalBody);
  const success = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-key-leak-check", objective: "Propose a post", input: { content: "Some real content to analyse." } },
    { contentProvider: { env: { OPENAI_API_KEY: secretKey }, requester: successfulRequester } },
  );
  assert.equal(success.result.status, "completed");
  assert.ok(!JSON.stringify(success).includes(secretKey), "the API key must not appear in the runtime response");

  const auditText = readFileSync(path.join(storageRoot, "audit.log"), "utf8");
  assert.ok(!auditText.includes(secretKey), "the API key must not appear in the audit log");
  const stateText = readFileSync(path.join(storageRoot, "state.json"), "utf8");
  assert.ok(!stateText.includes(secretKey), "the API key must not appear in persisted state/evidence");

  // Static check: the adapter source never interpolates apiKey into a thrown error message.
  const adapterSource = readFileSync(new URL("./content-provider.ts", import.meta.url), "utf8");
  const errorLines = adapterSource.split(/\r?\n/).filter((line) => line.includes("throw new Error("));
  assert.ok(errorLines.every((line) => !line.includes("apiKey")), "no thrown error may interpolate the raw API key");
}

// 4. Real execution integration through the authorized Runtime/executeSpecialist path.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-agent-integration-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

  const requester: ContentProviderRequester = async () =>
    openAiEnvelope({ ...validProposalBody, productionPlan: completeProductionPlan, published: true, postId: "should-be-dropped" });

  const response = await runtime.executeSpecialist(
    CONTENT_AGENT_ID,
    { id: "content-integration", objective: "Propose an Instagram post about the supplied article.", input: { content: "A real supplied article about a product launch." } },
    { contentProvider: { env: { OPENAI_API_KEY: "test-key-not-a-real-secret" }, requester } },
  );

  assert.equal(response.result.status, "completed");
  const output = response.result.output as { structuredResult?: Record<string, unknown> };
  const structuredResult = output.structuredResult;
  assert.ok(structuredResult, "a structured result must be present");
  assert.equal(structuredResult?.humanReviewRequired, true, "humanReviewRequired must always be true");
  assert.equal(typeof structuredResult?.confidence, "number");
  assert.ok((structuredResult?.confidence as number) >= 0 && (structuredResult?.confidence as number) <= 1);
  assert.equal(structuredResult?.published, undefined, "no publishing confirmation may appear in the structured result");
  assert.equal(structuredResult?.postId, undefined, "no external post id may appear in the structured result");
  assert.deepEqual(
    Object.keys(structuredResult ?? {}).sort(),
    ["angle", "caption", "confidence", "hashtags", "hook", "humanReviewRequired", "platform", "productionPlan", "reasons", "summary", "title"],
    "the structured result must contain the editorial proposal and its validated production plan",
  );

  const briefBeforeReload = runtime.getCompanyBrief();
  const persisted = briefBeforeReload.memory.find((entry) => entry.id === `mem-content-integration-${CONTENT_AGENT_ID}`);
  assert.ok(persisted, "the proposal must be persisted as a company memory evidence entry");
  assert.equal(persisted?.status, "proposed", "the persisted evidence must have status \"proposed\"");
  assert.equal(persisted?.type, "evidence");
  assert.deepEqual((persisted?.content as { structuredResult?: { productionPlan?: unknown } })?.structuredResult?.productionPlan, completeProductionPlan, "the validated production plan must be persisted unchanged with the proposal");

  const normalized = normalizeProductionBrief(persisted!, "2026-08-14T00:00:00.000Z");
  assert.equal(normalized?.productionReadiness, "ready", "the existing normalizer must accept a complete provider plan without inventing fields");
  assert.deepEqual(normalized?.visualPlan, completeProductionPlan.visualPlan);

  const repository = new RuntimeRepository(new FileRuntimeStore(storageRoot));
  assert.equal(repository.listProductionBriefs().length, 0, "proposal generation must not automatically create a Production Brief");
  assert.equal(repository.listContentReviewDecisions().length, 0, "proposal generation must not automatically approve Content Review");
  assert.equal(repository.listProductionApprovals().length, 0, "proposal generation must not automatically approve production");
  assert.equal(repository.listGenerationOperations().length, 0, "proposal generation must not trigger production execution");

  // Must survive constructing a fresh Runtime from the same storage root (reload behavior).
  const reloaded = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) reloaded.registerAgent(definition);
  const persistedAfterReload = reloaded
    .getCompanyBrief()
    .memory.find((entry) => entry.id === `mem-content-integration-${CONTENT_AGENT_ID}`);
  assert.ok(persistedAfterReload, "the persisted proposal must survive a fresh Runtime reload from the same storage root");
  assert.equal(persistedAfterReload?.status, "proposed");
}

// 5. Existing safety boundaries remain intact.
{
  const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-content-agent-compat-"));
  const runtime = new AgentRuntime({ storageRoot });
  for (const definition of getAgentDefinitions()) runtime.registerAgent(definition);

  // A-002 must remain fully compatible with the now-async executeSpecialist signature.
  const opportunity = await runtime.executeSpecialist("A-002", {
    id: "compat-a002",
    objective: "Evaluate the current opportunity",
    input: {},
  });
  assert.equal(opportunity.result.status, "completed");
  const opportunityOutput = opportunity.result.output as { structuredResult?: { title?: string } };
  assert.equal(opportunityOutput.structuredResult?.title, "Novara Socials growth sprint");

  // executeSpecialist must still reject any agent id outside the explicit allowlist.
  await assert.rejects(() => runtime.executeSpecialist("A-012", { id: "compat-a012", objective: "x" }), /Only A-002 and the Content Agent/);

  // The Content Agent must never be granted publish/external-action capability.
  const definition = runtime.listAgents().find((agent) => agent.id === CONTENT_AGENT_ID);
  assert.ok(!definition?.capabilities.some((capability) => /publish|external/i.test(capability)));
}

console.log("Content Agent tests passed.");
