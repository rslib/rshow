import { getVersion } from "./db";
import { parseManifest } from "./manifest";
import type { ShareRole } from "./constants";
import type { ArtifactRow, Env, Manifest, ProjectAccess, ProjectMemberInfo, ShareRow, VersionRow } from "./types";

export interface AccessRecord {
  artifact: ArtifactRow;
  shares: ShareRow[];
  project: ProjectAccess | null;
  version: VersionRow | null;
}

interface ProjectLookupRow {
  project: string;
  owner: string;
  member_email: string | null;
  member_role: ShareRole | null;
}

const CACHE_ORIGIN = "https://rshow.internal";
const MANIFEST_MAX_ENTRIES = 200;
const VERSION_MAX_ENTRIES = 500;
const ACCESS_CACHE_CONTROL = "max-age=15";
const MANIFEST_CACHE_CONTROL = "public, max-age=31536000, immutable";
const VERSION_CACHE_CONTROL = "public, max-age=31536000, immutable";
const JSON_CONTENT_TYPE = "application/json";
const BLOB_CACHE_CONTROL = "public, max-age=31536000, immutable";

const ARTIFACT_COLUMNS =
  "slug, title, owner, mode, pinned, latest, last_n, version_gen, project, created_at, updated_at";
const VERSION_COLUMNS = "slug, n, label, manifest_key, files, bytes, created_by, created_at";

const manifestMemory = new Map<string, Manifest>();
const versionMemory = new Map<string, VersionRow>();
const versionKeys = new Map<string, Set<string>>();
const trackedKeys = new Set<string>();

export function accessCacheKey(slug: string): string {
  return `${CACHE_ORIGIN}/access/${slug}`;
}

export function manifestCacheKey(manifestKey: string): string {
  return `${CACHE_ORIGIN}/manifest/${manifestKey}`;
}

export function blobCacheKey(hash: string): string {
  return `${CACHE_ORIGIN}/blob/${hash}`;
}

// The generation is part of the key, so a delete retires every copy an older
// isolate holds and a version number is never served from a stale cache.
export function versionCacheKey(slug: string, n: number, gen: number): string {
  return `${CACHE_ORIGIN}/version/${slug}/${n}/${gen}`;
}

function versionMemoryKey(slug: string, n: number, gen: number): string {
  return `${slug}/${n}/${gen}`;
}

function rememberManifest(key: string, value: Manifest): void {
  manifestMemory.delete(key);
  manifestMemory.set(key, value);
  while (manifestMemory.size > MANIFEST_MAX_ENTRIES) {
    const oldest = manifestMemory.keys().next().value;
    if (oldest === undefined) break;
    manifestMemory.delete(oldest);
  }
}

function rememberVersion(slug: string, n: number, gen: number, row: VersionRow): void {
  const key = versionMemoryKey(slug, n, gen);
  versionMemory.delete(key);
  versionMemory.set(key, row);
  while (versionMemory.size > VERSION_MAX_ENTRIES) {
    const oldest = versionMemory.keys().next().value;
    if (oldest === undefined) break;
    versionMemory.delete(oldest);
  }
  const keys = versionKeys.get(slug) ?? new Set<string>();
  keys.add(versionCacheKey(slug, n, gen));
  versionKeys.set(slug, keys);
}

function decodeVersion(text: string): VersionRow | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const row = parsed as Partial<VersionRow>;
    if (typeof row.slug !== "string" || row.slug === "") return null;
    if (typeof row.n !== "number" || !Number.isInteger(row.n)) return null;
    if (typeof row.manifest_key !== "string" || row.manifest_key === "") return null;
    return {
      slug: row.slug,
      n: row.n,
      label: typeof row.label === "string" ? row.label : "",
      manifest_key: row.manifest_key,
      files: typeof row.files === "number" ? row.files : 0,
      bytes: typeof row.bytes === "number" ? row.bytes : 0,
      created_by: typeof row.created_by === "string" ? row.created_by : "",
      created_at: typeof row.created_at === "string" ? row.created_at : ""
    };
  } catch {
    return null;
  }
}

