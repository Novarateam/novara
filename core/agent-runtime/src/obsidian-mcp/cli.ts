import { startObsidianReadOnlyMcpServer } from "./server.ts";

function readVaultRootFromArgs(): string | undefined {
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--vault-root") {
      return args[i + 1];
    }
  }

  return undefined;
}

async function main() {
  const vaultRoot =
    readVaultRootFromArgs() ??
    process.env.OBSIDIAN_VAULT_ROOT ??
    "C:\\Development\\Novara\\Novara";

  await startObsidianReadOnlyMcpServer(vaultRoot);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
