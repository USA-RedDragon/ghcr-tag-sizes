import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateManifest } from "../../manifest.config.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const exists = (f: string): boolean => fs.existsSync(path.join(ROOT, f));

const firefox = generateManifest("firefox") as any;
const chrome = generateManifest("chrome") as any;

function assertCommon(m: any, label: string): void {
  assert.equal(m.manifest_version, 3, `${label}: MV3`);
  assert.equal(m.name, "GHCR Tag Sizes", `${label}: name`);
  assert.match(m.version, /^\d+\.\d+\.\d+(\.\d+)?$/, `${label}: version (3- or 4-part)`);
  assert.deepEqual(m.host_permissions, ["https://ghcr.io/*"], `${label}: host perms`);

  const cs = m.content_scripts[0];
  assert.deepEqual(cs.js, ["src/content.ts"], `${label}: content js`);
  // All three GitHub package-page URL shapes are matched.
  for (const pat of [
    "https://github.com/orgs/*/packages/container/*",
    "https://github.com/users/*/packages/container/*",
    "https://github.com/*/*/pkgs/container/*",
  ]) {
    assert.ok(cs.matches.includes(pat), `${label}: matches ${pat}`);
  }

  // Every referenced entry/asset must exist as a source file.
  for (const f of [...cs.js, ...(cs.css ?? [])]) {
    assert.ok(exists(f), `${label}: referenced ${f} exists`);
  }
}

test("firefox manifest: MV3 event-page background bundles src/background.ts", () => {
  assertCommon(firefox, "firefox");
  assert.deepEqual(firefox.background.scripts, ["src/background.ts"]);
  assert.ok(firefox.browser_specific_settings?.gecko?.id, "has gecko id");
  assert.ok(exists(firefox.background.scripts[0]));
});

test("chrome manifest: MV3 service worker points at src/background.ts", () => {
  assertCommon(chrome, "chrome");
  assert.equal(chrome.background.service_worker, "src/background.ts");
  assert.ok(!chrome.background.scripts, "chrome must not use background.scripts");
  assert.ok(!chrome.browser_specific_settings, "chrome should omit gecko settings");
  assert.ok(exists(chrome.background.service_worker));
});

test("both manifests agree on name and version", () => {
  assert.equal(firefox.name, chrome.name);
  assert.equal(firefox.version, chrome.version);
});