async function cacheGet(key: string): Promise<Response | null> {
  try {
    return (await caches.default.match(key)) ?? null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, body: string, cacheControl: string): Promise<void> {
  trackedKeys.add(key);
  try {
    await caches.default.put(
      key,
      new Response(body, { headers: { "content-type": JSON_CONTENT_TYPE, "cache-control": cacheControl } })
    );
  } catch {
    trackedKeys.delete(key);
  }
}

function decodeAccess(text: string): { ok: true; value: AccessRecord | null } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null) return { ok: true, value: null };
    if (typeof parsed !== "object") return { ok: false };
    const record = parsed as Partial<AccessRecord>;
    if (!record.artifact || typeof record.artifact.slug !== "string") return { ok: false };
    if (!Array.isArray(record.shares)) return { ok: false };
    let project: ProjectAccess | null = null;
    if (record.project !== undefined && record.project !== null) {
      const candidate = record.project;
      if (typeof candidate.slug !== "string" || typeof candidate.owner !== "string" || !Array.isArray(candidate.members)) {
        return { ok: false };
      }
      const members: ProjectMemberInfo[] = [];
      for (const member of candidate.members) {
        if (typeof member.email !== "string" || (member.role !== "viewer" && member.role !== "editor")) {
          return { ok: false };
        }
        members.push({ email: member.email, role: member.role });
      }
      project = { slug: candidate.slug, owner: candidate.owner, members };
    }
    return {
      ok: true,
      value: { artifact: record.artifact, shares: record.shares, project, version: record.version ?? null }
    };
  } catch {
    return { ok: false };
  }
}

