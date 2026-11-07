import type { Hono } from "hono";
import { randomHex } from "../auth";
import { canManage, canPublish } from "../authz";
import { invalidateAccess, invalidateVersions, manifestFor } from "../cache";
import { MAX_VERSION_BYTES, MAX_VERSION_FILES, THEME_PREFIX, type Version, type VersionDetail } from "../constants";
import { blobSizes, countVersions, getArtifact, getArtifactTags, getVersion } from "../db";
import { json, jsonError } from "../http";
import { isManifestEntry, isValidManifestPath, manifestKey } from "../manifest";
import type { AppEnv, ArtifactRow, Env, Manifest, VersionRow } from "../types";
import { actorOf, loadAccessible, readBody, toArtifact, type JsonObject } from "./common";

export interface VersionInput {
  label: string;
  n: number;
  base: number | null;
  manifest: Manifest;
  files: number;
  bytes: number;
  createdBy: string;
  now: string;
}

export type StoreVersionResult =
  | { ok: true; row: VersionRow }
  | { ok: false; status: number; error: string };

export function toVersion(env: Env, slug: string, row: VersionRow): Version {
  return {
    n: row.n,
    label: row.label,
    created_by: row.created_by,
    created_at: row.created_at,
    files: row.files,
    bytes: row.bytes,
    url: `https://${env.ART_HOST}/${slug}/v${row.n}/`
  };
}

export function toVersionDetail(env: Env, slug: string, row: VersionRow, manifest: Manifest): VersionDetail {
  return { ...toVersion(env, slug, row), files: manifest };
}

async function discardManifest(env: Env, key: string): Promise<void> {
  try {
    await env.BUCKET.delete(key);
  } catch {
    return;
  }
}

export async function storeVersion(env: Env, artifact: ArtifactRow, input: VersionInput): Promise<StoreVersionResult> {
  const key = manifestKey(artifact.slug, input.n, randomHex(8));
  try {
    await env.BUCKET.put(key, JSON.stringify(input.manifest), {
      httpMetadata: { contentType: "application/json" }
    });
  } catch {
    return { ok: false, status: 500, error: "could not store the manifest" };
  }

  let insertedChanges = 0;
  let advancedChanges = 0;
  try {
    const [inserted, advanced] = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO versions (slug, n, label, manifest_key, files, bytes, created_by, created_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE (SELECT latest FROM artifacts WHERE slug = ?1) IS ?9"
      ).bind(artifact.slug, input.n, input.label, key, input.files, input.bytes, input.createdBy, input.now, input.base),
      env.DB.prepare("UPDATE artifacts SET latest = ?2, last_n = ?2, updated_at = ?3 WHERE slug = ?1 AND latest IS ?4").bind(
        artifact.slug,
        input.n,
        input.now,
        input.base
      )
    ]);
    insertedChanges = inserted?.meta?.changes ?? 0;
    advancedChanges = advanced?.meta?.changes ?? 0;
  } catch {
    await discardManifest(env, key);
    return { ok: false, status: 500, error: "could not store the version" };
  }

  if (insertedChanges !== 1 || advancedChanges !== 1) {
    await discardManifest(env, key);
    return { ok: false, status: 409, error: "another version was published at the same time, retry" };
  }

  return {
    ok: true,
    row: {
      slug: artifact.slug,
      n: input.n,
      label: input.label,
      manifest_key: key,
      files: input.files,
      bytes: input.bytes,
      created_by: input.createdBy,
      created_at: input.now
    }
  };
}

