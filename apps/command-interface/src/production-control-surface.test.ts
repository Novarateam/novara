import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

assert.match(serverSource, /\/api\/production-status/);
assert.match(serverSource, /\/api\/production-approval/);
assert.match(serverSource, /\/api\/production-execute/);
assert.match(serverSource, /\/api\/production-brief/);

assert.match(appSource, /NOVARA PRODUCTION CONTROL/);
assert.match(appSource, /renderProductionControlPanel/);
assert.match(appSource, /awaiting-production-approval/);
assert.match(appSource, /rejected-for-production/);
assert.match(appSource, /ready-to-produce/);
assert.match(appSource, /Final Video/);
assert.match(appSource, /Stage overview/);
assert.match(appSource, /data-action=\"production-approve\"/);
assert.match(appSource, /data-action=\"production-reject\"/);
assert.match(appSource, /data-action=\"production-execute\"/);
assert.match(appSource, /data-action=\"production-brief-normalize\"/);
assert.match(appSource, /\/api\/production-approval/);
assert.match(appSource, /\/api\/production-execute/);
assert.match(appSource, /\/api\/production-brief/);
assert.match(appSource, /\/api\/production-status\?/);

const noBypass = !/production-execute.*production-approval/.test(appSource) &&
  !/production-approve.*production-execute/.test(appSource);
assert.equal(noBypass, true, "UI must not bypass production approval before execution");

console.log("Production control surface tests passed.");
