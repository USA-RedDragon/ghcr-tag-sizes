import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import { statSync } from "node:fs";
import { generateManifest, type Target } from "./manifest.config.ts";

// Build one browser per invocation: `TARGET=chrome vite build` (defaults to firefox).
// vite-plugin-web-extension bundles the src/*.ts entries referenced by the manifest,
// copies assets, rewrites the manifest, and (in `vite` dev) launches the browser with
// auto-reload via web-ext.
const target = (process.env.TARGET as Target) ?? "firefox";
const chromiumBinary = target === "chrome" ? resolveChromiumBinary() : undefined;

// web-ext's chrome-launcher greedily picks `google-chrome-stable`, which on some
// systems is a broken/0-byte binary — it "launches", exits instantly, and the CDP
// pipe dies with an unhandled EPIPE/ECONNRESET. Resolve a browser that actually exists
// and is non-empty (or honor an explicit override), instead of disabling launch.
function resolveChromiumBinary(): string | undefined {
  if (process.env.CHROMIUM_BINARY) return process.env.CHROMIUM_BINARY;
  const candidates = [
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
  ];
  for (const p of candidates) {
    try {
      if (statSync(p).size > 0) return p;
    } catch {
      /* not present — try next */
    }
  }
  return undefined; // let web-ext auto-detect (e.g. CI's Chrome-for-Testing)
}

export default defineConfig({
  build: {
    outDir: `dist/${target}`,
    emptyOutDir: true,
  },
  plugins: [
    webExtension({
      manifest: () => generateManifest(target),
      browser: target,
      webExtConfig: {
        target: [target === "chrome" ? "chromium" : "firefox-desktop"],
        startUrl: ["https://github.com/USA-RedDragon/dockers/pkgs/container/alpine"],
        ...(chromiumBinary ? { chromiumBinary } : {}),
      },
    }),
  ],
});
