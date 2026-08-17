import path from "node:path";
import { fileURLToPath } from "node:url";
import { startObsidianReadOnlyMcpServer } from "./server.ts";

export function readVaultRootFromArgs(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--vault-root") {
      return args[i + 1];
    }
  }

  return undefined;
}

export function repositoryVaultRoot(modulePath = fileURLToPath(import.meta.url)): string {
  return path.resolve(path.dirname(modulePath), "../../../..", "Novara");
}

export function resolveVaultRoot(args: string[], env: NodeJS.ProcessEnv = process.env, modulePath = fileURLToPath(import.meta.url)): string {
  return readVaultRootFromArgs(args) ?? env.OBSIDIAN_VAULT_ROOT ?? repositoryVaultRoot(modulePath);
}

async function main() {
  await startObsidianReadOnlyMcpServer(resolveVaultRoot(process.argv.slice(2)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
