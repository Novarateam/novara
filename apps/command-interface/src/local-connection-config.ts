import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function replaceLocalEnvEntries(envPath: string, values: Record<string, string>, env: NodeJS.ProcessEnv = process.env): void {
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const remaining = new Set(Object.keys(values));
  const next = lines.map((line) => {
    const key = Object.keys(values).find((candidate) => new RegExp(`^\\s*${candidate}\\s*=`).test(line));
    if (!key) return line;
    remaining.delete(key);
    return `${key}=${values[key]}`;
  });
  for (const key of remaining) next.push(`${key}=${values[key]}`);
  writeFileSync(envPath, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}\n`, "utf8");
  for (const [key, value] of Object.entries(values)) if (!env[key]?.trim()) env[key] = value;
}