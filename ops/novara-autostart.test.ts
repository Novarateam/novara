import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertWindows,
  buildLauncherScript,
  findNpmCmd,
  installAutoStart,
  launcherFileName,
  launcherPathIn,
  removeAutoStart,
  resolveStartupFolder,
  statusAutoStart,
} from "./novara-autostart.ts";

// 1. The generated auto-start command points to the correct existing npm.cmd run novara:start.
{
  const script = buildLauncherScript("C:\\Repo Root", "C:\\nodejs\\npm.cmd");
  assert.match(script, /"C:\\nodejs\\npm\.cmd" run novara:start/);
}

// 2. The correct Novara repository working directory is used.
{
  const script = buildLauncherScript("C:\\Repo Root", "C:\\nodejs\\npm.cmd");
  assert.match(script, /cd \/d "C:\\Repo Root"/);
}

// 3. Current-user scoped: the mechanism is the invoking user's own Startup folder (derived from
// their own APPDATA), never a machine-wide/all-users location or another account.
{
  const folder = resolveStartupFolder({ APPDATA: "C:\\Users\\Someone\\AppData\\Roaming" });
  assert.equal(folder, path.join("C:\\Users\\Someone\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup"));
  assert.equal(resolveStartupFolder({}), null, "must fail clearly rather than guess when APPDATA is unavailable");
}

// Platform gating: fails clearly (not silently) when not on Windows.
{
  const nonWindows = assertWindows("linux");
  assert.equal(nonWindows.ok, false);
  assert.match((nonWindows as { reason: string }).reason, /Windows/);
  assert.equal(assertWindows("win32").ok, true);
}

// 6. Failure from the underlying OS/environment lookup is surfaced as failure, not silently reported as success.
{
  const lookup = findNpmCmd({ PATH: "" });
  assert.equal(lookup.found, false, "an empty PATH must not resolve npm.cmd");
}

// 7. The helper does not import Runtime, Brain, persistence, server internals, or the runtime's state file.
{
  const source = readFileSync(new URL("./novara-autostart.ts", import.meta.url), "utf8");
  assert.ok(!/agent-runtime\/src\/(runtime|persistence|brain)/.test(source));
  assert.ok(!/state\.json/.test(source));
  assert.ok(!/createServer|http\.createServer/.test(source), "must not create a new HTTP server");
}

// Repository path safety: refuses to install when the target has no package.json.
{
  const emptyDir = mkdtempSync(path.join(tmpdir(), "novara-autostart-nopkg-"));
  const fakeStartup = mkdtempSync(path.join(tmpdir(), "novara-autostart-startup-"));
  try {
    const result = installAutoStart({ cwd: emptyDir, startupFolder: fakeStartup });
    assert.equal(result.outcome, "failed");
    assert.match((result as { reason: string }).reason, /package\.json/);
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
    rmSync(fakeStartup, { recursive: true, force: true });
  }
}

// 2 (cont), 4, 5. End-to-end against an isolated fake Startup folder so this test never touches
// the real logon auto-start entry a user may have installed on this machine.
{
  const cwd = mkdtempSync(path.join(tmpdir(), "novara-autostart-e2e-"));
  const startupFolder = path.join(mkdtempSync(path.join(tmpdir(), "novara-autostart-startup-")), "Startup");
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "fixture" }));

  try {
    // Not installed before we create it.
    const before = statusAutoStart({ startupFolder });
    assert.equal(before.outcome, "not-installed");

    const install = installAutoStart({ cwd, startupFolder, env: process.env });
    assert.equal(install.outcome, "installed");
    const launcherPath = (install as { launcherPath: string }).launcherPath;
    assert.equal(launcherPath, launcherPathIn(startupFolder));
    assert.ok(existsSync(launcherPath));
    assert.match(readFileSync(launcherPath, "utf8"), new RegExp(`cd /d "${cwd.replace(/\\/g, "\\\\")}"`));

    // 4. Status distinguishes installed vs not installed.
    const status = statusAutoStart({ startupFolder });
    assert.equal(status.outcome, "installed");
    assert.ok((status as { contents: string }).contents.includes("run novara:start"));

    // 5. Remove targets only this helper's own launcher file.
    const removed = removeAutoStart({ startupFolder });
    assert.equal(removed.outcome, "removed");
    assert.equal(existsSync(launcherPath), false);

    const after = statusAutoStart({ startupFolder });
    assert.equal(after.outcome, "not-installed");

    // Idempotent remove is explicit, not an error.
    const removeAgain = removeAutoStart({ startupFolder });
    assert.equal(removeAgain.outcome, "not-installed", "removing when nothing is installed must be reported explicitly, not as an error");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(path.dirname(startupFolder), { recursive: true, force: true });
  }
}

assert.notEqual(launcherFileName, "", "a stable launcher file name must exist for install/remove/status without args");

console.log("novara-autostart tests passed.");

