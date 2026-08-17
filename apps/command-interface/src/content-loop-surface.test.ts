import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

assert.match(server, /\/api\/content-proposal/);
assert.match(server, /executeSpecialist\("A-014"/);
assert.match(server, /content and platform are required/);
assert.match(app, /content-source/);
assert.match(app, /content-platform/);
assert.match(app, /content-goal/);
assert.match(app, /content-proposal-create/);
assert.match(app, /submitContentProposal/);
assert.match(app, /\/api\/content-proposal/);
assert.doesNotMatch(server, /content-proposal[\s\S]{0,800}publish/i);
assert.doesNotMatch(app, /content-proposal-.*publish/i);

console.log("Content loop surface tests passed.");
