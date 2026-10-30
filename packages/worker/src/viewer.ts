import type { Context } from "hono";
import { canView } from "./authz";
import { resolveViewerIdentity } from "./auth";
import { accessFor, cachedBlob, manifestFor, putBlobCache, versionFor } from "./cache";
import {
  DATA_KEY_PATTERN,
  HASH_PATTERN,
  MAX_BLOB_CACHE_BYTES,
  MAX_BUFFERED_BLOB_BYTES,
  MODE,
  PROJECT_SEGMENT,
  SLUG_PATTERN,
  THEMES_SEGMENT,
  THEME_JSON_PATTERN,
  THEME_NAME_PATTERN,
  THEME_PREFIX,
  THEME_VERSION_PATTERN,
  type ThemeInfo
} from "./constants";
import { dataLimitFor, readData, writeData } from "./datastore";
import { forbiddenPage, loginRedirect, notFoundPage } from "./hostPage";
import { json, jsonError, redirect } from "./http";
import { blobKey, contentTypeWithCharset, etagFor, etagMatches } from "./manifest";
import { handleProjectPage } from "./project";
import type { AppEnv, ArtifactRow, Env, Identity, Manifest, ManifestEntry, ProjectAccess, ShareRow } from "./types";

const RESERVED_PREFIXES = ["/api", "/static"];

const CACHE_CONTROL = {
  private: "private, no-store",
  publicLive: "public, max-age=0, s-maxage=15, must-revalidate",
  publicVersion: "public, max-age=31536000, immutable, s-maxage=300",
  theme: "public, max-age=31536000, immutable",
  themeJson: "public, max-age=60"
} as const;

export function viewerCsp(env: Env): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    `frame-ancestors 'self' https://${env.ARTD_HOST}`,
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; ");
}

