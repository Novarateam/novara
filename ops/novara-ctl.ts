// Local process-management helper for the Novara command interface.
//
// This module treats Novara as an external process/application boundary:
// it never constructs AgentRuntime/Brain, never touches persistence files,
// and never calls any internal Runtime mutation API. It only starts/stops
// the existing command-server entry point (apps/command-interface/src/server.ts)
// as an OS process and checks readiness through the existing
// GET /api/runtime/health endpoint.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(moduleDir, "..");
export const serverEntryPath = path.resolve(repoRoot, "apps/command-interface/src/server.ts");

export function opsDirFor(cwd: string): string {
  return path.resolve(cwd, ".novara/ops");
}
export function pidFilePathFor(cwd: string): string {
  return path.join(opsDirFor(cwd), "novara.pid");
}
export function logFilePathFor(cwd: string): string {
  return path.join(opsDirFor(cwd), "novara.log");
}

export type PidRecord = {
  pid: number;
  port: number;
  startedAt: string;
};

export type HealthCheckResult =
  | { state: "healthy"; body: Record<string, unknown> }
  | { state: "unhealthy-novara"; body: Record<string, unknown> }
  | { state: "occupied-non-novara"; detail: string }
  | { state: "unreachable" };

export function resolvePort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.NOVARA_UI_PORT ?? 4173);
}

/**
 * Calls the existing GET /api/runtime/health endpoint and classifies the result.
 * This is the authoritative application-level readiness/duplicate check.
 */
export async function checkHealth(port: number, timeoutMs = 2000, hostname = "127.0.0.1"): Promise<HealthCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${hostname}:${port}/api/runtime/health`, { signal: controller.signal });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { state: "occupied-non-novara", detail: "response was not valid JSON" };
    }

    if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).initialized !== "boolean") {
      return { state: "occupied-non-novara", detail: "response did not match the Novara runtime health shape" };
    }

    const record = body as Record<string, unknown>;
    return record.initialized ? { state: "healthy", body: record } : { state: "unhealthy-novara", body: record };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.cause
      ? ((error as NodeJS.ErrnoException).cause as NodeJS.ErrnoException)?.code
      : (error as NodeJS.ErrnoException)?.code;
    if (code === "ECONNREFUSED") {
      return { state: "unreachable" };
    }
    // Timeouts, resets, etc: something is on the port but it did not answer
    // the health check cleanly. Treat as occupied-unknown rather than free.
    return { state: "occupied-non-novara", detail: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

function ensureOpsDir(cwd: string): void {
  mkdirSync(opsDirFor(cwd), { recursive: true });
}

function readPidRecord(cwd: string): PidRecord | null {
  const pidFilePath = pidFilePathFor(cwd);
  if (!existsSync(pidFilePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(pidFilePath, "utf8")) as PidRecord;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type StartOptions = {
  port?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  readyTimeoutMs?: number;
};

export type StartResult =
  | { outcome: "already-running"; port: number }
  | { outcome: "refused-non-novara"; port: number; detail: string }
  | { outcome: "refused-unhealthy-existing"; port: number }
  | { outcome: "started"; port: number; pid: number }
  | { outcome: "failed-to-become-ready"; port: number; pid: number };

/** Starts the existing command-server entry point unless a healthy instance already owns the port. */
export async function startNovara(options: StartOptions = {}): Promise<StartResult> {
  const port = options.port ?? resolvePort(options.env ?? process.env);
  const cwd = options.cwd ?? repoRoot;
  const readyTimeoutMs = options.readyTimeoutMs ?? 15000;

  const preflight = await checkHealth(port);
  if (preflight.state === "healthy") {
    console.log(`Novara is already running and healthy on http://localhost:${port}.`);
    return { outcome: "already-running", port };
  }
  if (preflight.state === "occupied-non-novara") {
    console.error(
      `Port ${port} is occupied by a process that is not a healthy Novara instance (${preflight.detail}). Refusing to start a duplicate or guess another port.`,
    );
    return { outcome: "refused-non-novara", port, detail: preflight.detail };
  }
  if (preflight.state === "unhealthy-novara") {
    console.error(
      `A Novara instance is already bound to port ${port} but is reporting an unhealthy status. Not starting a duplicate instance.`,
    );
    return { outcome: "refused-unhealthy-existing", port };
  }

  ensureOpsDir(cwd);
  console.log(`Starting Novara command interface on http://localhost:${port} ...`);
  const logFd = openSync(logFilePathFor(cwd), "a");
  const child = spawn(process.execPath, ["--experimental-strip-types", serverEntryPath], {
    cwd,
    env: { ...process.env, ...options.env, NOVARA_UI_PORT: String(port) },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();

  const pid = child.pid as number;
  writeFileSync(
    pidFilePathFor(cwd),
    JSON.stringify({ pid, port, startedAt: new Date().toISOString() } satisfies PidRecord, null, 2),
  );

  const deadline = Date.now() + readyTimeoutMs;
  while (Date.now() < deadline) {
    const health = await checkHealth(port);
    if (health.state === "healthy") {
      console.log(`Novara is ready on http://localhost:${port}.`);
      return { outcome: "started", port, pid };
    }
    await wait(300);
  }

  console.error(`Novara did not report healthy on http://localhost:${port} within ${readyTimeoutMs}ms (unhealthy/unavailable).`);
  return { outcome: "failed-to-become-ready", port, pid };
}

export type StopOptions = {
  port?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stopTimeoutMs?: number;
};

export type StopResult =
  | { outcome: "not-running" }
  | { outcome: "not-managed-by-this-tool"; port: number }
  | { outcome: "stale-pid-cleared" }
  | { outcome: "stopped"; pid: number }
  | { outcome: "stop-timed-out"; pid: number };

/** Stops the Novara process this tool started, using normal process termination. */
export async function stopNovara(options: StopOptions = {}): Promise<StopResult> {
  const port = options.port ?? resolvePort(options.env ?? process.env);
  const cwd = options.cwd ?? repoRoot;
  const stopTimeoutMs = options.stopTimeoutMs ?? 8000;
  const record = readPidRecord(cwd);

  if (!record) {
    const health = await checkHealth(port);
    if (health.state === "healthy" || health.state === "unhealthy-novara") {
      console.error(`Novara appears to be running on port ${port} but there is no PID file recorded by this tool. Not stopping it automatically.`);
      return { outcome: "not-managed-by-this-tool", port };
    }
    console.log("Novara is not running.");
    return { outcome: "not-running" };
  }

  if (!isProcessAlive(record.pid)) {
    rmSync(pidFilePathFor(cwd), { force: true });
    console.log("Novara was not running (stale PID file cleared).");
    return { outcome: "stale-pid-cleared" };
  }

  // The OS can recycle a PID after the original process exits (e.g. a crash that
  // skipped cleanup). Confirm the port is still actually serving a Novara-shaped
  // health response before killing the recorded PID, so a reused PID belonging to
  // an unrelated process is never terminated.
  const preKillHealth = await checkHealth(port);
  if (preKillHealth.state === "unreachable") {
    rmSync(pidFilePathFor(cwd), { force: true });
    console.log("Recorded PID is no longer serving Novara on this port (stale PID file cleared without terminating any process).");
    return { outcome: "stale-pid-cleared" };
  }
  if (preKillHealth.state === "occupied-non-novara") {
    console.error(`Port ${port} is occupied by a process that does not look like Novara. Refusing to terminate an unrelated process.`);
    return { outcome: "not-managed-by-this-tool", port };
  }

  console.log(`Stopping Novara (pid ${record.pid}) ...`);
  process.kill(record.pid);

  const deadline = Date.now() + stopTimeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(record.pid)) {
      rmSync(pidFilePathFor(cwd), { force: true });
      console.log("Novara stopped.");
      return { outcome: "stopped", pid: record.pid };
    }
    await wait(300);
  }

  console.error(`Novara (pid ${record.pid}) did not stop within ${stopTimeoutMs}ms.`);
  return { outcome: "stop-timed-out", pid: record.pid };
}

