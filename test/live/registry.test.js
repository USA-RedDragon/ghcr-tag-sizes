"use strict";

// Live integration against the real ghcr.io registry. This is the check unit tests
// cannot be: it catches ghcr.io changing its auth flow or manifest format. It drives
// the SAME algorithm the extension uses (lib.js computeArches) over a real anonymous
// token + real manifests. Requires network; runs in CI and can run nightly.
//
// Pinned to a public, stable multi-arch image.

const test = require("node:test");
const assert = require("node:assert/strict");
const GHCR = require("../../lib.js");

const REGISTRY = "https://ghcr.io";
const IMAGE = "clevyr/scaffold";
const TAG = "beta";
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function getToken() {
  const res = await fetch(
    `${REGISTRY}/token?scope=repository:${IMAGE}:pull&service=ghcr.io`
  );
  assert.ok(res.ok, `token HTTP ${res.status}`);
  const { token } = await res.json();
  assert.ok(token, "registry returned a token");
  return token;
}

async function fetchManifest(ref, token) {
  const res = await fetch(`${REGISTRY}/v2/${IMAGE}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
  assert.ok(res.ok, `manifest ${ref} HTTP ${res.status}`);
  return res.json();
}

test("resolves real per-arch sizes for a multi-arch tag", async () => {
  const arches = await withRetry(async () => {
    const token = await getToken();
    const top = await fetchManifest(TAG, token);
    assert.ok(Array.isArray(top.manifests), "beta is a multi-arch index");
    return GHCR.computeArches(top, (d) => fetchManifest(d, token));
  });

  const labels = arches.map((a) => a.label);
  assert.ok(labels.includes("amd64"), `has amd64 (got ${labels.join(", ")})`);
  assert.ok(labels.includes("arm64"), `has arm64 (got ${labels.join(", ")})`);

  const amd64 = arches.find((a) => a.label === "amd64");
  const mb = amd64.bytes / 1024 / 1024;
  // ~100 MB; assert a generous band so a legit re-push doesn't flake the test.
  assert.ok(mb > 50 && mb < 200, `amd64 layer total ${mb.toFixed(1)} MB in range`);
  for (const a of arches) assert.ok(a.bytes > 0, `${a.label} has non-zero size`);
});
