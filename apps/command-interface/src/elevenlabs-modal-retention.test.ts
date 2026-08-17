import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
assert.match(app, /elevenLabsDraft: \{ voiceId: "", modelId: "" \}/);
assert.match(app, /liveElevenLabsKey = document\.querySelector/);
assert.match(app, /type="password"[^>]*value="\$\{escapeHtml\(liveElevenLabsKey\)\}"/);
assert.match(app, /appState\.elevenLabsDraft\[key\] = event\.target\?\.value/);
assert.match(app, /appState\.elevenLabsDraft = \{ voiceId: "", modelId: "" \}/);
assert.doesNotMatch(app, /elevenLabsDraft:\s*\{[^}]*apiKey/);
assert.doesNotMatch(app, /localStorage.*elevenlabs|sessionStorage.*elevenlabs/);
console.log("ElevenLabs modal retention tests passed.");
