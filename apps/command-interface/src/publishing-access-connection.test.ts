import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalPublishingQueueAccessService, loadLocalPublishingQueueAccessRules } from "./publishing-queue-access-service.ts";
import { readPublishingAccessStatus, savePublishingAccess } from "./publishing-access-connection-service.ts";

assert.deepEqual(readPublishingAccessStatus({}), { configured: false });
const root = mkdtempSync(path.join(tmpdir(), "novara-publishing-access-")); const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\nNOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS=old\n", "utf8");
savePublishingAccess(envPath, "first-secret", {}); savePublishingAccess(envPath, "second-secret", {});
const stored = readFileSync(envPath, "utf8"); assert.match(stored, /^OTHER=value/m); assert.equal((stored.match(/^NOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS=/gm) ?? []).length, 1);
const value = stored.split(/\r?\n/).find((line) => line.startsWith("NOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS="))!.split("=", 2)[1];
assert.equal(new LocalPublishingQueueAccessService(loadLocalPublishingQueueAccessRules(value)).authorize("enqueueProposal", "second-secret").status, "authorized");
const env = { NOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS: "process-secret" }; savePublishingAccess(path.join(root, "other.env"), "file-secret", env); assert.equal(env.NOVARA_PUBLISHING_QUEUE_LOCAL_ACCESS, "process-secret");
console.log("Publishing access connection tests passed.");