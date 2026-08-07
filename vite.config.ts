import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import { generateManifest, type Target } from "./manifest.config.ts";

// Build one browser per invocation: `TARGET=chrome vite build` (defaults to firefox).
// vite-plugin-web-extension bundles the src/*.ts entries referenced by the manifest,
// copies assets, rewrites the manifest, and (in `vite` dev) launches the browser with
// auto-reload via web-ext.
const target = (process.env.TARGET as Target) ?? "firefox";

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
      },
    }),
  ],
});
