import assert from "node:assert/strict";
import { OpenAIVisualGenerationAdapter, mapAspectRatioToOpenAIImageSize, OpenAIImageGenerationAdapter } from "./openai-image-generation-adapter.ts";

assert.equal(mapAspectRatioToOpenAIImageSize("9:16"), "1024x1536");
assert.equal(mapAspectRatioToOpenAIImageSize("1:1"), "1024x1024");
assert.equal(mapAspectRatioToOpenAIImageSize("16:9"), "1536x1024");
assert.equal(mapAspectRatioToOpenAIImageSize("4:5"), undefined);

// Exact official Images API request and scene-derived prompt.
{
  let captured: { method: string; url: string; headers: Record<string, string>; body: string } | undefined;
  const adapter = new OpenAIVisualGenerationAdapter({
    env: { OPENAI_API_KEY: "fake-openai-image-key", OPENAI_IMAGE_MODEL_ID: "gpt-image-2" },
    requester: async (request) => {
      captured = request;
      return { kind: "response", status: 200, body: { data: [{ b64_json: Buffer.from([1, 2, 3]).toString("base64") }] } };
    },
  });
  const result = await adapter.generate({ productionBriefId: "brief", proposalId: "proposal", sceneSequence: 2, sceneDescription: "A close-up of a notebook beside a warm lamp.", aspectRatio: "9:16", visualPlan: [] });
  assert.equal(result.status, "succeeded");
  assert.equal(captured?.method, "POST");
  assert.equal(captured?.url, "https://api.openai.com/v1/images/generations");
  assert.equal(captured?.headers.Authorization, "Bearer fake-openai-image-key");
  assert.deepEqual(JSON.parse(captured?.body ?? "{}"), { model: "gpt-image-2", prompt: "A close-up of a notebook beside a warm lamp.", size: "1024x1536" });
  assert.ok(!JSON.stringify(result).includes("fake-openai-image-key"));
}

// Missing config and unsupported aspect ratio fail before transport.
{
  let calls = 0;
  const adapter = new OpenAIImageGenerationAdapter({ env: {}, requester: async () => { calls += 1; return { kind: "response", status: 200, body: {} }; } });
  assert.equal((await adapter.generateImage("scene", "9:16")).status, "failed");
  const configured = new OpenAIImageGenerationAdapter({ env: { OPENAI_API_KEY: "fake" }, requester: async () => { calls += 1; return { kind: "response", status: 200, body: {} }; } });
  assert.equal((await configured.generateImage("scene", "4:5")).status, "failed");
  assert.equal(calls, 0);
}

console.log("OpenAI image generation adapter tests passed.");
