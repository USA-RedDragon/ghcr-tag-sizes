// Scans GitHub container package pages, reads each version's digest from the
// server-rendered markup, asks the background for its per-architecture layer sizes,
// and injects a badge beneath the tag pills. All network happens in the background
// (ghcr.io sends no CORS headers). Private images get a "sign in" button that runs
// GitHub's OAuth device flow, then every such badge is re-measured.

import { extractDigest, formatBytes, parseImagePath } from "./lib.ts";
import type { ExtApi, SizeResult } from "./types.ts";

const api: ExtApi | undefined = globalThis.browser ?? globalThis.chrome;
if (!api) throw new Error("No WebExtension runtime API available");
const ext = api;

function makeBadge(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "ghcr-size-badge";
  el.textContent = "measuring…";
  el.setAttribute("aria-busy", "true");
  return el;
}

function renderResult(badge: HTMLElement, result: SizeResult): void {
  badge.removeAttribute("aria-busy");
  badge.classList.remove("ghcr-size-badge--error");

  if (result.needsAuth) {
    badge.classList.add("ghcr-size-badge--error", "ghcr-size-badge--auth");
    renderSignIn(badge);
    return;
  }
  if (result.error || !result.arches || !result.arches.length) {
    badge.classList.add("ghcr-size-badge--error");
    badge.textContent = "📦 size unavailable";
    badge.title = result.error ?? "Could not read this image.";
    return;
  }

  const arches = result.arches;
  badge.textContent = "";
  const icon = document.createElement("span");
  icon.textContent = "📦 ";
  icon.setAttribute("aria-hidden", "true");
  badge.appendChild(icon);

  const multi = arches.length > 1;
  arches.forEach((a, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "ghcr-size-sep";
      sep.textContent = " · ";
      badge.appendChild(sep);
    }
    const part = document.createElement("span");
    part.className = "ghcr-size-part";
    if (multi) {
      const label = document.createElement("span");
      label.className = "ghcr-size-arch";
      label.textContent = a.label + " ";
      part.appendChild(label);
    }
    const val = document.createElement("span");
    val.className = "ghcr-size-value";
    val.textContent = formatBytes(a.bytes);
    part.appendChild(val);
    badge.appendChild(part);
  });

  const total = arches.reduce((s, a) => s + a.bytes, 0);
  badge.title = multi
    ? "Total layer size per architecture (compressed download size).\n" +
      arches.map((a) => `${a.label}: ${formatBytes(a.bytes)}`).join("\n")
    : `Total layer size (compressed download size): ${formatBytes(total)}`;
}

const AUTH_BADGES = ".ghcr-size-badge--auth";
let signingIn = false;

/** Put a "sign in" button in a private-image badge. */
function renderSignIn(badge: HTMLElement, note?: string): void {
  badge.textContent = "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ghcr-size-signin";
  btn.textContent = "🔒 sign in to view size";
  btn.title = "Private package — authorize GHCR Tag Sizes on GitHub (read:packages) to see sizes.";
  btn.addEventListener("click", () => void signIn());
  badge.appendChild(btn);
  if (note) badge.append(` — ${note}`);
}

function eachAuthBadge(fn: (badge: HTMLElement) => void): void {
  document.querySelectorAll<HTMLElement>(AUTH_BADGES).forEach(fn);
}

/** Show the device-flow user code (with a link to enter it) in every private badge. */
function renderUserCode(badge: HTMLElement, userCode: string, verificationUri: string): void {
  badge.textContent = "🔒 enter code ";
  const code = document.createElement("strong");
  code.className = "ghcr-size-code";
  code.textContent = userCode;
  badge.appendChild(code);
  badge.append(" at ");
  const link = document.createElement("a");
  link.href = verificationUri;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = verificationUri.replace(/^https:\/\//, "");
  badge.appendChild(link);
  badge.append(" (copied)");
}

const sleep = (s: number): Promise<void> => new Promise((r) => setTimeout(r, s * 1000));

/** Run the OAuth device flow, then re-measure every private badge on the page. */
async function signIn(): Promise<void> {
  if (signingIn) return;
  signingIn = true;
  try {
    const start = await ext.runtime.sendMessage({ type: "signInStart" });
    if ("error" in start) {
      eachAuthBadge((b) => renderSignIn(b, start.error));
      return;
    }

    // Still inside the click's user activation, so the popup and clipboard are allowed.
    void navigator.clipboard?.writeText(start.userCode).catch(() => {});
    window.open(start.verificationUri, "_blank", "noopener");
    eachAuthBadge((b) => renderUserCode(b, start.userCode, start.verificationUri));

    let interval = start.interval;
    const deadline = Date.now() + start.expiresIn * 1000;
    while (Date.now() < deadline) {
      await sleep(interval);
      const poll = await ext.runtime.sendMessage({ type: "signInPoll", deviceCode: start.deviceCode });
      if (poll.status === "pending") {
        interval = poll.interval || interval;
        continue;
      }
      if (poll.status === "failed") {
        eachAuthBadge((b) => renderSignIn(b, poll.error));
        return;
      }
      // Signed in: drop the private badges and let scan() measure those rows again.
      eachAuthBadge((b) => {
        const row = b.closest<HTMLElement>("li.Box-row");
        if (row) delete row.dataset.ghcrSized;
        b.remove();
      });
      scan();
      return;
    }
    eachAuthBadge((b) => renderSignIn(b, "code expired"));
  } catch (err: unknown) {
    eachAuthBadge((b) => renderSignIn(b, err instanceof Error ? err.message : String(err)));
  } finally {
    signingIn = false;
  }
}

/** Find the insertion point within a version row and attach the badge. */
function attachBadge(row: Element, badge: HTMLElement): void {
  // Prefer to sit directly under the tag-pill (or digest-link) row.
  const tagRow = row.querySelector(".d-inline-flex.flex-wrap");
  if (tagRow && tagRow.parentNode) {
    tagRow.insertAdjacentElement("afterend", badge);
  } else {
    row.appendChild(badge);
  }
}

function scan(): void {
  const image = parseImagePath(location.pathname);
  if (!image) return;

  const rows = document.querySelectorAll<HTMLElement>("li.Box-row");
  rows.forEach((row) => {
    if (row.dataset.ghcrSized) return;

    const digest = extractDigest(row);
    if (!digest) return; // no digest surfaced on this row — skip

    row.dataset.ghcrSized = "1";
    const badge = makeBadge();
    attachBadge(row, badge);

    ext.runtime
      .sendMessage({ type: "getSize", image, digest })
      .then((result) => renderResult(badge, result))
      .catch((err: unknown) =>
        renderResult(badge, { error: err instanceof Error ? err.message : String(err) })
      );
  });
}

// Debounce scans triggered by rapid DOM mutations.
let pending: ReturnType<typeof setTimeout> | null = null;
function scheduleScan(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    scan();
  }, 100);
}

// Initial + Turbo/SPA navigations (GitHub navigates without full reloads).
scheduleScan();
document.addEventListener("turbo:load", scheduleScan);
document.addEventListener("turbo:render", scheduleScan);
document.addEventListener("pjax:end", scheduleScan);

// Fallback: catch rows added by pagination / late render.
const observer = new MutationObserver((mutations) => {
  for (const mut of mutations) {
    for (const node of mut.addedNodes) {
      if (node.nodeType !== 1) continue;
      const el = node as Element;
      if (el.matches?.("li.Box-row") || el.querySelector?.("li.Box-row")) {
        scheduleScan();
        return;
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
