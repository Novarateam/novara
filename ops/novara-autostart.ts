// Windows auto-start helper for the Novara command interface.
//
// This is a deployment/operational layer only: it never constructs
// AgentRuntime/Brain, never touches persistence files or the runtime's
// persisted state, and never calls any internal Runtime mutation API. It
// manages a single file in the CURRENT USER's Windows "Startup" folder
// (no admin rights, no Scheduled Task service involved) whose sole action
// is to invoke the EXISTING controller command ("npm.cmd run novara:start")
// in the Novara repository directory. Duplicate-instance prevention remains
// entirely the responsibility of ops/novara-ctl.ts, which this file simply
// calls.
//
// Note: a per-user Windows Scheduled Task with an "At log on" trigger was
// evaluated first, but schtasks /Create with /SC ONLOGON returned
// "ERROR: Access is denied" on this split-token (UAC) standard account even
// for the current user's own task, with no admin-free workaround found.
// The user Startup folder is a standard, admin-free Windows auto-start
// mechanism for exactly this purpose and avoids that restriction entirely.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./novara-ctl.ts";

export const launcherFileName = "NovaraAutoStart.cmd";

export type PlatformCheck = { ok: true } | { ok: false; reason: string };

export function assertWindows(platform: NodeJS.Platform = process.platform): PlatformCheck {
  return platform === "win32"
    ? { ok: true }
    : { ok: false, reason: `Auto-start is only supported on Windows (detected platform: ${platform}).` };
}

export type NpmLookup = { found: true; path: string } | { found: false; error: string };

/** Resolves the full path to npm.cmd on PATH; never assumes a fixed install location. */
export function findNpmCmd(env: NodeJS.ProcessEnv = process.env): NpmLookup {
  const result = spawnSync("where", ["npm.cmd"], { encoding: "utf8", env });
  if (result.error) {
    return { found: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { found: false, error: (result.stderr || result.stdout || "npm.cmd was not found on PATH").trim() };
  }
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!first) {
    return { found: false, error: "npm.cmd was not found on PATH" };
  }
  return { found: true, path: first };
}

/** The exact launcher content executed at logon: cd to the repo, then run the existing controller. */
export function buildLauncherScript(cwd: string, npmPath: string): string {
  return `@echo off\r\ncd /d "${cwd}"\r\n"${npmPath}" run novara:start\r\n`;
}

/** Resolves the current user's Startup folder without hardcoding a drive letter or username. */
export function resolveStartupFolder(env: NodeJS.ProcessEnv = process.env): string | null {
  const appData = env.APPDATA;
  if (!appData) {
    return null;
  }
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
}

export function launcherPathIn(startupFolder: string): string {
  return path.join(startupFolder, launcherFileName);
}

export type InstallOptions = { cwd?: string; startupFolder?: string; env?: NodeJS.ProcessEnv };
export type InstallResult =
  | { outcome: "installed"; launcherPath: string }
  | { outcome: "failed"; reason: string };

/** Installs (or refreshes) a current-user Startup-folder entry that runs the existing controller at logon. */
export function installAutoStart(options: InstallOptions = {}): InstallResult {
  const platform = assertWindows();
  if (!platform.ok) {
    console.error(platform.reason);
    return { outcome: "failed", reason: platform.reason };
  }

  const cwd = options.cwd ?? repoRoot;
  if (!existsSync(path.join(cwd, "package.json"))) {
    const reason = `Cannot determine a safe Novara repository path: no package.json found at ${cwd}.`;
    console.error(reason);
    return { outcome: "failed", reason };
  }

  const startupFolder = options.startupFolder ?? resolveStartupFolder(options.env ?? process.env);
  if (!startupFolder) {
    const reason = "Could not resolve the current user's Startup folder (APPDATA is not set).";
    console.error(reason);
    return { outcome: "failed", reason };
  }

  const npm = findNpmCmd(options.env ?? process.env);
  if (!npm.found) {
    const reason = `Could not resolve npm.cmd on PATH: ${npm.error}`;
    console.error(reason);
    return { outcome: "failed", reason };
  }

  try {
    mkdirSync(startupFolder, { recursive: true });
    const launcherPath = launcherPathIn(startupFolder);
    writeFileSync(launcherPath, buildLauncherScript(cwd, npm.path));
    console.log(
      `Installed auto-start entry at ${launcherPath}: at next logon, Windows will run "${npm.path}" run novara:start in ${cwd}.`,
    );
    return { outcome: "installed", launcherPath };
  } catch (error) {
    const reason = `Could not write the Startup folder entry: ${(error as Error).message}`;
    console.error(reason);
    return { outcome: "failed", reason };
  }
}

