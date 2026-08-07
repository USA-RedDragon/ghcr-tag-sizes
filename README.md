# GHCR Tag Sizes

A **Firefox and Chrome** extension that shows the **total layer size of each version**
on GitHub Container Registry package pages. For multi-arch tags it lists **every
architecture's size** inline (e.g. `📦 amd64 3.67 MB · arm64 3.99 MB`).

The number is the sum of the compressed layer blob sizes — i.e. the `docker pull`
download size — read straight from the OCI image manifest.

## How it works

- Runs on every GitHub container package URL shape:
  - account-scoped `github.com/{orgs,users}/*/packages/container/*` (overview & `…/versions`)
  - repo-scoped `github.com/{owner}/{repo}/pkgs/container/*`
  covering both **tagged and untagged** versions.
- For each version row it reads the **digest** already present in the page markup —
  from the tag's copy button, or (on untagged rows) the digest link text — and asks
  the background to resolve its size. Untagged rows may be a multi-arch index (shown
  per-arch) or a single platform manifest (one size).
- The **background** talks to `ghcr.io`: anonymous pull token → image index → each
  per-architecture sub-manifest → sum `layers[].size`. Results are cached by digest.
- Network lives in the background because `ghcr.io` sends no CORS headers; the
  `https://ghcr.io/*` host permission lets the background fetch bypass CORS.
- **No PAT, ever.** Requests use `credentials: "include"`, so any ghcr.io session the
  browser already holds from your GitHub login is used automatically — public images
  just work, private images you can access resolve on your existing session, and
  anything else shows `🔒 sign in to view size`.
- Attestation/provenance entries (platform `unknown`) are skipped.

## Develop

```sh
npm install

# Live dev loop with auto-reload (edit a .ts file, watch it reload):
npm run dev:firefox     # vite + web-ext, real Firefox
npm run dev:chrome      # vite + web-ext, real Chrome
```

Or load a built dir manually (`npm run build` first):

- **Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
  `dist/firefox/manifest.json`.
- **Chrome** — `chrome://extensions` → *Developer mode* → *Load unpacked* → `dist/chrome`.

## Test

```sh
npm run typecheck # tsc --noEmit
npm test          # unit + DOM-contract (offline, deterministic)
npm run test:live # live ghcr.io check (network)
npm run lint      # web-ext lint on the Firefox build
npm run e2e       # full browser e2e, Firefox + Chrome (network; needs both browsers)
```

What each layer catches:

- **Typecheck** — the whole TypeScript surface.
- **Unit** (`test/unit/`) — the pure logic in `lib.ts`, URL parsing for all page shapes,
  and both generated manifests' validity.
- **DOM-contract** (`test/dom/`) — runs the real extraction logic over **saved** GitHub
  HTML (`test/fixtures/`) via jsdom. Guards against *our* regressions deterministically.
  When GitHub changes their markup, refresh the fixtures (below).
- **Live registry** (`test/live/`) — drives the real `ghcr.io` API with the same
  `computeArches` the extension uses. Catches ghcr.io changing auth/manifest format.
- **E2E canary** (`test/e2e/`) — loads the actual built extension into real Firefox and
  Chrome against live GitHub and asserts badges render with real per-arch sizes. The
  only full-stack check; most likely to break on upstream changes, so it runs
  **nightly, not on PRs**.

### Refreshing the DOM fixtures

```sh
BASE="https://github.com/USA-RedDragon/dockers/pkgs/container/alpine"
curl -sL "$BASE" -o test/fixtures/tagged-overview.html
curl -sL "$BASE/versions?filters%5Bversion_type%5D=untagged" -o test/fixtures/untagged-versions.html
```

## Build / package

```sh
npm run build     # dist/firefox/ + dist/chrome/ (unpacked)
npm run package   # + artifacts/ghcr-tag-sizes-firefox.zip / -chrome.zip
```

Upload the Firefox zip to addons.mozilla.org and the Chrome zip to the Chrome Web Store.
