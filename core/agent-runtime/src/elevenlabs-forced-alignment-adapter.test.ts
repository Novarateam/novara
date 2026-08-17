import assert from "node:assert/strict";
import { ElevenLabsForcedAlignmentAdapter, elevenLabsForcedAlignmentContract } from "./elevenlabs-forced-alignment-adapter.ts";

let captured: { url: string; headers: Record<string, string>; body: FormData } | undefined;
const adapter = new ElevenLabsForcedAlignmentAdapter({
  env: { ELEVENLABS_API_KEY: "test-key" },
  requester: async (request) => {
    captured = request;
    return {
      kind: "response",
      status: 200,
      bytes: new TextEncoder().encode(JSON.stringify({
        characters: [{ text: "H", start: 0, end: 0.2 }],
        words: [{ text: "Hi", start: 0, end: 0.4, loss: 0.01 }],
        loss: 0.01,
      })),
    };
  },
});

const result = await adapter.align(new Uint8Array([1, 2, 3]), "narration.mp3", "Hi");
assert.equal(result.status, "succeeded");
assert.equal(captured?.url, "https://api.elevenlabs.io/v1/forced-alignment");
assert.equal(captured?.headers["xi-api-key"], "test-key");
assert.deepEqual(await captured?.body.get("text"), "Hi");
assert.equal(captured?.body.get("file") instanceof File, true);
assert.deepEqual(elevenLabsForcedAlignmentContract.multipartFields, ["file", "text"]);

const malformed = new ElevenLabsForcedAlignmentAdapter({
  env: { ELEVENLABS_API_KEY: "test-key" },
  requester: async () => ({ kind: "response", status: 200, bytes: new TextEncoder().encode("{}") }),
});
assert.equal((await malformed.align(new Uint8Array([1]), "a.mp3", "a")).status, "unknown-result");

console.log("ElevenLabs forced alignment adapter tests passed.");