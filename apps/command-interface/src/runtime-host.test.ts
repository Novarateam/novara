import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createCommandInterfaceServer } from "./server.ts";
import { createRuntimeHost } from "./runtime-host.ts";

function readPersistence(storageRoot: string) {
  const statePath = path.join(storageRoot, "state.json");
  const auditPath = path.join(storageRoot, "audit.log");
  return {
    state: existsSync(statePath) ? readFileSync(statePath, "utf8") : "",
    audit: existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "",
  };
}

async function request(port: number, pathname: string) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

const storageRoot = mkdtempSync(path.join(tmpdir(), "novara-runtime-host-"));
const host = createRuntimeHost(storageRoot);
const runtime = host.getRuntime();

assert.equal(runtime, host.getRuntime(), "a host must return the same runtime instance for its lifetime");
runtime.storeMemory({
  entry: {
    id: "runtime-host-persistence-evidence",
    type: "evidence",
    content: { source: "focused runtime host test" },
    source: "runtime-host.test",
    timestamp: new Date().toISOString(),
    confidence: 0.5,
    authority: "recommend",
    status: "proposed",
  },
});

const beforeReads = readPersistence(storageRoot);
const server = createCommandInterfaceServer(host);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address() as { port: number };

try {
  const firstSnapshot = await request(address.port, "/api/command-interface");
  const secondSnapshot = await request(address.port, "/api/command-interface");
  const health = await request(address.port, "/api/runtime/health");
  const trustReview = await request(address.port, "/api/trust-review?operation=listTrustReports");
  const hermes = await request(address.port, "/api/hermes/ask?q=What%20changed%3F");

  assert.equal(firstSnapshot.status, 200);
  assert.equal(secondSnapshot.status, 200);
  assert.equal(firstSnapshot.body.agentCount, secondSnapshot.body.agentCount, "snapshot reads must share the host runtime context");
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(health.body).sort(), ["error", "initialized", "persistedSnapshotUpdatedAt", "persistenceAvailable", "startedAt", "startupId"]);
  assert.equal(health.body.initialized, true);
  assert.equal(health.body.persistenceAvailable, true);
  assert.equal(typeof health.body.startupId, "string");
  assert.equal(typeof health.body.startedAt, "string");
  assert.equal(typeof health.body.persistedSnapshotUpdatedAt, "string");
  assert.equal(health.body.error, null);
  assert.equal(trustReview.status, 200, "existing trust review command must remain compatible");
  assert.equal(hermes.status, 200, "non-work Hermes questions must remain available");
  assert.equal("routing" in hermes.body, false, "briefing Hermes questions must not invoke routing or execution");

  assert.deepEqual(readPersistence(storageRoot), beforeReads, "ordinary interface, health, trust-review, and briefing reads must not mutate persistence or audit state");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

const restartedHost = createRuntimeHost(storageRoot);
assert.notEqual(restartedHost.getRuntime(), runtime, "a restarted host must construct a fresh runtime from persisted state");
assert.ok(
  restartedHost.getRuntime().getCompanyBrief().memory.some((entry) => entry.id === "runtime-host-persistence-evidence"),
  "a restarted host must load existing persisted state through the normal runtime path",
);

const invalidStorageRoot = path.join(storageRoot, "not-a-directory");
writeFileSync(invalidStorageRoot, "not a directory", "utf8");
const failedHost = createRuntimeHost(invalidStorageRoot);
assert.equal(failedHost.getHealth().initialized, false, "persistence startup failure must be explicit");
assert.equal(failedHost.getHealth().persistenceAvailable, false);
assert.throws(() => failedHost.getRuntime(), /Runtime host is unavailable/, "failed startup must not construct a temporary fallback runtime");

console.log("Runtime host tests passed.");
