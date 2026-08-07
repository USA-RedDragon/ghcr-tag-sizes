// Live integration against the real ghcr.io registry — the check unit tests cannot
// be: it catches ghcr.io changing its auth flow or manifest format. It drives the
// SAME algorithm the extension uses (lib.ts computeArches) over a real anonymous
// token + real manifests. Requires network.

import test from "node:test";
import assert from "node:assert/strict";
import * as GHCR from "../../src/lib.ts";
import type { Manifest } from "../../src/types.ts";

const REGISTRY = "https://ghcr.io";
const IMAGE = "usa-reddragon/alpine";
const TAG = "latest";
const ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
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

async function getToken(): Promise<string> {
  const res = await fetch(`${REGISTRY}/token?scope=repository:${IMAGE}:pull&service=ghcr.io`);
  assert.ok(res.ok, `token HTTP ${res.status}`);
  const { token } = (await res.json()) as { token?: string };
  assert.ok(token, "registry returned a token");
  return token;
}

async function fetchManifest(ref: string, token: string): Promise<Manifest> {
  const res = await fetch(`${REGISTRY}/v2/${IMAGE}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
  });
  assert.ok(res.ok, `manifest ${ref} HTTP ${res.status}`);
  return (await res.json()) as Manifest;
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

  const amd64 = arches.find((a) => a.label === "amd64")!;
  const mb = amd64.bytes / 1024 / 1024;
  // alpine is tiny (~3-4 MB); generous band tolerates legit re-pushes.
  assert.ok(mb > 1 && mb < 50, `amd64 layer total ${mb.toFixed(1)} MB in range`);
  for (const a of arches) assert.ok(a.bytes > 0, `${a.label} has non-zero size`);
});
