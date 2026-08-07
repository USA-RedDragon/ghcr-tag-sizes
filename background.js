// GHCR Tag Sizes — background script (network + size computation).
//
// All ghcr.io requests live here because ghcr.io sends no CORS headers: a fetch
// from the github.com page origin would be blocked, but a background fetch backed
// by the "https://ghcr.io/*" host permission bypasses CORS.
//
// Auth is credential-free: requests are sent with `credentials: "include"`, so any
// ghcr.io session the browser already holds (from the user's GitHub login) is used
// automatically — public images resolve via the anonymous pull token, private images
// the user can access ride on their existing session. No PAT, ever. Images the session
// can't read surface a "sign in required" note.

const REGISTRY = "https://ghcr.io";

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

// image -> { token, expiresAt }   (bearer tokens are short-lived, ~5 min)
const tokenCache = new Map();
// `${image}@${digest}` -> resolved result (digests are immutable, cache forever)
const sizeCache = new Map();

/** Signals that an image needs authentication (surfaced to the UI). */
class AuthError extends Error {}

/**
 * Obtain a bearer pull-token for `image` (`owner/name`), cached per image.
 * Sent credentialed so the browser's existing ghcr.io session (if any) upgrades the
 * token to include private repos the user can access — no PAT required.
 */
async function getToken(image) {
  const cached = tokenCache.get(image);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const url = `${REGISTRY}/token?scope=repository:${image}:pull&service=ghcr.io`;
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`Auth required for ${image} (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status})`);

  const data = await res.json();
  const token = data.token || data.access_token;
  if (!token) throw new Error("No token in registry response");

  // Respect expires_in when present; default to 5 minutes, refresh 30s early.
  const ttl = (data.expires_in ? data.expires_in : 300) * 1000;
  tokenCache.set(image, { token, expiresAt: Date.now() + ttl - 30_000 });
  return token;
}

/** GET a manifest (or index) by tag/digest and return the parsed JSON. */
async function fetchManifest(image, ref, token) {
  const res = await fetch(`${REGISTRY}/v2/${image}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
    credentials: "include",
  });
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`Not authorized to read ${image} (HTTP ${res.status})`);
  }
  if (!res.ok) throw new Error(`Manifest ${ref} failed (HTTP ${res.status})`);
  return res.json();
}

/** Sum the compressed layer sizes of a single-platform manifest. */
function sumLayers(manifest) {
  const layers = manifest.layers || [];
  return layers.reduce((total, l) => total + (l.size || 0), 0);
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
  const p = entry.platform || {};
  return p.os === "unknown" || p.architecture === "unknown";
}

/**
 * Resolve the per-architecture layer sizes for `image@digest`.
 * Returns { arches: [{ label, bytes }] }.
 */
async function resolveSizes(image, digest) {
  const cacheKey = `${image}@${digest}`;
  if (sizeCache.has(cacheKey)) return sizeCache.get(cacheKey);

  const token = await getToken(image);
  const top = await fetchManifest(image, digest, token);

  let arches;
  if (Array.isArray(top.manifests)) {
    // Image index / manifest list -> one sub-manifest per platform.
    const real = top.manifests.filter((e) => !isAttestation(e));
    arches = await Promise.all(
      real.map(async (entry) => {
        const sub = await fetchManifest(image, entry.digest, token);
        return { label: platformLabel(entry.platform), bytes: sumLayers(sub) };
      })
    );
  } else {
    // Single-platform manifest.
    arches = [{ label: "image", bytes: sumLayers(top) }];
  }

  arches.sort((a, b) => a.label.localeCompare(b.label));
  const result = { arches };
  sizeCache.set(cacheKey, result);
  return result;
}

browser.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== "getSize") return;
  return resolveSizes(msg.image, msg.digest).catch((err) => {
    if (err instanceof AuthError) return { needsAuth: true };
    return { error: err.message || String(err) };
  });
});
