import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { storeVersion } from "../src/api";
import { getArtifact } from "../src/db";
import { blobKey } from "../src/manifest";
import {
  api,
  createArtifact,
  hashOf,
  INDEX_HTML,
  jsonOf,
  OWNER,
  publishFiles,
  setMode,
  STRANGER,
  uploadBlob,
  VIEWER,
  viewer
} from "./helpers";

function bytesOf(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

describe("manifest storage", () => {
  it("writes each manifest under a unique key", async () => {
    await createArtifact("manifest-doc");
    await publishFiles("manifest-doc", [INDEX_HTML]);
    const row = await env.DB.prepare("SELECT manifest_key FROM versions WHERE slug = ?1 AND n = 1")
      .bind("manifest-doc")
      .first<{ manifest_key: string }>();
    expect(row?.manifest_key).toMatch(/^manifests\/manifest-doc\/1-[a-f0-9]{16}\.json$/);
    expect(await env.BUCKET.head(row?.manifest_key ?? "")).not.toBeNull();
  });

  it("serves the manifest named in versions.manifest_key", async () => {
    await createArtifact("key-doc");
    await publishFiles("key-doc", [INDEX_HTML]);
    await setMode("key-doc", "public");

    const row = await env.DB.prepare("SELECT manifest_key FROM versions WHERE slug = ?1 AND n = 1")
      .bind("key-doc")
      .first<{ manifest_key: string }>();
    const stored = await env.BUCKET.get(row?.manifest_key ?? "");
    expect(stored).not.toBeNull();
    const body = await stored?.text();
    const moved = "manifests/key-doc/moved-by-hand.json";
    await env.BUCKET.put(moved, body ?? "", { httpMetadata: { contentType: "application/json" } });
    await env.BUCKET.delete(row?.manifest_key ?? "");
    await env.DB.prepare("UPDATE versions SET manifest_key = ?2 WHERE slug = ?1 AND n = 1")
      .bind("key-doc", moved)
      .run();

    const res = await viewer("/key-doc/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("hello one");
  });

  it("deletes the manifest from R2 when it loses the publish race", async () => {
    await createArtifact("race-doc");
    const hash = await uploadBlob(INDEX_HTML.body);
    const artifact = await getArtifact(env, "race-doc");
    expect(artifact).not.toBeNull();
    const input = {
      label: "",
      n: 1,
      base: null,
      manifest: { "index.html": { hash, size: bytesOf(INDEX_HTML.body), type: "text/html" } },
      files: 1,
      bytes: bytesOf(INDEX_HTML.body),
      createdBy: OWNER,
      now: new Date().toISOString()
    };

    const first = await storeVersion(env, artifact!, input);
    expect(first.ok).toBe(true);
    const second = await storeVersion(env, artifact!, input);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);

    const listed = await env.BUCKET.list({ prefix: "manifests/race-doc/" });
    expect(listed.objects.length).toBe(1);
  });
});

describe("blob index", () => {
  it("records the real size on upload", async () => {
    const body = "blob index body";
    const hash = await uploadBlob(body);
    const row = await env.DB.prepare("SELECT size FROM blobs WHERE hash = ?1").bind(hash).first<{ size: number }>();
    expect(row?.size).toBe(bytesOf(body));
  });

  it("keeps one row when a blob is uploaded twice", async () => {
    const body = "same bytes twice";
    const hash = await uploadBlob(body);
    await uploadBlob(body);
    const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM blobs WHERE hash = ?1")
      .bind(hash)
      .first<{ total: number }>();
    expect(row?.total).toBe(1);
  });

  it("answers missing checks from the blob index, not R2", async () => {
    const hash = await uploadBlob("index only");
    await env.BUCKET.delete(blobKey(hash));
    const missing = await jsonOf(await api("POST", "/api/blobs/missing", { body: { hashes: [hash] } }));
    expect(missing["missing"]).toEqual([]);
  });

  it("chunks more than 90 hashes per query", async () => {
    const present = await uploadBlob("one present blob");
    const hashes = [present];
    for (let i = 0; i < 149; i += 1) hashes.push(i.toString(16).padStart(64, "0"));
    const missing = await jsonOf(await api("POST", "/api/blobs/missing", { body: { hashes } }));
    expect((missing["missing"] as string[]).length).toBe(149);
    expect((missing["missing"] as string[]).includes(present)).toBe(false);
  });

  it("takes file sizes from the blob index and ignores the client size", async () => {
    await createArtifact("size-doc");
    const indexBody = "<!doctype html><title>size</title><p>sized</p>";
    const hash = await uploadBlob(indexBody);
    const res = await api("POST", "/api/artifacts/size-doc/versions", {
      body: { files: { "index.html": { hash, size: 200 * 1024 * 1024, type: "text/html" } } }
    });
    expect(res.status).toBe(201);
    const version = await jsonOf(res);
    expect(version["bytes"]).toBe(bytesOf(indexBody));

    const row = await env.DB.prepare("SELECT manifest_key FROM versions WHERE slug = ?1 AND n = 1")
      .bind("size-doc")
      .first<{ manifest_key: string }>();
    const object = await env.BUCKET.get(row?.manifest_key ?? "");
    const manifest = (await object?.json()) as Record<string, { size: number }>;
    expect(manifest["index.html"].size).toBe(bytesOf(indexBody));
  });

  it("checks a version with more than 90 distinct blobs", async () => {
    await createArtifact("many-files");
    const files: Record<string, { hash: string; size: number; type: string }> = {};
    for (let i = 0; i < 95; i += 1) {
      const body = `<!doctype html><title>file ${i}</title>`;
      const hash = await uploadBlob(body);
      files[i === 0 ? "index.html" : `page-${i}.html`] = { hash, size: bytesOf(body), type: "text/html" };
    }
    const res = await api("POST", "/api/artifacts/many-files/versions", { body: { files } });
    expect(res.status).toBe(201);
    expect((await jsonOf(res))["files"]).toBe(95);
  });
});

describe("version manifest", () => {
  const expected = async (): Promise<Record<string, { hash: string; size: number; type: string }>> => ({
    "index.html": { hash: await hashOf(INDEX_HTML.body), size: bytesOf(INDEX_HTML.body), type: "text/html" }
  });

  it("returns the manifest to the owner", async () => {
    await createArtifact("manifest-api");
    await publishFiles("manifest-api", [INDEX_HTML]);

    const res = await api("GET", "/api/artifacts/manifest-api/versions/1");
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body["n"]).toBe(1);
    expect(body["created_by"]).toBe(OWNER);
    expect(body["url"]).toBe("https://art.example.com/manifest-api/v1/");
    expect(body["files"]).toEqual(await expected());
  });

  it("returns the manifest to a viewer", async () => {
    await createArtifact("manifest-viewer");
    await publishFiles("manifest-viewer", [INDEX_HTML]);
    await api("PUT", `/api/artifacts/manifest-viewer/shares/${encodeURIComponent(VIEWER)}`, {
      body: { role: "viewer" }
    });

    const res = await api("GET", "/api/artifacts/manifest-viewer/versions/1", { email: VIEWER });
    expect(res.status).toBe(200);
    expect((await jsonOf(res))["files"]).toEqual(await expected());
  });

  it("hides the manifest from someone with no access", async () => {
    await createArtifact("manifest-hidden");
    await publishFiles("manifest-hidden", [INDEX_HTML]);

    const res = await api("GET", "/api/artifacts/manifest-hidden/versions/1", { email: STRANGER });
    expect(res.status).toBe(404);
    expect(await jsonOf(res)).toHaveProperty("error");
  });

  it("is 404 for an unknown artifact or version", async () => {
    await createArtifact("manifest-gaps");
    await publishFiles("manifest-gaps", [INDEX_HTML]);

    expect((await api("GET", "/api/artifacts/no-such-doc/versions/1")).status).toBe(404);
    expect((await api("GET", "/api/artifacts/manifest-gaps/versions/2")).status).toBe(404);
    expect((await api("GET", "/api/artifacts/manifest-gaps/versions/x")).status).toBe(404);
  });
});
