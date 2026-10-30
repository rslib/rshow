import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { api, createArtifact, INDEX_HTML, OWNER, publishFiles, setMode, viewer } from "./helpers";

const MIB = 1024 * 1024;

async function publicDoc(slug: string): Promise<void> {
  await createArtifact(slug);
  await publishFiles(slug, [INDEX_HTML]);
  await setMode(slug, "public");
}

async function putData(slug: string, key: string, value: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return await viewer(`/${slug}/_data/${key}`, OWNER, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ value })
  });
}

async function getData(slug: string, key: string): Promise<Response> {
  return await viewer(`/${slug}/_data/${key}`);
}

interface DataRowShape {
  value: string | null;
  blob_key: string | null;
  updated_by: string;
  updated_at: string;
}

async function rowOf(slug: string, key: string): Promise<DataRowShape | null> {
  return await env.DB.prepare("SELECT value, blob_key, updated_by, updated_at FROM page_data WHERE slug = ?1 AND key = ?2")
    .bind(slug, key)
    .first<DataRowShape>();
}

async function dataObjectKeys(slug: string): Promise<string[]> {
  const listed = await env.BUCKET.list({ prefix: `data/${slug}/` });
  return listed.objects.map((object) => object.key);
}

describe("page data for large sketches", () => {
  it("keeps small sketch values inline in D1", async () => {
    await publicDoc("sketch-small");
    const put = await putData("sketch-small", "sketch-count", { strokes: [1, 2, 3] });
    expect(put.status).toBe(200);
    const putEtag = put.headers.get("etag");
    expect(putEtag).toMatch(/^"[a-f0-9]{64}"$/);

    const row = await rowOf("sketch-small", "sketch-count");
    expect(row?.blob_key).toBeNull();
    expect(JSON.parse(row?.value ?? "null")).toEqual({ strokes: [1, 2, 3] });
    expect(await dataObjectKeys("sketch-small")).toEqual([]);

    const get = await getData("sketch-small", "sketch-count");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({
      value: { strokes: [1, 2, 3] },
      updated_at: row?.updated_at,
      updated_by: OWNER
    });
    expect(get.headers.get("etag")).toBe(putEtag);
  });

  it("moves large sketch values to R2 and keeps value NULL", async () => {
    await publicDoc("sketch-big");
    const value = { paths: ["z".repeat(100 * 1024)] };
    const put = await putData("sketch-big", "sketch-page", value);
    expect(put.status).toBe(200);

    const row = await rowOf("sketch-big", "sketch-page");
    expect(row?.value).toBeNull();
    expect(row?.blob_key).toBe("data/sketch-big/sketch-page.json");

    const object = await env.BUCKET.get("data/sketch-big/sketch-page.json");
    expect(object).not.toBeNull();
    expect(JSON.parse(await object!.text())).toEqual(value);

    const get = await getData("sketch-big", "sketch-page");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ value, updated_at: row?.updated_at, updated_by: OWNER });
    expect(get.headers.get("etag")).toBe(put.headers.get("etag"));
  });

  it("accepts up to 5 MiB on sketch keys and rejects more", async () => {
    await publicDoc("sketch-limit");
    const big = "a".repeat(4 * MIB);
    expect((await putData("sketch-limit", "sketch-blob", big)).status).toBe(200);
    expect((await rowOf("sketch-limit", "sketch-blob"))?.blob_key).toBe("data/sketch-limit/sketch-blob.json");

    const tooBig = await putData("sketch-limit", "sketch-blob", "b".repeat(5 * MIB + 1));
    expect(tooBig.status).toBe(413);
    expect(await tooBig.json()).toEqual({ error: "value too large" });

    const get = await getData("sketch-limit", "sketch-blob");
    expect(get.status).toBe(200);
    const body = (await get.json()) as { value: string };
    expect(body.value.length).toBe(big.length);
  });

  it("keeps the 64 KiB limit for every other key", async () => {
    await publicDoc("sketch-plain");
    expect((await putData("sketch-plain", "notes", "n".repeat(64 * 1024))).status).toBe(413);
    const rejected = await putData("sketch-plain", "notes", "n".repeat(70 * 1024));
    expect(rejected.status).toBe(413);
    expect(await rejected.json()).toEqual({ error: "value too large" });
    expect(await rowOf("sketch-plain", "notes")).toBeNull();

    // "sketch" without the trailing dash is not a sketch key either.
    expect((await putData("sketch-plain", "sketch", "s".repeat(70 * 1024))).status).toBe(413);

    expect((await putData("sketch-plain", "notes", "n".repeat(4 * 1024))).status).toBe(200);
    expect((await rowOf("sketch-plain", "notes"))?.blob_key).toBeNull();
  });

  it("refuses stale If-Match writes with 409", async () => {
    await publicDoc("sketch-etag");
    const first = await putData("sketch-etag", "sketch-note", { n: 1 });
    expect(first.status).toBe(200);
    const etag1 = first.headers.get("etag") ?? "";

    const second = await putData("sketch-etag", "sketch-note", { n: 2 }, { "if-match": etag1 });
    expect(second.status).toBe(200);
    const etag2 = second.headers.get("etag") ?? "";
    expect(etag2).not.toBe(etag1);

    const stale = await putData("sketch-etag", "sketch-note", { n: 3 }, { "if-match": etag1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "etag mismatch" });

    const unknown = await putData("sketch-etag", "sketch-note", { n: 3 }, { "if-match": `"${"0".repeat(64)}"` });
    expect(unknown.status).toBe(409);

    const missing = await putData("sketch-etag", "sketch-other", { n: 1 }, { "if-match": "*" });
    expect(missing.status).toBe(409);

    const current = await getData("sketch-etag", "sketch-note");
    expect(((await current.json()) as { value: unknown }).value).toEqual({ n: 2 });

    const wildcard = await putData("sketch-etag", "sketch-note", { n: 4 }, { "if-match": "*" });
    expect(wildcard.status).toBe(200);
  });

  it("checks If-Match against R2 blobs too", async () => {
    await publicDoc("sketch-etag-big");
    const first = await putData("sketch-etag-big", "sketch-json", "j".repeat(100 * 1024));
    expect(first.status).toBe(200);
    const etag1 = first.headers.get("etag") ?? "";

    expect((await putData("sketch-etag-big", "sketch-json", "k".repeat(100 * 1024), { "if-match": etag1 })).status).toBe(200);
    expect((await putData("sketch-etag-big", "sketch-json", "l".repeat(100 * 1024), { "if-match": etag1 })).status).toBe(409);
  });

  it("deletes data blobs when the artifact is deleted", async () => {
    await createArtifact("sketch-delete");
    expect((await putData("sketch-delete", "sketch-one", "x".repeat(100 * 1024))).status).toBe(200);
    expect((await putData("sketch-delete", "sketch-two", "y".repeat(100 * 1024))).status).toBe(200);
    expect((await dataObjectKeys("sketch-delete")).length).toBe(2);

    const deleted = await api("DELETE", "/api/artifacts/sketch-delete", { email: OWNER });
    expect(deleted.status).toBe(204);

    expect(await dataObjectKeys("sketch-delete")).toEqual([]);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM page_data WHERE slug = ?1").bind("sketch-delete").first<number>("total")
    ).toBe(0);
  });

  it("returns the same GET shape for inline rows written before blobs", async () => {
    await publicDoc("sketch-legacy");
    const now = "2024-01-01T00:00:00.000Z";
    await env.DB.prepare("INSERT INTO page_data (slug, key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind("sketch-legacy", "sketch-old", JSON.stringify({ legacy: true }), "someone@example.com", now)
      .run();

    const get = await getData("sketch-legacy", "sketch-old");
    expect(get.status).toBe(200);
    const body = (await get.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["updated_at", "updated_by", "value"]);
    expect(body).toEqual({ value: { legacy: true }, updated_at: now, updated_by: "someone@example.com" });
    expect(get.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
  });

  it("moves a value back inline and drops the R2 object", async () => {
    await publicDoc("sketch-shrink");
    expect((await putData("sketch-shrink", "sketch-v", "x".repeat(100 * 1024))).status).toBe(200);
    expect(await dataObjectKeys("sketch-shrink")).toEqual(["data/sketch-shrink/sketch-v.json"]);

    expect((await putData("sketch-shrink", "sketch-v", "tiny")).status).toBe(200);
    expect(await dataObjectKeys("sketch-shrink")).toEqual([]);
    const row = await rowOf("sketch-shrink", "sketch-v");
    expect(row?.value).toBe(JSON.stringify("tiny"));
    expect(row?.blob_key).toBeNull();

    const get = await getData("sketch-shrink", "sketch-v");
    expect(((await get.json()) as { value: unknown }).value).toBe("tiny");
  });

  it("counts sketch rows against the 500 key cap", async () => {
    await publicDoc("sketch-capped");
    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (let i = 0; i < 500; i += 1) {
      statements.push(
        env.DB.prepare("INSERT INTO page_data (slug, key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(
          "sketch-capped",
          `sketch-k${i}`,
          "1",
          OWNER,
          now
        )
      );
    }
    await env.DB.batch(statements);

    const res = await putData("sketch-capped", "sketch-extra", "e".repeat(100 * 1024));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "too many keys for this artifact" });
    expect(await dataObjectKeys("sketch-capped")).toEqual([]);

    expect((await putData("sketch-capped", "sketch-k0", "z".repeat(100 * 1024))).status).toBe(200);
  });
});
