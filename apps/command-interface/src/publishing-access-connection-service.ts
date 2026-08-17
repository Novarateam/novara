import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadLocalPublishingQueueAccessRules } from "./publishing-queue-access-service.ts";

const KEY = "NOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS";
export function readPublishingAccessStatus(env: NodeJS.ProcessEnv = process.env) { return { configured: loadLocalPublishingQueueAccessRules(env[KEY]).length > 0 }; }
export function savePublishingAccess(envPath: string, credential: string, env: NodeJS.ProcessEnv = process.env): void {
  const value = credential.trim(); if (!value) throw new Error("Publishing Access credential is required.");
  const rule = JSON.stringify([{ identity: "human-publisher", credential: value, operations: ["enqueueProposal"] }]);
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : []; let replaced = false;
  const next = lines.map((line) => { if (new RegExp(`^\\s*${KEY}\\s*=`).test(line)) { replaced = true; return `${KEY}=${rule}`; } return line; });
  if (!replaced) next.push(`${KEY}=${rule}`);
  writeFileSync(envPath, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}\n`, "utf8");
  if (!env[KEY]?.trim()) env[KEY] = rule;
}