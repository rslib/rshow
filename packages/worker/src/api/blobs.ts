import type { Hono } from "hono";
import { sha256Hex } from "../auth";
import { HASH_PATTERN, MAX_BLOB_BYTES, MAX_MISSING_HASHES } from "../constants";
import { blobSizes, recordBlob } from "../db";
import { json, jsonError } from "../http";
import { blobKey } from "../manifest";
import type { AppEnv } from "../types";
import { readBody } from "./common";

export function registerBlobs(app: Hono<AppEnv>): void {
  app.post("/api/blobs/missing", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const hashes = body.body.hashes;
    if (!Array.isArray(hashes)) return jsonError("hashes must be an array", 400);
    if (hashes.length > MAX_MISSING_HASHES) return jsonError(`at most ${MAX_MISSING_HASHES} hashes`, 400);
    for (const hash of hashes) {
      if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) return jsonError("invalid sha256 hash", 400);
    }
    const unique = [...new Set(hashes as string[])];
    const sizes = await blobSizes(c.env, unique);
    const missing = unique.filter((hash) => !sizes.has(hash));
    return json({ missing });
  });

  app.put("/api/blobs/:sha256", async (c) => {
    const hash = c.req.param("sha256");
    if (!HASH_PATTERN.test(hash)) return jsonError("invalid sha256 hash", 400);
    const declared = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BLOB_BYTES) return jsonError("blob is too large", 413);
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > MAX_BLOB_BYTES) return jsonError("blob is too large", 413);
    const actual = await sha256Hex(bytes);
    if (actual !== hash) return jsonError("body does not hash to the given sha256", 400);
    await c.env.BUCKET.put(blobKey(hash), bytes);
    await recordBlob(c.env, hash, bytes.byteLength, new Date().toISOString());
    return new Response(null, { status: 204 });
  });
}
