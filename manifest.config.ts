// Single source of truth for both browsers' manifests. vite.config.ts feeds this to
// vite-plugin-web-extension (which bundles the referenced src/*.ts entries), and the
// manifest unit test asserts both shapes. The only real per-browser difference is the
// MV3 background: Firefox uses an event-page `scripts` array, Chrome a `service_worker`.

import { readFileSync } from "node:fs";

export type Target = "firefox" | "chrome";

// AMO rejects re-used versions, so CI stamps a unique EXT_VERSION per build
// (`<pkg.version>.<run_number>`); locally we fall back to package.json.
const { version: pkgVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };
const version = process.env.EXT_VERSION ?? pkgVersion;

export function generateManifest(target: Target): Record<string, unknown> {
  const base = {
    manifest_version: 3,
    name: "GHCR Tag Sizes",
    version,
    description:
      "Shows the total layer size (per architecture) of each tag on GitHub Container Registry package pages.",
    host_permissions: ["https://ghcr.io/*"],
    content_scripts: [
      {
        matches: [
          "https://github.com/orgs/*/packages/container/*",
          "https://github.com/users/*/packages/container/*",
          "https://github.com/*/*/pkgs/container/*",
        ],
        js: ["src/content.ts"],
        css: ["src/content.css"],
        run_at: "document_idle",
      },
    ],
    icons: { 48: "icons/icon-48.png", 96: "icons/icon-96.png" },
    action: { default_title: "GHCR Tag Sizes" },
  };

  if (target === "firefox") {
    return {
      ...base,
      background: { scripts: ["src/background.ts"] },
      browser_specific_settings: {
        gecko: {
          id: "ghcr-tag-sizes@mcswain.dev",
          strict_min_version: "140.0",
          data_collection_permissions: { required: ["none"] },
        },
      },
    };
  }

  return {
    ...base,
    minimum_chrome_version: "111",
    background: { service_worker: "src/background.ts" },
  };
}
