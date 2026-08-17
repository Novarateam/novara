import assert from "node:assert/strict";
import { LocalPromotionAccessService, loadLocalPromotionAccessRules } from "./promotion-access-service.ts";

const access = new LocalPromotionAccessService([
  { identity: "proposer", credential: "proposal-secret", operations: ["createPromotionProposal"] },
  { identity: "confirmer", credential: "confirm-secret", operations: ["confirmPromotion"] },
  { identity: "applier", credential: "apply-secret", operations: ["applyPromotion"] },
]);
assert.equal(access.authorize("createPromotionProposal", undefined).status, "authentication-rejected");
assert.equal(access.authorize("createPromotionProposal", "bad").status, "authentication-rejected");
assert.equal(access.authorize("applyPromotion", "proposal-secret").status, "authorization-rejected");
const authorized = access.authorize("confirmPromotion", "confirm-secret");
assert.equal(authorized.status, "authorized");
if (authorized.status === "authorized") assert.equal(authorized.identity, "confirmer");
assert.deepEqual(loadLocalPromotionAccessRules("not-json"), []);
assert.deepEqual(loadLocalPromotionAccessRules(JSON.stringify([{ identity: "x", credential: "y", operations: ["applyPromotion"] }])), [{ identity: "x", credential: "y", operations: ["applyPromotion"] }]);
console.log("Promotion access tests passed.");