export type StatusResult =
  | { outcome: "running-healthy"; port: number }
  | { outcome: "running-unhealthy"; port: number }
  | { outcome: "occupied-non-novara"; port: number; detail: string }
  | { outcome: "not-running"; port: number };

export async function statusNovara(options: { port?: number; env?: NodeJS.ProcessEnv } = {}): Promise<StatusResult> {
  const port = options.port ?? resolvePort(options.env ?? process.env);
  const health = await checkHealth(port);
  if (health.state === "healthy") {
    console.log(`Novara is running and healthy on http://localhost:${port}.`);
    return { outcome: "running-healthy", port };
  }
  if (health.state === "unhealthy-novara") {
    console.error(`Novara is running on http://localhost:${port} but is unhealthy.`);
    return { outcome: "running-unhealthy", port };
  }
  if (health.state === "occupied-non-novara") {
    console.error(`Port ${port} is occupied by a non-Novara process (${health.detail}).`);
    return { outcome: "occupied-non-novara", port, detail: health.detail };
  }
  console.log(`Novara is not running on http://localhost:${port}.`);
  return { outcome: "not-running", port };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "start": {
      const result = await startNovara();
      process.exitCode = result.outcome === "started" || result.outcome === "already-running" ? 0 : 1;
      return;
    }
    case "stop": {
      const result = await stopNovara();
      process.exitCode = result.outcome === "stopped" || result.outcome === "not-running" || result.outcome === "stale-pid-cleared" ? 0 : 1;
      return;
    }
    case "status": {
      const result = await statusNovara();
      process.exitCode = result.outcome === "running-healthy" ? 0 : result.outcome === "not-running" ? 0 : 1;
      return;
    }
    default:
      console.error("Usage: novara-ctl <start|stop|status>");
      process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