export function registerVersions(app: Hono<AppEnv>): void {
  app.get("/api/artifacts/:slug/versions/:n", async (c) => {
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);

    const raw = c.req.param("n");
    if (!/^[1-9][0-9]{0,8}$/.test(raw)) return jsonError("no such version", 404);
    const version = await getVersion(c.env, access.artifact.slug, Number(raw));
    if (!version) return jsonError("no such version", 404);
    const manifest = await manifestFor(c.env, version.manifest_key);
    if (!manifest) return jsonError("no such version", 404);

    return json(toVersionDetail(c.env, access.artifact.slug, version, manifest));
  });

  app.delete("/api/artifacts/:slug/versions/:n", async (c) => {
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);
    if (!canManage(access.artifact, access.shares, actorOf(c), access.project)) {
      return jsonError("owner access is required", 403);
    }

    const raw = c.req.param("n");
    if (!/^[1-9][0-9]{0,8}$/.test(raw)) return jsonError("no such version", 404);
    const n = Number(raw);
    const slug = access.artifact.slug;

    if (slug.startsWith(THEME_PREFIX) && c.req.query("force") !== "1") {
      return jsonError("pages link to theme versions; pass force to delete it", 409);
    }

    const version = await getVersion(c.env, slug, n);
    if (!version) return jsonError("no such version", 404);
    if (access.artifact.pinned === n) {
      return jsonError(`version ${n} is pinned; pin another version first`, 409);
    }
    if ((await countVersions(c.env, slug)) <= 1) {
      return jsonError("this is the only version; delete the artifact instead", 409);
    }

    const now = new Date().toISOString();
    let deletedChanges = 0;
    try {
      const [deleted] = await c.env.DB.batch([
        c.env.DB.prepare(
          "DELETE FROM versions WHERE slug = ?1 AND n = ?2 AND (SELECT pinned FROM artifacts WHERE slug = ?1) IS NOT ?2 AND (SELECT COUNT(*) FROM versions WHERE slug = ?1) > 1"
        ).bind(slug, n),
        c.env.DB.prepare(
          "UPDATE artifacts SET latest = (SELECT MAX(n) FROM versions WHERE slug = ?1), version_gen = version_gen + 1, updated_at = ?2 WHERE slug = ?1"
        ).bind(slug, now)
      ]);
      deletedChanges = deleted?.meta?.changes ?? 0;
    } catch {
      return jsonError("could not delete the version", 500);
    }
    if (deletedChanges !== 1) return jsonError("another change came first, retry", 409);

    await discardManifest(c.env, version.manifest_key);
    await invalidateVersions(slug);
    await invalidateAccess(slug);

    const updated = await getArtifact(c.env, slug);
    if (!updated) return jsonError("not found", 404);
    const tags = await getArtifactTags(c.env, slug);
    return json(toArtifact(c.env, updated, access.role, tags));
  });

  app.post("/api/artifacts/:slug/versions", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);
    if (!canPublish(access.artifact, access.shares, actorOf(c), access.project)) {
      return jsonError("owner or editor access is required", 403);
    }

    const files = body.body.files;
    if (typeof files !== "object" || files === null || Array.isArray(files)) {
      return jsonError("files must be an object", 400);
    }
    const fileEntries = Object.entries(files as JsonObject);
    if (fileEntries.length === 0) return jsonError("files must not be empty", 400);
    if (fileEntries.length > MAX_VERSION_FILES) return jsonError(`at most ${MAX_VERSION_FILES} files`, 400);

    const manifest: Manifest = {};
    const entries: { path: string; hash: string; type: string }[] = [];
    for (const [path, entry] of fileEntries) {
      if (!isValidManifestPath(path)) return jsonError(`invalid file path: ${path}`, 400);
      if (!isManifestEntry(entry)) return jsonError(`invalid manifest entry for ${path}`, 400);
      entries.push({ path, hash: entry.hash, type: entry.type });
    }

    const hashes = [...new Set(entries.map((entry) => entry.hash))];
    const sizes = await blobSizes(c.env, hashes);
    const missing = hashes.filter((hash) => !sizes.has(hash));
    if (missing.length > 0) {
      return jsonError(`missing blobs: ${missing.slice(0, 5).join(", ")}`, 400);
    }

    let totalBytes = 0;
    for (const entry of entries) {
      const size = sizes.get(entry.hash) as number;
      manifest[entry.path] = { hash: entry.hash, size, type: entry.type };
      totalBytes += size;
    }
    if (totalBytes > MAX_VERSION_BYTES) return jsonError("version is larger than 100 MiB", 400);
    if (!manifest["index.html"] && !access.artifact.slug.startsWith(THEME_PREFIX)) {
      return jsonError("version must include index.html", 400);
    }

    const label = typeof body.body.label === "string" ? body.body.label.trim().slice(0, 200) : "";
    const base = access.artifact.latest;
    const n = Math.max(access.artifact.last_n, base ?? 0) + 1;
    const now = new Date().toISOString();
    const stored = await storeVersion(c.env, access.artifact, {
      label,
      n,
      base,
      manifest,
      files: entries.length,
      bytes: totalBytes,
      createdBy: email,
      now
    });
    if (!stored.ok) return jsonError(stored.error, stored.status);

    await invalidateAccess(access.artifact.slug);
    return json(toVersion(c.env, access.artifact.slug, stored.row), 201);
  });
}
