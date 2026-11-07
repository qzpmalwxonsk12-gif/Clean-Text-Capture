"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const manifestPath = path.join(projectRoot, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

assert.equal(manifest.manifest_version, 3, "The extension must use Manifest V3");
assert.equal(manifest.background.service_worker, "background.js");
assert.deepEqual(manifest.permissions, [
  "alarms",
  "clipboardWrite",
  "contextMenus",
  "downloads",
  "offscreen",
  "storage"
]);
assert.equal(manifest.version, "2.2.0");
assert.equal(manifest.action.default_popup, "popup.html");
assert.ok(manifest.action);
assert.equal(manifest.options_ui.page, "options.html");
assert.ok(Array.isArray(manifest.content_scripts));
assert.ok(manifest.content_scripts.length > 0);

const referencedFiles = [manifest.background.service_worker];
for (const entry of manifest.content_scripts) {
  referencedFiles.push(...(entry.js || []), ...(entry.css || []));
}
referencedFiles.push("offscreen.html", "offscreen.js", "options.html", "options.js", "archive.js", "export-core.js", "popup.html", "popup.js");
referencedFiles.push("pdf-export.js", "vendor/pdf-lib.min.js", "vendor/fontkit.umd.min.js", "fonts/NotoSans-Regular.ttf", "fonts/NotoSansSC.ttf");
referencedFiles.push("timing-core.js");

for (const relativeFile of referencedFiles) {
  const absoluteFile = path.resolve(projectRoot, relativeFile);
  assert.ok(
    absoluteFile.startsWith(projectRoot + path.sep),
    `Manifest path escapes the project: ${relativeFile}`
  );
  assert.ok(fs.existsSync(absoluteFile), `Missing manifest file: ${relativeFile}`);
}

console.log(`Manifest validated (${referencedFiles.length} referenced files).`);
