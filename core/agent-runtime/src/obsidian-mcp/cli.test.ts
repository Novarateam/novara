import assert from "node:assert/strict";
import path from "node:path";
import { readVaultRootFromArgs, repositoryVaultRoot, resolveVaultRoot } from "./cli.ts";

const modulePath = path.resolve(process.cwd(), "core/agent-runtime/src/obsidian-mcp/cli.ts");
const canonicalVault = path.resolve(process.cwd(), "Novara");

assert.equal(readVaultRootFromArgs(["--vault-root", "C:/custom/vault"]), "C:/custom/vault");
assert.equal(repositoryVaultRoot(modulePath), canonicalVault);
assert.equal(resolveVaultRoot([], {}, modulePath), canonicalVault, "the default must be the repository canonical vault");
assert.equal(resolveVaultRoot([], { OBSIDIAN_VAULT_ROOT: "C:/configured/vault" }, modulePath), "C:/configured/vault", "the environment must override the repository default");
assert.equal(resolveVaultRoot(["--vault-root", "C:/explicit/vault"], { OBSIDIAN_VAULT_ROOT: "C:/configured/vault" }, modulePath), "C:/explicit/vault", "the explicit argument must override the environment");
assert.notEqual(resolveVaultRoot([], {}, modulePath), "C:\\Development\\Novara\\Novara");

console.log("Obsidian MCP CLI tests passed.");