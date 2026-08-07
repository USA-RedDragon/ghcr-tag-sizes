// Deterministic guard against GitHub markup drift: runs the real lib.ts extraction
// logic over saved copies of GitHub package pages. If GitHub changes the DOM we
// depend on, these fail — refresh the fixtures (see README) and adjust selectors.
// The live counterpart runs in the nightly e2e workflow.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as GHCR from "../../src/lib.ts";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function rows(file: string): NodeListOf<Element> {
  const html = fs.readFileSync(path.join(FIX, file), "utf8");
  return new JSDOM(html).window.document.querySelectorAll("li.Box-row");
}

test("parseImagePath resolves the fixtures' image (repo-scoped URL)", () => {
  assert.equal(
    GHCR.parseImagePath("/USA-RedDragon/dockers/pkgs/container/alpine"),
    "usa-reddragon/alpine"
  );
});

test("tagged overview: every version row yields a digest and an injection point", () => {
  const list = rows("tagged-overview.html");
  assert.ok(list.length >= 1, "found Box-rows");
  for (const row of list) {
    assert.match(GHCR.extractDigest(row) ?? "", DIGEST_RE, "row exposes a sha256 digest");
    assert.ok(
      row.querySelector(".d-inline-flex.flex-wrap"),
      "row has the tag-pill container we anchor the badge to"
    );
  }
});

test("untagged versions: digest comes from the row link text (no copy button)", () => {
  const list = rows("untagged-versions.html");
  assert.ok(list.length >= 1, "found Box-rows");
  let sawUntagged = false;
  for (const row of list) {
    assert.match(GHCR.extractDigest(row) ?? "", DIGEST_RE, "untagged row exposes a sha256 digest");
    if (!row.querySelector('clipboard-copy[value^="sha256:"]')) sawUntagged = true;
  }
  assert.ok(sawUntagged, "at least one row had no copy button (text-only digest path)");
});