async function loadAccess(env: Env, slug: string): Promise<AccessRecord | null> {
  const session = env.DB.withSession("first-unconstrained");
  const results = await session.batch([
    session.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE slug = ?1`).bind(slug),
    session.prepare("SELECT slug, email, role FROM shares WHERE slug = ?1 ORDER BY email").bind(slug),
    session
      .prepare(
        `SELECT ${VERSION_COLUMNS} FROM versions WHERE slug = ?1 AND n = (SELECT COALESCE(pinned, latest) FROM artifacts WHERE slug = ?1)`
      )
      .bind(slug),
    session
      .prepare(
        "SELECT p.slug AS project, p.owner AS owner, pm.email AS member_email, pm.role AS member_role FROM projects p LEFT JOIN project_members pm ON pm.project = p.slug WHERE p.slug = (SELECT project FROM artifacts WHERE slug = ?1) ORDER BY pm.email"
      )
      .bind(slug)
  ]);
  const artifact = (results[0]?.results ?? [])[0] as ArtifactRow | undefined;
  if (!artifact) return null;
  const shares = (results[1]?.results ?? []) as ShareRow[];
  const version = ((results[2]?.results ?? [])[0] as VersionRow | undefined) ?? null;
  const projectRows = (results[3]?.results ?? []) as ProjectLookupRow[];
  let project: ProjectAccess | null = null;
  if (projectRows.length > 0) {
    const members: ProjectMemberInfo[] = [];
    for (const row of projectRows) {
      if (row.member_email !== null && row.member_role !== null) {
        members.push({ email: row.member_email, role: row.member_role });
      }
    }
    project = { slug: projectRows[0].project, owner: projectRows[0].owner, members };
  }
  return { artifact, shares, project, version };
}

// An access record lives only in the Cache API. An invalidation can delete the
// key of its own data center, but it cannot reach the memory of another isolate.
export async function accessFor(env: Env, slug: string): Promise<AccessRecord | null> {
  const key = accessCacheKey(slug);
  const cached = await cacheGet(key);
  if (cached) {
    const decoded = decodeAccess(await cached.text());
    if (decoded.ok) return decoded.value;
  }

  const value = await loadAccess(env, slug);
  await cachePut(key, JSON.stringify(value), ACCESS_CACHE_CONTROL);
  return value;
}

export async function invalidateAccess(slug: string): Promise<void> {
  const key = accessCacheKey(slug);
  trackedKeys.delete(key);
  try {
    await caches.default.delete(key);
  } catch {
    return;
  }
}

// Project membership is part of every artifact's access record. Any change to a
// project (members, deletes) or to an artifact's project must drop the access
// record of every artifact in the affected project.
export async function invalidateProjectAccess(env: Env, project: string): Promise<void> {
  const result = await env.DB.prepare("SELECT slug FROM artifacts WHERE project = ?1")
    .bind(project)
    .all<{ slug: string }>();
  for (const row of result.results ?? []) {
    await invalidateAccess(row.slug);
  }
}

export async function versionFor(env: Env, artifact: ArtifactRow, n: number): Promise<VersionRow | null> {
  const gen = artifact.version_gen;
  const memory = versionMemory.get(versionMemoryKey(artifact.slug, n, gen));
  if (memory) {
    rememberVersion(artifact.slug, n, gen, memory);
    return memory;
  }

  const key = versionCacheKey(artifact.slug, n, gen);
  const cached = await cacheGet(key);
  if (cached) {
    const row = decodeVersion(await cached.text());
    if (row) {
      rememberVersion(artifact.slug, n, gen, row);
      return row;
    }
  }

  const row = await getVersion(env, artifact.slug, n);
  if (!row) return null;
  rememberVersion(artifact.slug, n, gen, row);
  await cachePut(key, JSON.stringify(row), VERSION_CACHE_CONTROL);
  return row;
}

export async function invalidateVersions(slug: string): Promise<void> {
  const prefix = `${slug}/`;
  for (const key of [...versionMemory.keys()]) {
    if (key.startsWith(prefix)) versionMemory.delete(key);
  }
  const keys = versionKeys.get(slug);
  versionKeys.delete(slug);
  if (!keys) return;
  for (const key of keys) {
    trackedKeys.delete(key);
    try {
      await caches.default.delete(key);
    } catch {
      continue;
    }
  }
}

export async function manifestFor(env: Env, key: string): Promise<Manifest | null> {
  const memory = manifestMemory.get(key);
  if (memory) {
    rememberManifest(key, memory);
    return memory;
  }

  const cached = await cacheGet(manifestCacheKey(key));
  if (cached) {
    let parsed: Manifest | null = null;
    try {
      parsed = parseManifest(await cached.json());
    } catch {
      parsed = null;
    }
    if (parsed) {
      rememberManifest(key, parsed);
      return parsed;
    }
  }

  const object = await env.BUCKET.get(key);
  if (!object) return null;
  let parsed: Manifest | null = null;
  try {
    parsed = parseManifest(await object.json());
  } catch {
    parsed = null;
  }
  if (!parsed) return null;
  rememberManifest(key, parsed);
  await cachePut(manifestCacheKey(key), JSON.stringify(parsed), MANIFEST_CACHE_CONTROL);
  return parsed;
}

export async function cachedBlob(hash: string): Promise<Response | null> {
  return await cacheGet(blobCacheKey(hash));
}

export function blobCacheHeaders(contentType: string): Headers {
  return new Headers({ "content-type": contentType, "cache-control": BLOB_CACHE_CONTROL });
}

export async function putBlobCache(hash: string, body: BodyInit, contentType: string): Promise<void> {
  try {
    await caches.default.put(blobCacheKey(hash), new Response(body, { headers: blobCacheHeaders(contentType) }));
  } catch {
    return;
  }
}

export async function clearResponseCache(): Promise<void> {
  manifestMemory.clear();
  versionMemory.clear();
  versionKeys.clear();
  const keys = [...trackedKeys];
  trackedKeys.clear();
  for (const key of keys) {
    try {
      await caches.default.delete(key);
    } catch {
      continue;
    }
  }
}
