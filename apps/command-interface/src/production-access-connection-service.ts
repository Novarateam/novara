import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadLocalProductionExecutionAccessRules } from "./production-execution-access-service.ts";

const KEY = "NOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS";
const operations = ["normalizeProductionBrief", "readProductionStatus", "decideProductionApproval", "produceApprovedContent"];
export function readProductionAccessStatus(env: NodeJS.ProcessEnv = process.env) { return { configured: loadLocalProductionExecutionAccessRules(env[KEY]).length > 0 }; }
export function saveProductionAccess(envPath: string, credential: string, env: NodeJS.ProcessEnv = process.env): void {
  const value = credential.trim(); if (!value) throw new Error("Production Access credential is required.");
  const rule = JSON.stringify([{ identity: "human-producer", credential: value, operations }]);
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : []; let replaced = false;
  const next = lines.map((line) => { if (new RegExp(`^\\s*${KEY}\\s*=`).test(line)) { replaced = true; return `${KEY}=${rule}`; } return line; });
  if (!replaced) next.push(`${KEY}=${rule}`);
  writeFileSync(envPath, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}\n`, "utf8");
  if (!env[KEY]?.trim()) env[KEY] = rule;
}