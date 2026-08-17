import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_METRICOOL_BLOG_ID, readMetricoolConnectionStatus, saveMetricoolConnection, testMetricoolConnection } from "./metricool-connection-service.ts";

assert.deepEqual(readMetricoolConnectionStatus({}), { configured: false, userId: "", blogId: DEFAULT_METRICOOL_BLOG_ID, test: "untested" });
assert.deepEqual(readMetricoolConnectionStatus({ METRICOOL_USER_TOKEN: "secret", METRICOOL_USER_ID: "user-1", METRICOOL_BLOG_ID: "6694539" }), { configured: true, userId: "user-1", blogId: "6694539", test: "untested" });
assert.ok(!JSON.stringify(readMetricoolConnectionStatus({ METRICOOL_USER_TOKEN: "secret", METRICOOL_USER_ID: "user-1", METRICOOL_BLOG_ID: "6694539" })).includes("secret"), "the GET status must never carry the API key");

const root = mkdtempSync(path.join(tmpdir(), "novara-metricool-connection-"));
const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\nMETRICOOL_API_KEY=mcp-connection-key\n", "utf8");
saveMetricoolConnection(envPath, "first-secret", "user-1", "111", {});
saveMetricoolConnection(envPath, "second-secret", "user-2", "6694539", {});
const saved = readFileSync(envPath, "utf8");
assert.match(saved, /^OTHER=value/m);
assert.match(saved, /^METRICOOL_API_KEY=mcp-connection-key$/m, "the Metricool MCP credential must be left untouched");
assert.equal((saved.match(/^METRICOOL_USER_TOKEN=/gm) ?? []).length, 1);
assert.match(saved, /^METRICOOL_USER_ID=user-2$/m);
assert.match(saved, /^METRICOOL_BLOG_ID=6694539$/m);
assert.throws(() => saveMetricoolConnection(envPath, "", "user", "1", {}), /required/);
assert.throws(() => saveMetricoolConnection(envPath, "key", "", "1", {}), /required/);
assert.throws(() => saveMetricoolConnection(envPath, "key", "user", "", {}), /required/);
assert.throws(() => saveMetricoolConnection(envPath, "key", "user", "not-a-number", {}), /numeric/);

const env = { METRICOOL_USER_TOKEN: "secret", METRICOOL_USER_ID: "user-1", METRICOOL_BLOG_ID: "6694539" };

const requests: Array<{ url: string; method: string | undefined; auth: string }> = [];
const passed = await testMetricoolConnection(env, async (input, init) => {
  requests.push({ url: String(input), method: init?.method, auth: (init?.headers as Record<string, string>)["X-Mc-Auth"] });
  return new Response(JSON.stringify({ data: [{ id: 6694539, label: "novarateam" }] }), { status: 200 });
});
assert.deepEqual(passed, { configured: true, userId: "user-1", blogId: "6694539", test: "successful", httpStatus: 200, reason: "API authentication: OK." });
assert.equal(requests.length, 1, "the test must make exactly one request");
assert.equal(requests[0].method, undefined, "the test must be a read-only GET");
assert.equal(requests[0].auth, "secret");
assert.match(requests[0].url, /^https:\/\/app\.metricool\.com\/api\/v2\/settings\/brands\?/);
assert.match(requests[0].url, /userId=user-1/);
assert.match(requests[0].url, /blogId=6694539/);

const rejected = await testMetricoolConnection(env, async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 }));
assert.deepEqual(rejected, { configured: true, userId: "user-1", blogId: "6694539", test: "failed", httpStatus: 401, reason: "Authentication failed: Metricool rejected the API key. (Unauthorized)" });
assert.ok(!JSON.stringify(rejected).includes("secret"));

const forbidden = await testMetricoolConnection(env, async () => new Response("", { status: 403 }));
assert.equal(forbidden.httpStatus, 403);
assert.match(forbidden.reason ?? "", /Advanced or Custom plan/);

const wrongBlog = await testMetricoolConnection(env, async () => new Response(JSON.stringify({ data: [{ id: 42 }] }), { status: 200 }));
assert.equal(wrongBlog.test, "failed");
assert.match(wrongBlog.reason ?? "", /blog ID 6694539 is not available/);

const unreachable = await testMetricoolConnection(env, async () => { throw new Error("network down"); });
assert.deepEqual(unreachable, { configured: true, userId: "user-1", blogId: "6694539", test: "failed", reason: "Metricool could not be reached from this machine." });

assert.deepEqual(await testMetricoolConnection({}, async () => { throw new Error("must not be called"); }), { configured: false, userId: "", blogId: DEFAULT_METRICOOL_BLOG_ID, test: "untested" });

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
assert.match(app, /data-input="metricool-api-key"[^>]*type="password"|type="password"[^>]*data-input="metricool-api-key"/);
assert.doesNotMatch(app, /metricoolDraft:\s*\{[^}]*apiKey/, "the API key must never be held in frontend state");
console.log("Metricool connection tests passed.");
