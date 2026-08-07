# GHCR Tag Sizes

A **Firefox and Chrome** extension that shows the **total layer size of each version**
on GitHub Container Registry package pages. For multi-arch tags it lists **every
architecture's size** inline (e.g. `📦 amd64 100 MB · arm64 98 MB`).

The number is the sum of the compressed layer blob sizes — i.e. the `docker pull`
download size — read straight from the OCI image manifest.

## How it works

- Runs on `github.com/{orgs,users}/*/packages/container/*` pages (overview and
  `…/versions`), covering both **tagged and untagged** versions.
- For each version row it reads the **digest** already present in the page markup —
  from the tag's copy button, or (on untagged rows) the digest link text — and asks
  the background script to resolve its size. Untagged rows may be a multi-arch index
  (shown per-arch) or a single platform manifest (one size).
- The **background script** talks to `ghcr.io`: anonymous pull token → image index →
  each per-architecture sub-manifest → sum `layers[].size`. Results are cached by
  immutable digest.
- Network lives in the background because `ghcr.io` sends no CORS headers; the
  `https://ghcr.io/*` host permission lets the background fetch bypass CORS.
- **No PAT, ever.** Requests use `credentials: "include"`, so any ghcr.io session the
  browser already holds from your GitHub login is used automatically — public images
  just work, private images you can access resolve on your existing session, and
  anything else shows `🔒 sign in to view size`.
- Attestation/provenance entries (platform `unknown`) are skipped.

## Project layout

Most of the code is shared across both browsers; only the manifest's background
declaration and a namespace shim differ.

| File | Purpose |
| --- | --- |
| `lib.js` | Shared pure/DOM helpers (size math, platform labels, digest extraction). Loaded in both browsers **and** required by the tests. |
| `background.js` | Token + manifest fetch, per-arch size compute, digest cache. Cross-browser (`browser`/`chrome` shim; Chrome pulls in `lib.js` via `importScripts`). |
| `content.js` | Scans version rows, injects the size badge, handles Turbo navigation. |
| `content.css` | Badge styling (theme-aware). |
| `manifest.json` | **Firefox** MV3 manifest (event-page `background.scripts`). |
| `manifest.chrome.json` | **Chrome** MV3 manifest (`background.service_worker`). |
| `build.mjs` | Assembles `dist/<target>/` + zips to `artifacts/`. |
| `test/` | Unit, DOM-contract, live-registry, and e2e tests. |

## Develop

```sh
npm install

# Live dev loop with auto-reload (edit a file, watch it reload):
npm run dev:firefox     # web-ext run, real Firefox
npm run dev:chrome      # web-ext run --target chromium, real Chrome
```

Or load manually after `npm run build:dirs`:

- **Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
  `dist/firefox/manifest.json`. Debug the background via *Inspect*; content-script
  logs appear in the **page's** DevTools.
- **Chrome** — `chrome://extensions` → enable *Developer mode* → *Load unpacked* →
  `dist/chrome`.

## Test

```sh
npm test          # unit + DOM-contract (offline, deterministic)
npm run test:live # live ghcr.io check (network)
npm run lint      # web-ext lint on the Firefox build
npm run e2e       # full browser e2e, Firefox + Chrome (network; needs both browsers)
```

What each layer catches:

- **Unit** (`test/unit/`) — the pure logic in `lib.js` (size math, label/attestation
  handling, `computeArches` with a mocked fetcher) and both manifests' validity.
- **DOM-contract** (`test/dom/`) — runs the real extraction logic over **saved**
  GitHub HTML (`test/fixtures/`) via jsdom. Guards against *our* regressions
  deterministically. When GitHub changes their markup, refresh the fixtures (below).
- **Live registry** (`test/live/`) — drives the real `ghcr.io` API with the same
  `computeArches` the extension uses. Catches ghcr.io changing auth/manifest format.
- **E2E canary** (`test/e2e/`) — loads the actual built extension into real Firefox
  and Chrome against live GitHub and asserts badges render with real per-arch sizes.
  This is the only full-stack check; it's also the most likely to break on upstream
  changes, so it runs **nightly, not on PRs**.

### Refreshing the DOM fixtures

```sh
curl -sL "https://github.com/orgs/clevyr/packages/container/package/scaffold" \
  -o test/fixtures/tagged-overview.html
curl -sL "https://github.com/orgs/clevyr/packages/container/scaffold/versions?filters%5Bversion_type%5D=untagged" \
  -o test/fixtures/untagged-versions.html
```

## Build / package

```sh
npm run build     # -> artifacts/ghcr-tag-sizes-firefox-<v>.zip
                  #    artifacts/ghcr-tag-sizes-chrome-<v>.zip
```

Upload the Firefox zip to addons.mozilla.org and the Chrome zip to the Chrome Web
Store.

## CI

- **`.github/workflows/ci.yml`** (every push/PR): `web-ext lint`, unit + DOM-contract
  tests, the live-registry check (isolated job), and the dual-target build, uploading
  both zips as artifacts.
- **`.github/workflows/e2e.yml`** (nightly + manual): the Firefox/Chrome browser
  canary. Non-blocking by design — a failure signals "upstream changed", not "this PR
  is broken".

All third-party actions are `actions/*` only and pinned to a full commit SHA.
