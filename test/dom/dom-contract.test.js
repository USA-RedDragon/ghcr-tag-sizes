"use strict";

// Deterministic guard against GitHub markup drift: runs the real lib.js extraction
// logic over saved copies of GitHub package pages. If GitHub changes the DOM we
// depend on, these fail — refresh the fixtures (see README) and adjust selectors.
//
// The live counterpart (fetching these pages fresh) runs in the nightly e2e workflow.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const GHCR = require("../../lib.js");

const FIX = path.join(__dirname, "..", "fixtures");
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function rows(file) {
  const html = fs.readFileSync(path.join(FIX, file), "utf8");
  const { document } = new JSDOM(html).window;
  return document.querySelectorAll("li.Box-row");
}

test("parseImagePath resolves the fixtures' image", () => {
  assert.equal(
    GHCR.parseImagePath("/orgs/clevyr/packages/container/package/scaffold"),
    "clevyr/scaffold"
  );
});

test("tagged overview: every version row yields a digest and an injection point", () => {
  const list = rows("tagged-overview.html");
  assert.ok(list.length >= 1, "found Box-rows");
  for (const row of list) {
    const digest = GHCR.extractDigest(row);
    assert.match(digest || "", DIGEST_RE, "row exposes a sha256 digest");
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
    const digest = GHCR.extractDigest(row);
    assert.match(digest || "", DIGEST_RE, "untagged row exposes a sha256 digest");
    if (!row.querySelector('clipboard-copy[value^="sha256:"]')) sawUntagged = true;
  }
  assert.ok(sawUntagged, "at least one row had no copy button (text-only digest path)");
});