export type RemoveOptions = { startupFolder?: string; env?: NodeJS.ProcessEnv };
export type RemoveResult =
  | { outcome: "removed"; launcherPath: string }
  | { outcome: "not-installed"; launcherPath: string }
  | { outcome: "failed"; reason: string };

/** Removes only the auto-start entry created by this helper. Idempotent: reports (not-installed) if absent. */
export function removeAutoStart(options: RemoveOptions = {}): RemoveResult {
  const platform = assertWindows();
  if (!platform.ok) {
    console.error(platform.reason);
    return { outcome: "failed", reason: platform.reason };
  }

  const startupFolder = options.startupFolder ?? resolveStartupFolder(options.env ?? process.env);
  if (!startupFolder) {
    const reason = "Could not resolve the current user's Startup folder (APPDATA is not set).";
    console.error(reason);
    return { outcome: "failed", reason };
  }

  const launcherPath = launcherPathIn(startupFolder);
  if (!existsSync(launcherPath)) {
    console.log(`Auto-start entry is not installed (expected at ${launcherPath}).`);
    return { outcome: "not-installed", launcherPath };
  }

  try {
    rmSync(launcherPath, { force: true });
    console.log(`Removed auto-start entry at ${launcherPath}.`);
    return { outcome: "removed", launcherPath };
  } catch (error) {
    const reason = `Could not remove the Startup folder entry: ${(error as Error).message}`;
    console.error(reason);
    return { outcome: "failed", reason };
  }
}

export type StatusOptions = { startupFolder?: string; env?: NodeJS.ProcessEnv };
export type StatusResult =
  | { outcome: "installed"; launcherPath: string; contents: string }
  | { outcome: "not-installed"; launcherPath: string }
  | { outcome: "failed"; reason: string };

/** Reports whether the auto-start entry exists and, if so, what it will run. */
export function statusAutoStart(options: StatusOptions = {}): StatusResult {
  const platform = assertWindows();
  if (!platform.ok) {
    console.error(platform.reason);
    return { outcome: "failed", reason: platform.reason };
  }

  const startupFolder = options.startupFolder ?? resolveStartupFolder(options.env ?? process.env);
  if (!startupFolder) {
    const reason = "Could not resolve the current user's Startup folder (APPDATA is not set).";
    console.error(reason);
    return { outcome: "failed", reason };
  }

  const launcherPath = launcherPathIn(startupFolder);
  if (!existsSync(launcherPath)) {
    console.log(`Auto-start entry is not installed (expected at ${launcherPath}).`);
    return { outcome: "not-installed", launcherPath };
  }

  const contents = readFileSync(launcherPath, "utf8");
  console.log(`Auto-start entry is installed at ${launcherPath}:`);
  console.log(contents.trim());
  return { outcome: "installed", launcherPath, contents };
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case "install": {
      const result = installAutoStart();
      process.exitCode = result.outcome === "installed" ? 0 : 1;
      return;
    }
    case "remove": {
      const result = removeAutoStart();
      process.exitCode = result.outcome === "removed" || result.outcome === "not-installed" ? 0 : 1;
      return;
    }
    case "status": {
      const result = statusAutoStart();
      process.exitCode = result.outcome === "installed" || result.outcome === "not-installed" ? 0 : 1;
      return;
    }
    default:
      console.error("Usage: novara-autostart <install|remove|status>");
      process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}

