// GHCR Tag Sizes — content script.
//
// Scans GitHub container package pages, reads each version's index digest from the
// server-rendered markup, asks the background script for its per-architecture layer
// sizes, and injects a badge beneath the tag pills. All network happens in the
// background script (ghcr.io sends no CORS headers).

(() => {
  "use strict";

  /** Derive the ghcr.io image path (`owner/name`) from the current URL. */
  function currentImage() {
    // /orgs|users/<owner>/packages/container/[package/]<name>[/...]
    const m = location.pathname.match(
      /\/(?:orgs|users)\/([^/]+)\/packages\/container\/(?:package\/)?([^/?#]+)/
    );
    if (!m) return null;
    return `${m[1]}/${m[2]}`.toLowerCase();
  }

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

  /**
   * Extract the image digest from a version row.
   * Tagged rows expose it on the copy button; untagged rows show it as the row's
   * link text (the href there is the numeric version id, not the digest).
   */
  function extractDigest(row) {
    const copy = row.querySelector('clipboard-copy[value^="sha256:"]');
    if (copy) return copy.getAttribute("value");
    const m = (row.textContent || "").match(/sha256:[0-9a-f]{64}/);
    return m ? m[0] : null;
  }

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
      val.textContent = formatBytes(a.bytes);
      part.appendChild(val);
      badge.appendChild(part);
    });

    const total = result.arches.reduce((s, a) => s + a.bytes, 0);
    badge.title = multi
      ? `Total layer size per architecture (compressed download size).\n` +
        result.arches.map((a) => `${a.label}: ${formatBytes(a.bytes)}`).join("\n")
      : `Total layer size (compressed download size): ${formatBytes(total)}`;
  }

  /** Find the insertion point within a version row and attach the badge. */
  function attachBadge(row, badge) {
    // Prefer to sit directly under the tag-pill row.
    const tagRow = row.querySelector(".d-inline-flex.flex-wrap");
    if (tagRow && tagRow.parentNode) {
      tagRow.insertAdjacentElement("afterend", badge);
    } else {
      row.appendChild(badge);
    }
  }

  function scan() {
    const image = currentImage();
    if (!image) return;

    const rows = document.querySelectorAll("li.Box-row");
    rows.forEach((row) => {
      if (row.dataset.ghcrSized) return;

      const digest = extractDigest(row);
      if (!digest) return; // no digest surfaced on this row — skip

      row.dataset.ghcrSized = "1";
      const badge = makeBadge();
      attachBadge(row, badge);

      browser.runtime
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
