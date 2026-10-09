// All ghcr.io requests live here because ghcr.io sends no CORS headers: a fetch from
// the github.com page origin would be blocked, but a background fetch backed by the
// "https://ghcr.io/*" host permission bypasses CORS.
//
// Auth never needs a PAT. Public images use ghcr.io's anonymous pull token. ghcr.io
// sets no cookies and ignores the github.com session, so private images need a GitHub
// token: the user clicks "sign in" on a badge once, approves this extension through
// GitHub's OAuth device flow (on github.com, where they're already logged in), and the
// resulting read:packages token is kept in storage.local.

import { OAUTH_CLIENT_ID, computeArches } from "./lib.ts";
import type { DeviceCode, ExtApi, Manifest, SignInPoll, SizeResult } from "./types.ts";

const api: ExtApi | undefined = globalThis.browser ?? globalThis.chrome;
if (!api) throw new Error("No WebExtension runtime API available");
const ext = api;

const REGISTRY = "https://ghcr.io";

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
].join(", ");

interface RegistryToken {
  token: string;
  /** Minted with the signed-in GitHub identity (the anonymous token was refused). */
  authed: boolean;
}

interface CachedToken extends RegistryToken {
  expiresAt: number;
}

interface GitHubAuth {
  login: string;
  token: string;
}

// image -> token (bearer tokens are short-lived, ~5 min)
const tokenCache = new Map<string, CachedToken>();
// `${image}@${digest}` -> result (digests are immutable, cache forever)
const sizeCache = new Map<string, SizeResult>();

/**
 * Signals that an image needs authentication (surfaced to the UI). `signedIn` means the
 * stored GitHub token was tried and still can't read it — typically the OAuth app
 * wasn't granted access to the image's organization.
 */
class AuthError extends Error {
  constructor(message: string, readonly signedIn = false) {
    super(message);
  }
}

async function loadAuth(): Promise<GitHubAuth | null> {
  const { githubAuth } = await ext.storage.local.get("githubAuth");
  return (githubAuth as GitHubAuth | undefined) ?? null;
}

/** GET the registry token endpoint, optionally with GitHub credentials. */
function requestToken(image: string, auth: GitHubAuth | null): Promise<Response> {
  const url = `${REGISTRY}/token?scope=repository:${image}:pull&service=ghcr.io`;
  const headers: Record<string, string> = auth
    ? { Authorization: `Basic ${btoa(`${auth.login}:${auth.token}`)}` }
    : {};
  return fetch(url, { headers });
}

/**
 * Obtain a bearer pull-token for `image` (`owner/name`), cached per image. Tries
 * anonymously first (public images), then with the signed-in GitHub token.
 */
