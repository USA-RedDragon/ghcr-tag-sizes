// GHCR Tag Sizes — content script.
//
// Scans GitHub container package pages, reads each version's digest from the
// server-rendered markup, asks the background script for its per-architecture layer
// sizes, and injects a badge beneath the tag pills. All network happens in the
// background script (ghcr.io sends no CORS headers). Shared helpers come from lib.js,
// loaded ahead of this file in the manifest's content-script array.

(() => {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  function makeBadge() {
    const el = document.createElement("div");
    el.className = "ghcr-size-badge";
    el.textContent = "measuring…";
    el.setAttribute("aria-busy", "true");
    return el;
  }

  function renderResult(badge, result) {
    badge.removeAttribute("aria-busy");
    badge.classList.remove("ghcr-size-badge--error");

    if (result && result.needsAuth) {
      badge.classList.add("ghcr-size-badge--error");
      badge.textContent = "🔒 sign in to view size";
      badge.title = "This package is private — sign in to GitHub to see its size.";
      return;
    }
    if (!result || result.error || !result.arches || !result.arches.length) {
      badge.classList.add("ghcr-size-badge--error");
      badge.textContent = "📦 size unavailable";
      badge.title = (result && result.error) || "Could not read this image.";
      return;
    }

    badge.textContent = "";
    const icon = document.createElement("span");
    icon.textContent = "📦 ";
    icon.setAttribute("aria-hidden", "true");
    badge.appendChild(icon);

    const multi = result.arches.length > 1;
    result.arches.forEach((a, idx) => {
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
      val.textContent = GHCR.formatBytes(a.bytes);
      part.appendChild(val);
      badge.appendChild(part);
    });

    const total = result.arches.reduce((s, a) => s + a.bytes, 0);
    badge.title = multi
      ? `Total layer size per architecture (compressed download size).\n` +
        result.arches.map((a) => `${a.label}: ${GHCR.formatBytes(a.bytes)}`).join("\n")
      : `Total layer size (compressed download size): ${GHCR.formatBytes(total)}`;
  }

  /** Find the insertion point within a version row and attach the badge. */
  function attachBadge(row, badge) {
    // Prefer to sit directly under the tag-pill (or digest-link) row.
    const tagRow = row.querySelector(".d-inline-flex.flex-wrap");
    if (tagRow && tagRow.parentNode) {
      tagRow.insertAdjacentElement("afterend", badge);
    } else {
      row.appendChild(badge);
    }
  }

  function scan() {
    const image = GHCR.parseImagePath(location.pathname);
    if (!image) return;

    const rows = document.querySelectorAll("li.Box-row");
    rows.forEach((row) => {
      if (row.dataset.ghcrSized) return;

      const digest = GHCR.extractDigest(row);
      if (!digest) return; // no digest surfaced on this row — skip

      row.dataset.ghcrSized = "1";
      const badge = makeBadge();
      attachBadge(row, badge);

      api.runtime
        .sendMessage({ type: "getSize", image, digest })
        .then((result) => renderResult(badge, result))
        .catch((err) => renderResult(badge, { error: err.message || String(err) }));
    });
  }

  // Debounce scans triggered by rapid DOM mutations.
  let pending = null;
  function scheduleScan() {
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
        if (
          node.nodeType === 1 &&
          (node.matches?.("li.Box-row") || node.querySelector?.("li.Box-row"))
        ) {
          scheduleScan();
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
