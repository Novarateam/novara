import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalContentReviewAccessService, loadLocalContentReviewAccessRules } from "./content-review-access-service.ts";
import { readContentReviewAccessStatus, saveContentReviewAccess } from "./content-review-connection-service.ts";

assert.deepEqual(readContentReviewAccessStatus({}), { configured: false });
const root = mkdtempSync(path.join(tmpdir(), "novara-review-access-")); const envPath = path.join(root, ".env");
writeFileSync(envPath, "OTHER=value\nNOVARA_CONTENT_REVIEW_LOCAL_ACCESS=old\n", "utf8");
saveContentReviewAccess(envPath, "first-secret", {}); saveContentReviewAccess(envPath, "second-secret", {});
const stored = readFileSync(envPath, "utf8"); assert.match(stored, /^OTHER=value/m); assert.equal((stored.match(/^NOVARA_CONTENT_REVIEW_LOCAL_ACCESS=/gm) ?? []).length, 1);
const value = stored.split(/\r?\n/).find((line) => line.startsWith("NOVARA_CONTENT_REVIEW_LOCAL_ACCESS="))!.split("=", 2)[1];
const access = new LocalContentReviewAccessService(loadLocalContentReviewAccessRules(value));
assert.equal(access.authorize("approveProposal", "second-secret").status, "authorized"); assert.equal(access.authorize("rejectProposal", "second-secret").status, "authorized");
console.log("Content review connection tests passed.");