async function getToken(image: string): Promise<RegistryToken> {
  const cached = tokenCache.get(image);
  if (cached && cached.expiresAt > Date.now()) return cached;

  let authed = false;
  let res = await requestToken(image, null);
  if (res.status === 401 || res.status === 403) {
    const auth = await loadAuth();
    if (!auth) throw new AuthError(`Auth required for ${image} (HTTP ${res.status})`);
    authed = true;
    res = await requestToken(image, auth);
    if (!res.ok) throw new AuthError(`GitHub token can't read ${image} (HTTP ${res.status})`, true);
  }
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status})`);

  const data = (await res.json()) as { token?: string; access_token?: string; expires_in?: number };
  const token = data.token ?? data.access_token;
  if (!token) throw new Error("No token in registry response");

  // Respect expires_in when present; default to 5 minutes, refresh 30s early.
  const ttl = (data.expires_in ?? 300) * 1000;
  const entry = { token, authed, expiresAt: Date.now() + ttl - 30_000 };
  tokenCache.set(image, entry);
  return entry;
}

/** POST a form to github.com's OAuth endpoints and parse the JSON reply. */
async function postGitHub(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://github.com${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`GitHub ${path} failed (HTTP ${res.status})`);
  return (await res.json()) as Record<string, unknown>;
}

/** Begin the OAuth device flow: get a user code for the user to approve on github.com. */
async function signInStart(): Promise<DeviceCode> {
  const data = await postGitHub("/login/device/code", {
    client_id: OAUTH_CLIENT_ID,
    scope: "read:packages",
  });
  if (typeof data.device_code !== "string") {
    throw new Error(String(data.error_description ?? data.error ?? "No device code from GitHub"));
  }
  return {
    deviceCode: data.device_code,
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri),
    interval: Number(data.interval ?? 5),
    expiresIn: Number(data.expires_in ?? 900),
  };
}

/**
 * Poll once for the device-flow token. Driven by the content script (one message per
 * poll) so a Chrome service worker is never left idling mid-flow.
 */
async function signInPoll(deviceCode: string): Promise<SignInPoll> {
  const data = await postGitHub("/login/oauth/access_token", {
    client_id: OAUTH_CLIENT_ID,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  if (data.error === "authorization_pending") return { status: "pending", interval: 0 };
  if (data.error === "slow_down") return { status: "pending", interval: Number(data.interval ?? 10) };
  if (typeof data.access_token !== "string") {
    return { status: "failed", error: String(data.error_description ?? data.error ?? "Sign-in failed") };
  }

  // ghcr.io's token endpoint takes Basic <login>:<token>, so remember the login too.
  const token = data.access_token;
  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!userRes.ok) return { status: "failed", error: `GitHub /user failed (HTTP ${userRes.status})` };
  const { login } = (await userRes.json()) as { login: string };

  await ext.storage.local.set({ githubAuth: { login, token } satisfies GitHubAuth });
  // Drop anonymous pull tokens so private images are retried with the new identity.
  tokenCache.clear();
  return { status: "done" };
}

/** GET a manifest (or index) by tag/digest and return the parsed JSON. */
async function fetchManifest(image: string, ref: string, { token, authed }: RegistryToken): Promise<Manifest> {
  const res = await fetch(`${REGISTRY}/v2/${image}/manifests/${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: MANIFEST_ACCEPT },
  });
  // ghcr.io answers 404 rather than 403 when a signed-in identity lacks access.
  if (res.status === 401 || res.status === 403 || (authed && res.status === 404)) {
    // Don't reuse this pull token: access may be granted on GitHub at any moment.
    tokenCache.delete(image);
    throw new AuthError(`Not authorized to read ${image} (HTTP ${res.status})`, authed);
  }
  if (!res.ok) throw new Error(`Manifest ${ref} failed (HTTP ${res.status})`);
  return (await res.json()) as Manifest;
}

/** Resolve the per-architecture layer sizes for `image@digest`. */
async function resolveSizes(image: string, digest: string): Promise<SizeResult> {
  const cacheKey = `${image}@${digest}`;
  const hit = sizeCache.get(cacheKey);
  if (hit) return hit;

  const token = await getToken(image);
  const top = await fetchManifest(image, digest, token);
  const arches = await computeArches(top, (d) => fetchManifest(image, d, token));

  const result: SizeResult = { arches };
  sizeCache.set(cacheKey, result);
  return result;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// sendResponse + `return true` is the one pattern that works in both Firefox and
// Chrome (Chrome ignores a promise returned from the listener).
ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  switch (msg.type) {
    case "getSize":
      resolveSizes(msg.image, msg.digest)
        .then(sendResponse)
        .catch((err: unknown) =>
          sendResponse(
            err instanceof AuthError
              ? { needsAuth: true, signedIn: err.signedIn, error: err.message }
              : { error: errorMessage(err) }
          )
        );
      return true;
    case "signInStart":
      signInStart()
        .then(sendResponse)
        .catch((err: unknown) => sendResponse({ error: errorMessage(err) }));
      return true;
    case "signInPoll":
      signInPoll(msg.deviceCode)
        .then(sendResponse)
        .catch((err: unknown) => sendResponse({ status: "failed", error: errorMessage(err) }));
      return true;
  }
});
