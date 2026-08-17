import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  checkHealth,
  opsDirFor,
  pidFilePathFor,
  serverEntryPath,
  startNovara,
  statusNovara,
  stopNovara,
} from "./novara-ctl.ts";

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

function isolatedCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "novara-ctl-"));
}

// 1. Starting behavior uses the existing command-server entry point.
assert.ok(existsSync(serverEntryPath), "the ops helper must target the real command-server entry point");
assert.ok(serverEntryPath.replace(/\\/g, "/").endsWith("apps/command-interface/src/server.ts"));

// 2. A healthy already-running Novara instance is detected and no duplicate instance is started.
{
  const port = randomPort();
  const cwd = isolatedCwd();
  try {
    const first = await startNovara({ port, cwd, readyTimeoutMs: 20000 });
    assert.equal(first.outcome, "started");
    assert.ok("pid" in first && typeof first.pid === "number");
    const firstPid = (first as { pid: number }).pid;

    const status = await statusNovara({ port });
    assert.equal(status.outcome, "running-healthy");

    const second = await startNovara({ port, cwd, readyTimeoutMs: 20000 });
    assert.equal(second.outcome, "already-running", "a second start must detect the healthy instance and refuse to duplicate it");

    const stop = await stopNovara({ port, cwd });
    assert.equal(stop.outcome, "stopped");
    assert.equal((stop as { pid: number }).pid, firstPid);

    // Allow the OS a brief moment to fully release the socket after termination.
    let finalHealth = await checkHealth(port);
    for (let attempt = 0; attempt < 10 && finalHealth.state !== "unreachable"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      finalHealth = await checkHealth(port);
    }
    assert.equal(finalHealth.state, "unreachable", "process must be gone after stop");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// 3. An occupied port belonging to an unhealthy/non-Novara process fails clearly without killing that process.
{
  const port = randomPort();
  const cwd = isolatedCwd();
  const dummy = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    await new Promise<void>((resolve) => dummy.listen(port, "127.0.0.1", resolve));

    const result = await startNovara({ port, cwd, readyTimeoutMs: 3000 });
    assert.equal(result.outcome, "refused-non-novara");

    // The unrelated process must still be alive and untouched.
    const dummyHealth = await checkHealth(port);
    assert.equal(dummyHealth.state, "occupied-non-novara");
  } finally {
    await new Promise<void>((resolve) => dummy.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Orphan-PID / PID-reuse safety: a stale PID file whose PID happens to still be alive
// (recycled by an unrelated process) must never be killed. stopNovara must confirm the
// port is actually serving Novara before touching the recorded PID.
{
  const port = randomPort();
  const cwd = isolatedCwd();
  mkdirSync(opsDirFor(cwd), { recursive: true });
  // Use this test process's own PID: guaranteed alive, but not actually Novara,
  // and nothing is listening on `port`. If stopNovara ever called process.kill on
  // this PID, the test runner itself would be terminated and this script would
  // never reach the assertions below.
  writeFileSync(pidFilePathFor(cwd), JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));

  const result = await stopNovara({ port, cwd });
  assert.equal(result.outcome, "stale-pid-cleared", "an alive-but-unrelated recycled PID must be treated as stale, not killed");
  assert.equal(existsSync(pidFilePathFor(cwd)), false, "the stale PID file must be cleared");
  assert.equal(isNaN(process.pid) , false, "sanity: this test process is still alive and was never killed");

  rmSync(cwd, { recursive: true, force: true });
}

// Orphan-PID safety, second case: PID is alive and the port IS occupied, but by a
// process that does not answer the Novara health shape. stopNovara must refuse to
// kill it rather than assume it is Novara.
{
  const port = randomPort();
  const cwd = isolatedCwd();
  mkdirSync(opsDirFor(cwd), { recursive: true });
  writeFileSync(pidFilePathFor(cwd), JSON.stringify({ pid: process.pid, port, startedAt: new Date().toISOString() }));
  const dummy = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    await new Promise<void>((resolve) => dummy.listen(port, "127.0.0.1", resolve));
    const result = await stopNovara({ port, cwd });
    assert.equal(result.outcome, "not-managed-by-this-tool", "a non-Novara process on the recorded port must never be killed");
    assert.equal(existsSync(pidFilePathFor(cwd)), true, "the PID file must be left in place when the tool refuses to act");
  } finally {
    await new Promise<void>((resolve) => dummy.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  }
}

// 4. Readiness checks use GET /api/runtime/health.
{
  const port = randomPort();
  const dummy = createServer((req, res) => {
    if (req.url === "/api/runtime/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ initialized: true, persistenceAvailable: true, startupId: "x", startedAt: "x", persistedSnapshotUpdatedAt: null, error: null }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await new Promise<void>((resolve) => dummy.listen(port, "127.0.0.1", resolve));
    const health = await checkHealth(port);
    assert.equal(health.state, "healthy");
  } finally {
    await new Promise<void>((resolve) => dummy.close(() => resolve()));
  }
}

// 5. The operational layer does not directly mutate Runtime or persistence.
{
  const source = readFileSync(new URL("./novara-ctl.ts", import.meta.url), "utf8");
  assert.ok(!/agent-runtime\/src\/(runtime|persistence|brain)/.test(source), "ops helper must not import Runtime, persistence, or brain modules");
  assert.ok(!/state\.json/.test(source), "ops helper must not reference the persistence state file");
}

console.log("novara-ctl tests passed.");
