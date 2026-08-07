import test from "node:test";
import assert from "node:assert/strict";
import * as GHCR from "../../src/lib.ts";
import type { Manifest } from "../../src/types.ts";

test("formatBytes scales and rounds by unit", () => {
  assert.equal(GHCR.formatBytes(0), "0 B");
  assert.equal(GHCR.formatBytes(512), "512 B");
  assert.equal(GHCR.formatBytes(1024), "1.00 KB");
  assert.equal(GHCR.formatBytes(1536), "1.50 KB");
  assert.equal(GHCR.formatBytes(10 * 1024), "10.0 KB");
  assert.equal(GHCR.formatBytes(150 * 1024), "150 KB");
  assert.equal(GHCR.formatBytes(104834563), "100.0 MB"); // 99.98 MB -> 1-decimal rounds up
  assert.equal(GHCR.formatBytes(250 * 1024 ** 2), "250 MB"); // >=100 -> no decimals
  assert.equal(GHCR.formatBytes(5 * 1024 ** 3), "5.00 GB");
});

test("platformLabel collapses linux and keeps variants/os", () => {
  assert.equal(GHCR.platformLabel({ os: "linux", architecture: "amd64" }), "amd64");
  assert.equal(GHCR.platformLabel({ os: "linux", architecture: "arm", variant: "v7" }), "arm/v7");
  assert.equal(GHCR.platformLabel({ os: "windows", architecture: "amd64" }), "windows/amd64");
  assert.equal(GHCR.platformLabel(null), "image");
});

test("isAttestation flags unknown platforms only", () => {
  assert.equal(GHCR.isAttestation({ digest: "d", platform: { os: "unknown", architecture: "unknown" } }), true);
  assert.equal(GHCR.isAttestation({ digest: "d", platform: { os: "linux", architecture: "amd64" } }), false);
  assert.equal(GHCR.isAttestation({ digest: "d" }), false);
});

test("sumLayers adds compressed layer sizes, ignores config", () => {
  assert.equal(GHCR.sumLayers({ config: { size: 999 }, layers: [{ size: 10 }, { size: 20 }] }), 30);
  assert.equal(GHCR.sumLayers({ layers: [] }), 0);
  assert.equal(GHCR.sumLayers({}), 0);
});

test("parseImagePath handles account-scoped, package/, versions, and casing", () => {
  assert.equal(GHCR.parseImagePath("/users/USA-RedDragon/packages/container/package/alpine"), "usa-reddragon/alpine");
  assert.equal(GHCR.parseImagePath("/orgs/Acme/packages/container/Widget/versions"), "acme/widget");
  assert.equal(GHCR.parseImagePath("/users/octocat/packages/container/package/thing"), "octocat/thing");
  assert.equal(GHCR.parseImagePath("/orgs/acme/packages/container/widget/385518471?tag=beta"), "acme/widget");
  assert.equal(GHCR.parseImagePath("/USA-RedDragon"), null);
});

test("parseImagePath handles repo-scoped /owner/repo/pkgs/container/name (repo dropped)", () => {
  assert.equal(
    GHCR.parseImagePath("/USA-RedDragon/dockers/pkgs/container/alpine"),
    "usa-reddragon/alpine"
  );
  assert.equal(
    GHCR.parseImagePath("/USA-RedDragon/dockers/pkgs/container/alpine/versions"),
    "usa-reddragon/alpine"
  );
});

test("matchDigest finds a sha256 digest anywhere in text", () => {
  const d = "sha256:" + "a".repeat(64);
  assert.equal(GHCR.matchDigest(`Digest ${d} published`), d);
  assert.equal(GHCR.matchDigest("no digest here"), null);
  assert.equal(GHCR.matchDigest(""), null);
});

test("computeArches: multi-arch index sums each platform, skips attestations, sorts", async () => {
  const index: Manifest = {
    manifests: [
      { digest: "sha256:amd", platform: { os: "linux", architecture: "amd64" } },
      { digest: "sha256:arm", platform: { os: "linux", architecture: "arm64" } },
      { digest: "sha256:att", platform: { os: "unknown", architecture: "unknown" } },
    ],
  };
  const subs: Record<string, Manifest> = {
    "sha256:amd": { layers: [{ size: 100 }, { size: 50 }] },
    "sha256:arm": { layers: [{ size: 90 }] },
  };
  const arches = await GHCR.computeArches(index, (d) => Promise.resolve(subs[d]!));
  assert.deepEqual(arches, [
    { label: "amd64", bytes: 150 },
    { label: "arm64", bytes: 90 },
  ]);
});

test("computeArches: single manifest yields one 'image' entry", async () => {
  const manifest: Manifest = { layers: [{ size: 7 }, { size: 3 }] };
  const arches = await GHCR.computeArches(manifest, () => {
    throw new Error("should not fetch sub-manifests");
  });
  assert.deepEqual(arches, [{ label: "image", bytes: 10 }]);
});
