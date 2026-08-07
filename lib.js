// GHCR Tag Sizes — shared helpers.
//
// Loaded as a classic script in both extension contexts (Firefox event page &
// content scripts via the manifest's script arrays; Chrome's service worker via
// importScripts) and required directly by the Node test suite. UMD-style so it
// exposes `GHCR` on the global and `module.exports` under Node.

(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.GHCR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DIGEST_RE = /sha256:[0-9a-f]{64}/;

  /** bytes -> "12.3 MB" (base 1024). */
  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    const decimals = n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2;
    return `${n.toFixed(decimals)} ${units[i]}`;
  }

  /** Human label for a platform block, e.g. "amd64", "arm/v7", "windows/amd64". */
  function platformLabel(platform) {
    if (!platform) return "image";
    const { os, architecture, variant } = platform;
    const arch = variant ? `${architecture}/${variant}` : architecture;
    return os && os !== "linux" ? `${os}/${arch}` : arch;
  }

  /** Attestation / provenance entries carry an "unknown" platform — not a real arch. */
  function isAttestation(entry) {
    const p = (entry && entry.platform) || {};
    return p.os === "unknown" || p.architecture === "unknown";
  }

  /** Sum the compressed layer sizes of a single-platform manifest. */
  function sumLayers(manifest) {
    const layers = (manifest && manifest.layers) || [];
    return layers.reduce((total, l) => total + (l.size || 0), 0);
  }

  /**
   * Resolve per-architecture layer sizes from an already-fetched top manifest.
   * `getManifest(digest)` returns a sub-manifest (injected so this stays pure &
   * unit-testable). Returns a label-sorted [{ label, bytes }].
   */
  async function computeArches(top, getManifest) {
    let arches;
    if (top && Array.isArray(top.manifests)) {
      const real = top.manifests.filter((e) => !isAttestation(e));
      arches = await Promise.all(
        real.map(async (entry) => ({
          label: platformLabel(entry.platform),
          bytes: sumLayers(await getManifest(entry.digest)),
        }))
      );
    } else {
      arches = [{ label: "image", bytes: sumLayers(top) }];
    }
    arches.sort((a, b) => a.label.localeCompare(b.label));
    return arches;
  }

  /** Derive the ghcr.io image path (`owner/name`, lowercased) from a URL path. */
  function parseImagePath(pathname) {
    const m = pathname.match(
      /\/(?:orgs|users)\/([^/]+)\/packages\/container\/(?:package\/)?([^/?#]+)/
    );
    return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
  }

  /** First `sha256:<64 hex>` in a string, or null. */
  function matchDigest(text) {
    const m = (text || "").match(DIGEST_RE);
    return m ? m[0] : null;
  }

  /**
   * Extract the image digest from a version row element.
   * Tagged rows expose it on the copy button; untagged rows show it as the row's
   * link text (whose href is the numeric version id, not the digest). Uses only
   * standard DOM element methods, so it also runs under jsdom.
   */
  function extractDigest(row) {
    const copy = row.querySelector('clipboard-copy[value^="sha256:"]');
    if (copy) return copy.getAttribute("value");
    return matchDigest(row.textContent);
  }

  return {
    formatBytes,
    platformLabel,
    isAttestation,
    sumLayers,
    computeArches,
    parseImagePath,
    matchDigest,
    extractDigest,
  };
});
