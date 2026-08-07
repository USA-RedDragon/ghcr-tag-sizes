// Dual-target build: assembles dist/<target>/ from the shared sources plus that
// target's manifest (renamed to manifest.json), then zips it into artifacts/.
//
//   node build.mjs                 build firefox + chrome (with zips)
//   node build.mjs firefox         build one target
//   node build.mjs --no-zip        assemble dist dirs only (used by e2e / web-ext run)
//
// No dependencies — just fs + the system `zip`.

import { cp, rm, mkdir, copyFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const SHARED = ["lib.js", "background.js", "content.js", "content.css", "icons"];
const MANIFESTS = { firefox: "manifest.json", chrome: "manifest.chrome.json" };

const argv = process.argv.slice(2);
const noZip = argv.includes("--no-zip");
const requested = argv.filter((a) => !a.startsWith("--"));
const targets = requested.length ? requested : Object.keys(MANIFESTS);

for (const target of targets) {
  const manifest = MANIFESTS[target];
  if (!manifest) {
    console.error(`Unknown target "${target}" (expected: ${Object.keys(MANIFESTS).join(", ")})`);
    process.exit(1);
  }

  const distDir = path.join(ROOT, "dist", target);
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });

  for (const item of SHARED) {
    await cp(path.join(ROOT, item), path.join(distDir, item), { recursive: true });
  }
  await copyFile(path.join(ROOT, manifest), path.join(distDir, "manifest.json"));

  const { version } = JSON.parse(await readFile(path.join(distDir, "manifest.json"), "utf8"));
  console.log(`assembled dist/${target} (v${version})`);

  if (!noZip) {
    const artifactsDir = path.join(ROOT, "artifacts");
    await mkdir(artifactsDir, { recursive: true });
    const zipPath = path.join(artifactsDir, `ghcr-tag-sizes-${target}-${version}.zip`);
    await rm(zipPath, { force: true });
    // Zip from inside distDir so paths are relative to the extension root.
    // -X strips extra file attributes for reproducibility.
    execFileSync("zip", ["-r", "-X", zipPath, "."], { cwd: distDir, stdio: "inherit" });
    console.log(`packed ${path.relative(ROOT, zipPath)}`);
  }
}
