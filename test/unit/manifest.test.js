"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const exists = (f) => fs.existsSync(path.join(ROOT, f));

const firefox = read("manifest.json");
const chrome = read("manifest.chrome.json");

function assertCommon(m, label) {
  assert.equal(m.manifest_version, 3, `${label}: MV3`);
  assert.equal(m.name, "GHCR Tag Sizes", `${label}: name`);
  assert.match(m.version, /^\d+\.\d+\.\d+$/, `${label}: semver`);
  assert.deepEqual(m.host_permissions, ["https://ghcr.io/*"], `${label}: host perms`);

  const cs = m.content_scripts[0];
  assert.deepEqual(cs.js, ["lib.js", "content.js"], `${label}: content js order`);
  assert.ok(cs.matches.includes("https://github.com/orgs/*/packages/container/*"), `${label}: org match`);
  assert.ok(cs.matches.includes("https://github.com/users/*/packages/container/*"), `${label}: user match`);

  // Every referenced file must exist.
  for (const f of [...cs.js, ...(cs.css || [])]) {
    assert.ok(exists(f), `${label}: referenced ${f} exists`);
  }
}

test("firefox manifest: MV3 event-page background loads lib.js then background.js", () => {
  assertCommon(firefox, "firefox");
  assert.deepEqual(firefox.background.scripts, ["lib.js", "background.js"]);
  assert.ok(firefox.browser_specific_settings?.gecko?.id, "has gecko id");
  for (const f of firefox.background.scripts) assert.ok(exists(f));
});

test("chrome manifest: MV3 service worker points at background.js", () => {
  assertCommon(chrome, "chrome");
  assert.equal(chrome.background.service_worker, "background.js");
  assert.ok(!chrome.background.scripts, "chrome must not use background.scripts");
  assert.ok(!chrome.browser_specific_settings, "chrome should omit gecko settings");
  assert.ok(exists(chrome.background.service_worker));
});

test("both manifests agree on name and version", () => {
  assert.equal(firefox.name, chrome.name);
  assert.equal(firefox.version, chrome.version);
});
