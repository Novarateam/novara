import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { configureRevenueCatConnection, readRevenueCatConnectionStatus, saveRevenueCatConnection, testRevenueCatConnection } from "./revenuecat-connection-service.ts";

assert.deepEqual(readRevenueCatConnectionStatus({}), { configured: false, projectName: "", projectId: "", test: "untested" });
const status = readRevenueCatConnectionStatus({ REVENUECAT_API_KEY: "sk_v2_fake_token", REVENUECAT_PROJECT_ID: "proj123", REVENUECAT_PROJECT_NAME: "Novara" });
assert.deepEqual(status, { configured: true, projectName: "Novara", projectId: "proj123", test: "untested" });
assert.ok(!JSON.stringify(status).includes("sk_v2_fake_token"), "the GET status must never carry the API key");
assert.deepEqual(readRevenueCatConnectionStatus({ REVENUECAT_API_KEY: "secret", REVENUECAT_PROJECT_ID: "Novara" }), { configured: true, projectName: "Novara", projectId: "", test: "untested" });

const root = mkdtempSync(path.join(tmpdir(), "novara-revenuecat-connection-"));
const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\n", "utf8");
saveRevenueCatConnection(envPath, "first-secret", "proj123", "Novara", {});
saveRevenueCatConnection(envPath, "second-secret", "proj123", "Novara", {});
const saved = readFileSync(envPath, "utf8");
assert.match(saved, /^OTHER=value/m);
assert.equal((saved.match(/^REVENUECAT_API_KEY=/gm) ?? []).length, 1);
assert.match(saved, /^REVENUECAT_PROJECT_ID=proj123$/m);
assert.match(saved, /^REVENUECAT_PROJECT_NAME=Novara$/m);
assert.throws(() => saveRevenueCatConnection(envPath, "   ", "proj123", "Novara", {}), /API key is required/);
assert.throws(() => saveRevenueCatConnection(envPath, "secret", "Novara", "Novara", {}), /must be an ID returned/);

const env = { REVENUECAT_API_KEY: "sk_v2_fake_token", REVENUECAT_PROJECT_ID: "proj123", REVENUECAT_PROJECT_NAME: "Novara" };

const requests: Array<{ url: string; method: string | undefined; authorization: string }> = [];
const passed = await testRevenueCatConnection(env, async (input, init) => {
  requests.push({ url: String(input), method: init?.method, authorization: (init?.headers as Record<string, string>).Authorization });
  return new Response(JSON.stringify({ items: [{ id: "proj123", name: "Novara" }] }), { status: 200 });
});
assert.deepEqual(passed, { configured: true, projectName: "Novara", projectId: "proj123", test: "successful", httpStatus: 200, reason: "API authentication and project access: OK." });
assert.equal(requests.length, 1, "the test must make exactly one request");
assert.equal(requests[0].method, undefined, "the test must be a read-only GET");
assert.equal(requests[0].url, "https://api.revenuecat.com/v2/projects");
assert.equal(requests[0].authorization, "Bearer sk_v2_fake_token", "RevenueCat API v2 requires the Bearer format");

const resolved = await testRevenueCatConnection({ REVENUECAT_API_KEY: "sk_v2_fake_token" }, async () => new Response(JSON.stringify({ items: [{ id: "proj-only", name: "Novara" }] }), { status: 200 }));
assert.equal(resolved.projectId, "proj-only", "a single visible project identifies itself when none is configured");
assert.equal(resolved.projectName, "Novara");
assert.equal(resolved.test, "successful");

const configureEnv: NodeJS.ProcessEnv = { REVENUECAT_API_KEY: "saved-secret", REVENUECAT_PROJECT_ID: "Novara" };
const selection = await configureRevenueCatConnection(envPath, "", undefined, configureEnv, async () => new Response(JSON.stringify({ items: [{ id: "proj-other", name: "Other" }, { id: "proj-novara", name: "Novara" }] }), { status: 200 }));
assert.equal(selection.selectionRequired, true);
assert.deepEqual(selection.projects, [{ id: "proj-other", name: "Other" }, { id: "proj-novara", name: "Novara" }]);
assert.equal(configureEnv.REVENUECAT_PROJECT_ID, "Novara", "discovery alone must not guess or alter configuration");
const configured = await configureRevenueCatConnection(envPath, "", "proj-novara", configureEnv, async () => new Response(JSON.stringify({ items: [{ id: "proj-other", name: "Other" }, { id: "proj-novara", name: "Novara" }] }), { status: 200 }));
assert.deepEqual(configured, { configured: true, projectName: "Novara", projectId: "proj-novara", test: "untested", httpStatus: 200 });
assert.equal(configureEnv.REVENUECAT_PROJECT_ID, "proj-novara");
assert.equal(configureEnv.REVENUECAT_PROJECT_NAME, "Novara");

const unauthorized = await testRevenueCatConnection(env, async () => new Response(JSON.stringify({ message: "Invalid API key sk_v2_fake_token" }), { status: 401 }));
assert.equal(unauthorized.httpStatus, 401);
assert.match(unauthorized.reason ?? "", /requires a V2 secret API key/);
assert.ok(!JSON.stringify(unauthorized).includes("sk_v2_fake_token"), "an echoed key must be redacted out of the reason");

const forbidden = await testRevenueCatConnection(env, async () => new Response("", { status: 403 }));
assert.equal(forbidden.reason, "API key does not have permission for this request.");

const notFound = await testRevenueCatConnection(env, async () => new Response("", { status: 404 }));
assert.equal(notFound.reason, "Project/resource could not be found.");

const rateLimited = await testRevenueCatConnection(env, async () => new Response("", { status: 429 }));
assert.equal(rateLimited.reason, "Rate limit reached. Please retry later.");

const wrongProject = await testRevenueCatConnection(env, async () => new Response(JSON.stringify({ items: [{ id: "proj-other", name: "Other" }] }), { status: 200 }));
assert.equal(wrongProject.test, "failed");
assert.match(wrongProject.reason ?? "", /project Novara is not visible/);

const unreachable = await testRevenueCatConnection(env, async () => { throw new Error("network down"); });
assert.deepEqual(unreachable, { configured: true, projectName: "Novara", projectId: "proj123", test: "failed", reason: "RevenueCat could not be reached from this machine." });

assert.deepEqual(await testRevenueCatConnection({}, async () => { throw new Error("must not be called"); }), { configured: false, projectName: "", projectId: "", test: "untested" });

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
assert.match(app, /data-input="revenuecat-api-key"[^>]*type="password"/);
assert.doesNotMatch(app, /revenueCatDraft:\s*\{[^}]*apiKey/, "the API key must never be held in frontend state");
const service = readFileSync(new URL("./revenuecat-connection-service.ts", import.meta.url), "utf8");
assert.doesNotMatch(service, /console\.(log|error|warn|info)/, "the service must never log");
console.log("RevenueCat connection tests passed.");
