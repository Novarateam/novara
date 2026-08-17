import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

assert.match(html, /overflow-x:\s*hidden;\s*overflow-y:\s*auto/);
assert.match(html, /min-height:\s*100vh;\s*height:\s*auto/);
assert.match(app, /overflow:visible.*min-height:100vh/);
assert.doesNotMatch(app, /class="app-shell"[^>]*overflow:hidden[^>]*height:100vh/);

console.log("Navigation scroll surface tests passed.");