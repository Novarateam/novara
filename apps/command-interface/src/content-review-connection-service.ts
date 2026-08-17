import { existsSync, readFileSync, writeFileSync } from "node:fs";

const KEY = "NOVARA_CONTENT_REVIEW_LOCAL_ACCESS";
export function readContentReviewAccessStatus(env: NodeJS.ProcessEnv = process.env) { return { configured: Boolean(env[KEY]?.trim()) }; }
export function saveContentReviewAccess(envPath: string, credential: string, env: NodeJS.ProcessEnv = process.env): void {
  const value = credential.trim(); if (!value) throw new Error("Content Review credential is required.");
  const rule = JSON.stringify([{ identity: "human-reviewer", credential: value, operations: ["approveProposal", "rejectProposal"] }]);
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : []; let replaced = false;
  const next = lines.map((line) => { if (new RegExp(`^\\s*${KEY}\\s*=`).test(line)) { replaced = true; return `${KEY}=${rule}`; } return line; });
  if (!replaced) next.push(`${KEY}=${rule}`);
  writeFileSync(envPath, `${next.filter((line, index) => line || index < next.length - 1).join("\n")}\n`, "utf8");
  if (!env[KEY]?.trim()) env[KEY] = rule;
}