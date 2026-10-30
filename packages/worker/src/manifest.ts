import { HASH_PATTERN, MAX_PATH_LENGTH } from "./constants";
import type { Manifest, ManifestEntry } from "./types";

const TEXTUAL_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/manifest+json",
  "application/javascript",
  "application/ecmascript",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
  "application/atom+xml",
  "image/svg+xml"
]);

export function isValidManifestPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > MAX_PATH_LENGTH) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  if (path.includes("\\")) return false;
  for (const ch of path) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function manifestKey(slug: string, n: number, suffix: string): string {
  return `manifests/${slug}/${n}-${suffix}.json`;
}

export function blobKey(hash: string): string {
  return `blobs/${hash}`;
}

export function isManifestEntry(value: unknown): value is ManifestEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry["hash"] !== "string" || !HASH_PATTERN.test(entry["hash"])) return false;
  if (typeof entry["size"] !== "number" || !Number.isInteger(entry["size"]) || entry["size"] < 0) return false;
  if (typeof entry["type"] !== "string" || entry["type"].length === 0 || entry["type"].length > 200) return false;
  return true;
}

export function parseManifest(value: unknown): Manifest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const manifest: Manifest = {};
  for (const [path, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidManifestPath(path)) return null;
    if (!isManifestEntry(entry)) return null;
    manifest[path] = { hash: entry.hash, size: entry.size, type: entry.type };
  }
  return manifest;
}

export function contentTypeWithCharset(type: string): string {
  const value = (type ?? "").trim();
  if (value === "") return "application/octet-stream";
  const lower = value.toLowerCase();
  if (lower.includes("charset")) return value;
  if (lower.startsWith("text/") || TEXTUAL_TYPES.has(lower.split(";")[0].trim())) return `${value}; charset=utf-8`;
  return value;
}

export function etagFor(hash: string): string {
  return `"${hash}"`;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "*" || part === etag || part === `W/${etag}`);
}
