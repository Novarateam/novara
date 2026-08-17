import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readElevenLabsConnectionStatus, saveElevenLabsConnection, testElevenLabsConnection } from "./elevenlabs-connection-service.ts";

assert.deepEqual(readElevenLabsConnectionStatus({}), { configured: false, test: "untested" });
const root = mkdtempSync(path.join(tmpdir(), "novara-elevenlabs-connection-")); const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\nELEVENLABS_API_KEY=old\nELEVENLABS_VOICE_ID=old-voice\n", "utf8");
saveElevenLabsConnection(envPath, "first-secret", "voice-one", "", {});
saveElevenLabsConnection(envPath, "second-secret", "voice-two", "   ", {});
const savedWithoutModel = readFileSync(envPath, "utf8");
assert.match(savedWithoutModel, /^OTHER=value/m); assert.equal((savedWithoutModel.match(/^ELEVENLABS_API_KEY=/gm) ?? []).length, 1); assert.equal((savedWithoutModel.match(/^ELEVENLABS_VOICE_ID=/gm) ?? []).length, 1); assert.match(savedWithoutModel, /^ELEVENLABS_VOICE_ID=voice-two$/m); assert.doesNotMatch(savedWithoutModel, /^ELEVENLABS_MODEL_ID=/m);
assert.deepEqual(readElevenLabsConnectionStatus({ ELEVENLABS_API_KEY: "second-secret", ELEVENLABS_VOICE_ID: "voice-two" }), { configured: true, test: "untested" });
assert.ok(!JSON.stringify(readElevenLabsConnectionStatus({ ELEVENLABS_API_KEY: "second-secret", ELEVENLABS_VOICE_ID: "voice-two" })).includes("second-secret"));
assert.throws(() => saveElevenLabsConnection(envPath, "", "voice", undefined, {}), /API key and voice ID are required/);
assert.throws(() => saveElevenLabsConnection(envPath, "key", "", undefined, {}), /API key and voice ID are required/);
saveElevenLabsConnection(envPath, "third-secret", "voice-three", "model-three", {});
assert.match(readFileSync(envPath, "utf8"), /^ELEVENLABS_MODEL_ID=model-three$/m);
const processEnv = { ELEVENLABS_API_KEY: "process-secret", ELEVENLABS_VOICE_ID: "process-voice" }; saveElevenLabsConnection(path.join(root, "other.env"), "file-secret", "file-voice", undefined, processEnv); assert.equal(processEnv.ELEVENLABS_API_KEY, "process-secret");
const failed = await testElevenLabsConnection({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: "voice" }, async () => new Response(JSON.stringify({ detail: { message: "Invalid API key" } }), { status: 401 }));
assert.deepEqual(failed, { configured: true, test: "failed", httpStatus: 401, reason: "Authentication failed: ElevenLabs rejected the API key. (Invalid API key)" });
assert.ok(!JSON.stringify(failed).includes("secret"));

const requestLog: Array<{ url: string; apiKeyHeader: string }> = [];
const passed = await testElevenLabsConnection({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: "voice" }, async (input, init) => {
  requestLog.push({ url: String(input), apiKeyHeader: (init?.headers as Record<string, string>)["xi-api-key"] });
  return new Response("{}", { status: 200 });
});
assert.deepEqual(passed, { configured: true, test: "successful", httpStatus: 200, reason: "Authentication succeeded and the configured voice is available." });
assert.deepEqual(requestLog.map((entry) => entry.url), ["https://api.elevenlabs.io/v1/user/subscription", "https://api.elevenlabs.io/v1/voices/voice"]);
assert.ok(requestLog.every((entry) => entry.apiKeyHeader === "secret"), "every request must authenticate with the xi-api-key header");

const missingVoice = await testElevenLabsConnection({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: "voice" }, async (input) =>
  String(input).includes("/voices/") ? new Response(JSON.stringify({ detail: { status: "voice_not_found" } }), { status: 404 }) : new Response("{}", { status: 200 }));
assert.equal(missingVoice.test, "failed");
assert.equal(missingVoice.httpStatus, 404);
assert.match(missingVoice.reason ?? "", /Voice ID does not exist/);
assert.ok(!JSON.stringify(missingVoice).includes("secret"));

const unreachable = await testElevenLabsConnection({ ELEVENLABS_API_KEY: "secret", ELEVENLABS_VOICE_ID: "voice" }, async () => { throw new Error("network down"); });
assert.deepEqual(unreachable, { configured: true, test: "failed", reason: "ElevenLabs could not be reached from this machine." });
console.log("ElevenLabs connection tests passed.");
