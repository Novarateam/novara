import assert from "node:assert/strict";
import { LocalProductionExecutionAccessService, loadLocalProductionExecutionAccessRules } from "./production-execution-access-service.ts";

const access = new LocalProductionExecutionAccessService([{ identity: "human-producer", credential: "production-secret", operations: ["produceApprovedContent", "readProductionStatus", "normalizeProductionBrief"] }]);
assert.equal(access.authorize("produceApprovedContent", undefined).status, "authentication-rejected");
assert.equal(access.authorize("produceApprovedContent", "wrong").status, "authentication-rejected");
assert.equal(access.authorize("unknown" as never, "production-secret").status, "authorization-rejected");
const authorized = access.authorize("produceApprovedContent", "production-secret");
assert.equal(authorized.status, "authorized");
if (authorized.status === "authorized") assert.equal(authorized.identity, "human-producer");
assert.equal(access.authorize("readProductionStatus", "production-secret").status, "authorized");
assert.equal(access.authorize("normalizeProductionBrief", "production-secret").status, "authorized");
assert.deepEqual(loadLocalProductionExecutionAccessRules("not-json"), []);
assert.deepEqual(loadLocalProductionExecutionAccessRules(JSON.stringify([{ identity: "human-producer", credential: "production-secret", operations: ["produceApprovedContent", "readProductionStatus", "normalizeProductionBrief"] }])), [{ identity: "human-producer", credential: "production-secret", operations: ["produceApprovedContent", "readProductionStatus", "normalizeProductionBrief"] }]);
console.log("Production execution access tests passed.");