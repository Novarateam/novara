import assert from "node:assert/strict";
import { ElevenLabsNarrationAdapter } from "./elevenlabs-narration-adapter.ts";

// Exact verified request contract: URL, POST, xi-api-key, text, model_id, and documented output format.
{
  let request: { method: string; url: string; headers: Record<string, string>; body: string } | undefined;
  const adapter = new ElevenLabsNarrationAdapter({
    env: { ELEVENLABS_API_KEY: "fake-key", ELEVENLABS_VOICE_ID: "voice-123", ELEVENLABS_MODEL_ID: "eleven_multilingual_v2" },
    requester: async (candidate) => {
      request = candidate;
      return { kind: "response", status: 200, headers: { "content-type": "audio/mpeg" }, bytes: new Uint8Array([1, 2, 3]) };
    },
  });
  const result = await adapter.generate("Narration text from the Production Brief.");
  assert.equal(result.status, "succeeded");
  assert.equal(request?.method, "POST");
  assert.equal(request?.url, "https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=mp3_44100_128");
  assert.equal(request?.headers["xi-api-key"], "fake-key");
  assert.equal(request?.headers.Accept, "audio/mpeg");
  assert.deepEqual(JSON.parse(request?.body ?? "{}"), { text: "Narration text from the Production Brief.", model_id: "eleven_multilingual_v2" });
  assert.ok(!JSON.stringify(result).includes("fake-key"));
}

// Missing configuration never calls the injected transport.
{
  let calls = 0;
  const adapter = new ElevenLabsNarrationAdapter({ env: {}, requester: async () => { calls += 1; return { kind: "response", status: 200, headers: {}, bytes: new Uint8Array([1]) }; } });
  const result = await adapter.generate("text");
  assert.equal(result.status, "failed");
  assert.equal(calls, 0);
}

// Definitive HTTP failure is failed; transport and empty-body ambiguity are unknown-result.
{
  const rejected = new ElevenLabsNarrationAdapter({ env: { ELEVENLABS_API_KEY: "fake", ELEVENLABS_VOICE_ID: "voice" }, requester: async () => ({ kind: "response", status: 401, headers: {}, bytes: new Uint8Array() }) });
  assert.equal((await rejected.generate("text")).status, "failed");

  const transport = new ElevenLabsNarrationAdapter({ env: { ELEVENLABS_API_KEY: "fake", ELEVENLABS_VOICE_ID: "voice" }, requester: async () => ({ kind: "transport-error", code: "timeout", reason: "unknown" }) });
  assert.equal((await transport.generate("text")).status, "unknown-result");

  const empty = new ElevenLabsNarrationAdapter({ env: { ELEVENLABS_API_KEY: "fake", ELEVENLABS_VOICE_ID: "voice" }, requester: async () => ({ kind: "response", status: 200, headers: { "content-type": "audio/mpeg" }, bytes: new Uint8Array() }) });
  assert.equal((await empty.generate("text")).status, "unknown-result");
}

console.log("ElevenLabs narration adapter tests passed.");
