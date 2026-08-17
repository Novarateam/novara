import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readOpenAiConnectionStatus, saveOpenAiKey, testOpenAiConnection } from "./openai-connection-service.ts";

assert.deepEqual(readOpenAiConnectionStatus({}), { configured: false, test: "untested" });
const root = mkdtempSync(path.join(tmpdir(), "novara-openai-connection-")); const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\nOPENAI_API_KEY=old\n", "utf8");
saveOpenAiKey(envPath, "new-secret", {}); saveOpenAiKey(envPath, "newer-secret", {});
const stored = readFileSync(envPath, "utf8");
assert.match(stored, /^OTHER=value/m); assert.equal((stored.match(/^OPENAI_API_KEY=/gm) ?? []).length, 1); assert.match(stored, /^OPENAI_API_KEY=newer-secret$/m);
const environment = { OPENAI_API_KEY: "process-secret" }; saveOpenAiKey(path.join(root, "other.env"), "file-secret", environment); assert.equal(environment.OPENAI_API_KEY, "process-secret");
const failed = await testOpenAiConnection({ OPENAI_API_KEY: "secret" }, async () => new Response("raw upstream response", { status: 401 }));
assert.deepEqual(failed, { configured: true, test: "failed" }); assert.ok(!JSON.stringify(failed).includes("secret"));
console.log("OpenAI connection tests passed.");