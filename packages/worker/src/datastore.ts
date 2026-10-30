import { sha256Hex } from "./auth";
import {
  DATA_BLOB_PREFIX,
  DATA_BLOB_SUFFIX,
  MAX_DATA_BYTES,
  MAX_DATA_KEYS,
  MAX_SKETCH_DATA_BYTES,
  SKETCH_DATA_KEY_PREFIX
} from "./constants";
import { etagFor, etagMatches } from "./manifest";
import type { Env } from "./types";

// Per-artifact data store:
//
// - small values stay inline in D1 (`page_data.value`),
// - values above MAX_DATA_BYTES are written to R2 under `data/<slug>/<key>.json`
//   and the row keeps only a marker in `page_data.blob_key` with `value` NULL.
//
// Keys starting with `sketch-` may hold up to MAX_SKETCH_DATA_BYTES, everything
// else keeps the historical MAX_DATA_BYTES limit.

const R2_LIST_LIMIT = 1000;
const R2_DELETE_BATCH = 1000;
const DATA_ROW_COLUMNS = "value, blob_key, updated_by, updated_at";

interface DataRow {
  value: string | null;
  blob_key: string | null;
  updated_by: string;
  updated_at: string;
}

export interface DataEntry {
  value: unknown;
  updated_at: string;
  updated_by: string;
  etag: string;
}

export interface DataWriteInput {
  slug: string;
  key: string;
  value: unknown;
  email: string;
  // Raw `If-Match` request header, or null when the caller sends none.
  ifMatch: string | null;
}

export type DataRead =
  | { kind: "ok"; entry: DataEntry }
  | { kind: "missing" }
  | { kind: "blob-missing" };

export type DataWrite =
  | { kind: "ok"; updated_at: string; etag: string }
  | { kind: "conflict" }
  | { kind: "too-many-keys" }
  | { kind: "too-large" };

export function isSketchDataKey(key: string): boolean {
  return key.startsWith(SKETCH_DATA_KEY_PREFIX);
}

export function dataLimitFor(key: string): number {
  return isSketchDataKey(key) ? MAX_SKETCH_DATA_BYTES : MAX_DATA_BYTES;
}

export function dataBlobPrefix(slug: string): string {
  return `${DATA_BLOB_PREFIX}${slug}/`;
}

export function dataBlobKey(slug: string, key: string): string {
  return `${dataBlobPrefix(slug)}${key}${DATA_BLOB_SUFFIX}`;
}

function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function loadRow(env: Env, slug: string, key: string): Promise<DataRow | null> {
  const row = await env.DB.prepare(`SELECT ${DATA_ROW_COLUMNS} FROM page_data WHERE slug = ?1 AND key = ?2`)
    .bind(slug, key)
    .first<DataRow>();
  return row ?? null;
}

interface RowText {
  text: string;
  etag: string;
}

// The ETag of a row is the quoted sha256 of the stored JSON text, whether that
// text lives inline in D1 or in R2, so clients see one value per stored version.
async function textOfRow(env: Env, row: DataRow): Promise<RowText | null> {
  if (row.blob_key !== null) {
    const object = await env.BUCKET.get(row.blob_key);
    if (!object) return null;
    const text = await object.text();
    return { text, etag: etagFor(await sha256Hex(text)) };
  }
  const text = row.value ?? "";
  return { text, etag: etagFor(await sha256Hex(text)) };
}

export async function readData(env: Env, slug: string, key: string): Promise<DataRead> {
  const row = await loadRow(env, slug, key);
  if (!row) return { kind: "missing" };
  const loaded = await textOfRow(env, row);
  if (!loaded) return { kind: "blob-missing" };
  return {
    kind: "ok",
    entry: { value: parseValue(loaded.text), updated_at: row.updated_at, updated_by: row.updated_by, etag: loaded.etag }
  };
}

async function countKeys(env: Env, slug: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM page_data WHERE slug = ?1")
    .bind(slug)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function writeData(env: Env, input: DataWriteInput): Promise<DataWrite> {
  const { slug, key, email, ifMatch } = input;
  const text = JSON.stringify(input.value === undefined ? null : input.value);
  if (new TextEncoder().encode(text).byteLength > dataLimitFor(key)) return { kind: "too-large" };

  const existing = await loadRow(env, slug, key);

  if (ifMatch !== null && ifMatch.trim() !== "") {
    if (!existing) return { kind: "conflict" };
    const loaded = await textOfRow(env, existing);
    if (!loaded) return { kind: "conflict" };
    if (!etagMatches(ifMatch, loaded.etag)) return { kind: "conflict" };
  }

  if (!existing && (await countKeys(env, slug)) >= MAX_DATA_KEYS) return { kind: "too-many-keys" };

  const blobKey = dataBlobKey(slug, key);
  const useBlob = new TextEncoder().encode(text).byteLength > MAX_DATA_BYTES;
  const now = new Date().toISOString();
  const etag = etagFor(await sha256Hex(text));

  if (useBlob) {
    // R2 first: a failed D1 write leaves an unreferenced object, never a row
    // that points at missing bytes.
    await env.BUCKET.put(blobKey, text, { httpMetadata: { contentType: "application/json" } });
    await env.DB.prepare(
      "INSERT INTO page_data (slug, key, value, blob_key, updated_by, updated_at) VALUES (?1, ?2, NULL, ?3, ?4, ?5) ON CONFLICT (slug, key) DO UPDATE SET value = NULL, blob_key = excluded.blob_key, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    )
      .bind(slug, key, blobKey, email, now)
      .run();
  } else {
    await env.DB.prepare(
      "INSERT INTO page_data (slug, key, value, blob_key, updated_by, updated_at) VALUES (?1, ?2, ?3, NULL, ?4, ?5) ON CONFLICT (slug, key) DO UPDATE SET value = excluded.value, blob_key = NULL, updated_by = excluded.updated_by, updated_at = excluded.updated_at"
    )
      .bind(slug, key, text, email, now)
      .run();
    if (existing?.blob_key) await env.BUCKET.delete(existing.blob_key);
  }

  return { kind: "ok", updated_at: now, etag };
}

// Called when an artifact is deleted: drops every `data/<slug>/` object so no
// large sketch value outlives its artifact.
export async function deleteArtifactData(env: Env, slug: string): Promise<number> {
  const prefix = dataBlobPrefix(slug);
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: R2_LIST_LIMIT });
    for (const object of listed.objects) keys.push(object.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  for (let offset = 0; offset < keys.length; offset += R2_DELETE_BATCH) {
    await env.BUCKET.delete(keys.slice(offset, offset + R2_DELETE_BATCH));
  }
  return keys.length;
}
