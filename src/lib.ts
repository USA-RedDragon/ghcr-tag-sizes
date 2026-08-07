import type { Arch, IndexEntry, Manifest, Platform } from "./types.ts";

const DIGEST_RE = /sha256:[0-9a-f]{64}/;
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** bytes -> "12.3 MB" (base 1024). */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  const decimals = n >= 100 || i === 0 ? 0 : n >= 10 ? 1 : 2;
  return `${n.toFixed(decimals)} ${UNITS[i]}`;
}

/** Human label for a platform block, e.g. "amd64", "arm/v7", "windows/amd64". */
export function platformLabel(platform?: Platform | null): string {
  if (!platform) return "image";
  const { os, architecture, variant } = platform;
  const arch = variant ? `${architecture}/${variant}` : architecture;
  return os && os !== "linux" ? `${os}/${arch}` : `${arch}`;
}

/** Attestation / provenance entries carry an "unknown" platform — not a real arch. */
export function isAttestation(entry: IndexEntry): boolean {
  const p = entry.platform ?? {};
  return p.os === "unknown" || p.architecture === "unknown";
}

/** Sum the compressed layer sizes of a single-platform manifest. */
export function sumLayers(manifest?: Manifest | null): number {
  const layers = manifest?.layers ?? [];
  return layers.reduce((total, l) => total + (l.size ?? 0), 0);
}

/**
 * Resolve per-architecture layer sizes from an already-fetched top manifest.
 * `getManifest(digest)` returns a sub-manifest (injected so this stays pure &
 * unit-testable). Returns a label-sorted array.
 */
export async function computeArches(
  top: Manifest | null,
  getManifest: (digest: string) => Promise<Manifest>
): Promise<Arch[]> {
  let arches: Arch[];
  if (top && Array.isArray(top.manifests)) {
    const real = top.manifests.filter((e) => !isAttestation(e));
    arches = await Promise.all(
      real.map(async (entry) => ({
        label: platformLabel(entry.platform),
        bytes: sumLayers(await getManifest(entry.digest)),
      }))
    );
  } else {
    arches = [{ label: "image", bytes: sumLayers(top) }];
  }
  arches.sort((a, b) => a.label.localeCompare(b.label));
  return arches;
}

/**
 * Derive the ghcr.io image path (`owner/name`, lowercased) from a GitHub package URL.
 * Handles both page shapes:
 *   - account-scoped: /orgs|users/<owner>/packages/container/[package/]<name>
 *   - repo-scoped:    /<owner>/<repo>/pkgs/container/<name>   (repo is not part of the image)
 */
export function parseImagePath(pathname: string): string | null {
  const account = pathname.match(
    /\/(?:orgs|users)\/([^/]+)\/packages\/container\/(?:package\/)?([^/?#]+)/
  );
  if (account) return `${account[1]}/${account[2]}`.toLowerCase();

  const repo = pathname.match(/^\/([^/]+)\/[^/]+\/pkgs\/container\/([^/?#]+)/);
  if (repo) return `${repo[1]}/${repo[2]}`.toLowerCase();

  return null;
}

/** First `sha256:<64 hex>` in a string, or null. */
export function matchDigest(text: string | null | undefined): string | null {
  const m = (text ?? "").match(DIGEST_RE);
  return m ? m[0] : null;
}

/**
 * Extract the image digest from a version row element.
 * Tagged rows expose it on the copy button; untagged rows show it as the row's link
 * text (whose href is the numeric version id, not the digest). Uses only standard DOM
 * element methods, so it also runs under jsdom.
 */
export function extractDigest(row: Element): string | null {
  const copy = row.querySelector('clipboard-copy[value^="sha256:"]');
  if (copy) return copy.getAttribute("value");
  return matchDigest(row.textContent);
}
