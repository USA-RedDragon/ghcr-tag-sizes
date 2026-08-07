// Scans GitHub container package pages, reads each version's digest from the
// server-rendered markup, asks the background for its per-architecture layer sizes,
// and injects a badge beneath the tag pills. All network happens in the background
// (ghcr.io sends no CORS headers).

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
    badge.classList.add("ghcr-size-badge--error");
    badge.textContent = "🔒 sign in to view size";
    badge.title = "This package is private — sign in to GitHub to see its size.";
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
