# GHCR Tag Sizes

A Firefox extension that shows the **total layer size of each tag** on GitHub
Container Registry package pages. For multi-arch tags it lists **every
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
- The **background script** talks to `ghcr.io`: it gets an anonymous pull token,
  fetches the image index, then fetches each per-architecture sub-manifest and sums
  `layers[].size`. Results are cached by immutable digest.
- Network must live in the background script because `ghcr.io` sends no CORS headers;
  the `https://ghcr.io/*` host permission lets the background fetch bypass CORS.
- **No PAT, ever.** Requests are sent with `credentials: "include"`, so any ghcr.io
  session the browser already holds from your GitHub login is used automatically —
  public images just work, and private images you can already access resolve on your
  existing session. Images your session can't read show a `🔒 sign in to view size`
  note.
- Attestation/provenance entries (platform `unknown`) are skipped.

## Install (temporary, for development)

1. Open `about:debugging#/runtime/this-firefox` in Firefox.
2. Click **Load Temporary Add-on…** and select `manifest.json` from this folder.
3. Visit a container package page, e.g.
   `https://github.com/orgs/clevyr/packages/container/package/scaffold`.

Temporary add-ons are removed when Firefox restarts.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Firefox MV3 manifest (host permission for `ghcr.io`) |
| `background.js` | Token + manifest fetch, per-arch size compute, digest cache |
| `content.js` | Scans version rows, injects the size badge, handles Turbo navigation |
| `content.css` | Badge styling (theme-aware) |
| `icons/` | Extension icons |

## Packaging (optional)

Plain JS, no build step. To lint/package for addons.mozilla.org:

```sh
npx web-ext lint
npx web-ext build
```