export function safeNext(raw: string | null, artHost: string): string {
  if (!raw) return "/";
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return "/";
  }
  if (raw.startsWith("//") || raw.includes("\\")) return "/";
  if (!raw.startsWith("/")) return "/";
  const origin = `https://${artHost.trim().toLowerCase()}`;
  let parsed: URL;
  try {
    parsed = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (parsed.origin !== origin) return "/";
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function isReservedPath(pathname: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function relativePath(parts: string[]): string | null {
  if (parts.length === 0) return "index.html";
  for (let i = 0; i < parts.length; i += 1) {
    const segment = parts[i];
    const isLast = i === parts.length - 1;
    if (segment === "") {
      if (isLast) continue;
      return null;
    }
    if (segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\")) return null;
    for (const ch of segment) {
      const code = ch.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) return null;
    }
  }
  const joined = parts.join("/");
  if (joined === "") return "index.html";
  return joined.endsWith("/") ? `${joined}index.html` : joined;
}

function cacheControlFor(artifact: ArtifactRow, versioned: boolean): string {
  if (artifact.mode !== MODE.public) return CACHE_CONTROL.private;
  return versioned ? CACHE_CONTROL.publicVersion : CACHE_CONTROL.publicLive;
}

type ResolvedEntry =
  | { kind: "entry"; entry: ManifestEntry }
  | { kind: "redirect" }
  | { kind: "missing"; relative: string };

function resolveEntry(manifest: Manifest, relative: string, parts: string[]): ResolvedEntry {
  const entry = manifest[relative];
  if (entry) return { kind: "entry", entry };
  const joined = parts.join("/");
  if (joined !== "" && !joined.endsWith("/") && manifest[`${joined}/index.html`]) return { kind: "redirect" };
  return { kind: "missing", relative };
}

export async function handleViewer(c: Context<AppEnv>): Promise<Response> {
  const env = c.env;
  const url = new URL(c.req.url);
  const pathname = url.pathname;

  if (pathname === "/_auth/login") {
    return redirect(safeNext(url.searchParams.get("next"), env.ART_HOST), 302);
  }

  if (isReservedPath(pathname)) return notFoundPage();
  if (pathname === "/") return notFoundPage();

  const segments: string[] = [];
  for (const part of pathname.slice(1).split("/")) {
    const decoded = decodeSegment(part);
    if (decoded === null) return notFoundPage();
    segments.push(decoded);
  }

  if (segments[0] === THEMES_SEGMENT) {
    return await handleTheme(c, segments.slice(1), url);
  }

  if (segments[0] === PROJECT_SEGMENT) {
    return await handleProjectPage(c, segments.slice(1), url);
  }

  const slug = segments[0] ?? "";
  if (!SLUG_PATTERN.test(slug)) return notFoundPage();

  const access = await accessFor(env, slug);
  if (!access) return notFoundPage();
  const artifact = access.artifact;

  if (segments.length === 1) return redirect(`/${slug}/${url.search}`, 301);

  const rest = segments.slice(1);
  const identity = await resolveViewerIdentity(env, c.req.raw.headers);

  if (rest[0] === "_data") {
    return handlePageData(c, artifact, identity, rest.slice(1), access.shares, access.project);
  }

  let versionN: number | null = null;
  let parts = rest;
  const versionMatch = /^v([0-9]{1,9})$/.exec(rest[0] ?? "");
  if (versionMatch) {
    versionN = Number(versionMatch[1]);
    parts = rest.slice(1);
    if (parts.length === 0) return redirect(`${pathname}/${url.search}`, 301);
  }

  if (!canView(artifact, identity.email, access.shares, access.project)) {
    if (identity.email === null) return loginRedirect(pathname, url.search);
    return forbiddenPage(identity.email);
  }

  const version =
    versionN === null
      ? access.version
      : access.version && access.version.n === versionN
        ? access.version
        : await versionFor(env, slug, versionN);
  if (!version) return notFoundPage("This artifact has no such version yet.");

  const relative = relativePath(parts);
  if (relative === null) return notFoundPage();

  const manifest = await manifestFor(env, version.manifest_key);
  if (!manifest) return notFoundPage("This version is missing its manifest.");

  const resolved = resolveEntry(manifest, relative, parts);
  if (resolved.kind === "redirect") return redirect(`${pathname}/${url.search}`, 301);
  if (resolved.kind === "missing") return notFoundPage(`No such file: ${resolved.relative}`);

  return await serveBlob(c, resolved.entry, cacheControlFor(artifact, versionN !== null));
}

function withoutBodyOnHead(c: Context<AppEnv>, response: Response): Response {
  if (c.req.method !== "HEAD") return response;
  return new Response(null, { status: response.status, headers: response.headers });
}

async function handleTheme(c: Context<AppEnv>, rest: string[], url: URL): Promise<Response> {
  const env = c.env;
  const segment = rest[0] ?? "";

  const info = THEME_JSON_PATTERN.exec(segment);
  if (info) {
    if (rest.length !== 1) return withoutBodyOnHead(c, jsonError("not found", 404));
    const name = info[1];
    const latest = await accessFor(env, `${THEME_PREFIX}${name}`);
    if (!latest || latest.artifact.mode !== MODE.public || !latest.version) {
      return withoutBodyOnHead(c, jsonError("not found", 404));
    }
    const version = latest.version.n;
    const reply: ThemeInfo = { name, version, url: `/${THEMES_SEGMENT}/${name}@${version}/` };
    return withoutBodyOnHead(
      c,
      json(reply, 200, {
        "cache-control": CACHE_CONTROL.themeJson,
        "access-control-allow-origin": "*"
      })
    );
  }

  const match = THEME_VERSION_PATTERN.exec(segment);
  if (!match) return notFoundPage();
  const name = match[1];
  if (!THEME_NAME_PATTERN.test(name)) return notFoundPage();
  const n = Number(match[2]);
  const slug = `${THEME_PREFIX}${name}`;

  const access = await accessFor(env, slug);
  if (!access || access.artifact.mode !== MODE.public) return notFoundPage();

  const parts = rest.slice(1);
  if (parts.length === 0) return redirect(`/${THEMES_SEGMENT}/${segment}/${url.search}`, 301);

  const version = access.version && access.version.n === n ? access.version : await versionFor(env, slug, n);
  if (!version) return notFoundPage("This theme has no such version yet.");

  const relative = relativePath(parts);
  if (relative === null) return notFoundPage();

  const manifest = await manifestFor(env, version.manifest_key);
  if (!manifest) return notFoundPage("This version is missing its manifest.");

  const resolved = resolveEntry(manifest, relative, parts);
  if (resolved.kind === "redirect") return redirect(`${url.pathname}/${url.search}`, 301);
  if (resolved.kind === "missing") return notFoundPage(`No such file: ${resolved.relative}`);

  return await serveBlob(c, resolved.entry, CACHE_CONTROL.theme);
}

async function serveBlob(c: Context<AppEnv>, entry: ManifestEntry, cacheControl: string): Promise<Response> {
  const env = c.env;
  if (!HASH_PATTERN.test(entry.hash)) return notFoundPage();

  const etag = etagFor(entry.hash);
  const contentType = contentTypeWithCharset(entry.type);
  const headers = new Headers({
    "content-type": contentType,
    etag,
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": viewerCsp(env)
  });

  if (etagMatches(c.req.header("if-none-match") ?? null, etag)) {
    return new Response(null, { status: 304, headers });
  }

  const isHead = c.req.method === "HEAD";
  const cached = await cachedBlob(entry.hash);
  if (cached) return new Response(isHead ? null : cached.body, { status: 200, headers });

  const object = await env.BUCKET.get(blobKey(entry.hash));
  if (!object) return notFoundPage("This file is missing from storage.");

  if (isHead) {
    if (object.size <= MAX_BLOB_CACHE_BYTES) {
      c.executionCtx.waitUntil(putBlobCache(entry.hash, object.body, contentType));
    }
    return new Response(null, { status: 200, headers });
  }

  if (object.size <= MAX_BUFFERED_BLOB_BYTES) {
    const bytes = await object.arrayBuffer();
    c.executionCtx.waitUntil(putBlobCache(entry.hash, bytes, contentType));
    return new Response(bytes, { status: 200, headers });
  }

  if (object.size > MAX_BLOB_CACHE_BYTES) {
    return new Response(object.body, { status: 200, headers });
  }

  const [body, copy] = object.body.tee();
  c.executionCtx.waitUntil(putBlobCache(entry.hash, copy, contentType));
  return new Response(body, { status: 200, headers });
}

async function handlePageData(
  c: Context<AppEnv>,
  artifact: ArtifactRow,
  identity: Identity,
  rest: string[],
  shares: ShareRow[],
  project: ProjectAccess | null
): Promise<Response> {
  const env = c.env;
  const url = new URL(c.req.url);
  if (rest.length !== 1) return jsonError("not found", 404);
  const key = rest[0];
  if (!DATA_KEY_PATTERN.test(key)) return jsonError("invalid key", 404);

  const allowed = canView(artifact, identity.email, shares, project);

  if (c.req.method === "GET" || c.req.method === "HEAD") {
    if (!allowed) {
      if (identity.email === null) return loginRedirect(url.pathname, url.search);
      return jsonError("forbidden", 403);
    }
    const read = await readData(env, artifact.slug, key);
    if (read.kind === "missing") return jsonError("not found", 404);
    if (read.kind === "blob-missing") return jsonError("value is missing from storage", 500);
    const entry = read.entry;
    return json({ value: entry.value, updated_at: entry.updated_at, updated_by: entry.updated_by }, 200, {
      etag: entry.etag,
      "cache-control": "no-store"
    });
  }

  if (c.req.method !== "PUT") return jsonError("method not allowed", 405);

  if (!allowed || identity.email === null) return jsonError("forbidden", 403);

  const contentType = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") return jsonError("expected application/json", 415);

  // `sketch-` keys take up to 5 MiB, every other key keeps the 64 KiB limit.
  const limit = dataLimitFor(key);
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return jsonError("value too large", 413);

  const buffer = await c.req.raw.arrayBuffer();
  if (buffer.byteLength > limit) return jsonError("value too large", 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    return jsonError("expected a JSON body", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("value" in parsed)) {
    return jsonError("expected {value}", 400);
  }
  const value = (parsed as { value: unknown }).value;

  // `If-Match` keeps two editors from silently overwriting each other.
  const result = await writeData(env, {
    slug: artifact.slug,
    key,
    value,
    email: identity.email,
    ifMatch: c.req.header("if-match") ?? null
  });
  if (result.kind === "too-large") return jsonError("value too large", 413);
  if (result.kind === "conflict") return jsonError("etag mismatch", 409);
  if (result.kind === "too-many-keys") return jsonError("too many keys for this artifact", 409);

  return json({ ok: true, key, updated_at: result.updated_at }, 200, { etag: result.etag });
}
