import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

assert.match(app, /contentDraft: \{ content: "", platform: "TikTok", goal: "" \}/);
assert.match(app, /escapeHtml\(appState\.contentDraft\.content\)/);
assert.match(app, /appState\.contentDraft\.goal/);
assert.match(app, /appState\.contentDraft\[key\] = event\.target\?\.value/);
assert.match(app, /const \{ content, platform, goal \} = appState\.contentDraft/);
assert.match(app, /appState\.contentDraft = \{ content: "", platform: "TikTok", goal: "" \}/);
assert.doesNotMatch(app, /contentDraft.*localStorage|localStorage.*contentDraft/);

console.log("Content draft retention tests passed.");
