import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalProductionExecutionAccessService, loadLocalProductionExecutionAccessRules } from "./production-execution-access-service.ts";
import { readProductionAccessStatus, saveProductionAccess } from "./production-access-connection-service.ts";

assert.deepEqual(readProductionAccessStatus({}), { configured: false });
const root = mkdtempSync(path.join(tmpdir(), "novara-production-access-")); const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\nNOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS=old\n", "utf8");
saveProductionAccess(envPath, "first-secret", {}); saveProductionAccess(envPath, "second-secret", {});
const stored = readFileSync(envPath, "utf8"); assert.match(stored, /^OTHER=value/m); assert.equal((stored.match(/^NOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS=/gm) ?? []).length, 1);
const value = stored.split(/\r?\n/).find((line) => line.startsWith("NOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS="))!.split("=", 2)[1];
const access = new LocalProductionExecutionAccessService(loadLocalProductionExecutionAccessRules(value));
for (const operation of ["normalizeProductionBrief", "readProductionStatus", "decideProductionApproval", "produceApprovedContent"] as const) assert.equal(access.authorize(operation, "second-secret").status, "authorized");
const env = { NOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS: "process-secret" }; saveProductionAccess(path.join(root, "other.env"), "file-secret", env); assert.equal(env.NOVARA_PRODUCTION_EXECUTION_LOCAL_ACCESS, "process-secret");
console.log("Production access connection tests passed.");