import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { invalidateAccess, versionCacheKey } from "../src/cache";
import type { VersionRow } from "../src/types";
import {
  EDITOR,
  INDEX_HTML,
  OWNER,
  STRANGER,
  VIEWER,
  api,
  createArtifact,
  jsonOf,
  publishFiles,
  setMode,
  viewer
} from "./helpers";

const SECOND_HTML = {
  path: "index.html",
  body: "<!doctype html><title>two</title><p>hello two</p>",
  type: "text/html"
};

const THIRD_HTML = {
  path: "index.html",
  body: "<!doctype html><title>three</title><p>hello three</p>",
  type: "text/html"
};

function page(path: string): Promise<Response> {
  return viewer(path, OWNER);
}

async function bumpedVersionGen(slug: string): Promise<number> {
  const row = await env.DB.prepare("SELECT version_gen FROM artifacts WHERE slug = ?1")
    .bind(slug)
    .first<{ version_gen: number }>();
  return row?.version_gen ?? 0;
}

describe("delete one version", () => {
  it("serves the version below the newest after a delete and never reuses its number", async () => {
    await createArtifact("drop-last");
    await publishFiles("drop-last", [INDEX_HTML]);
    await publishFiles("drop-last", [SECOND_HTML]);
    await publishFiles("drop-last", [THIRD_HTML]);

    const deleted = await api("DELETE", "/api/artifacts/drop-last/versions/3");
    expect(deleted.status).toBe(200);
    const body = await jsonOf(deleted);
    expect(body["latest"]).toBe(2);
    expect(body["served"]).toBe(2);
    expect(body["slug"]).toBe("drop-last");

    expect((await page("/drop-last/v3/")).status).toBe(404);
    expect((await page("/drop-last/v2/")).status).toBe(200);

    const next = await publishFiles("drop-last", [INDEX_HTML]);
    expect(next.status).toBe(201);
    expect((await jsonOf(next))["n"]).toBe(4);
    expect((await page("/drop-last/v3/")).status).toBe(404);
    expect((await page("/drop-last/v4/")).status).toBe(200);
  });

  it("keeps the other versions and a shared file when a middle version goes", async () => {
    await createArtifact("drop-middle");
    await publishFiles("drop-middle", [INDEX_HTML]);
    await publishFiles("drop-middle", [SECOND_HTML]);
    await publishFiles("drop-middle", [THIRD_HTML]);

    const res = await api("DELETE", "/api/artifacts/drop-middle/versions/2");
    expect(res.status).toBe(200);
    expect((await jsonOf(res))["served"]).toBe(3);

    expect((await page("/drop-middle/v2/")).status).toBe(404);
    expect((await page("/drop-middle/v1/")).status).toBe(200);
    expect((await page("/drop-middle/v3/")).status).toBe(200);
    expect(await (await page("/drop-middle/v1/")).text()).toContain("hello one");
  });

  it("refuses a pinned version, the only version, strangers, and an unknown version", async () => {
    await createArtifact("drop-guards");
    await publishFiles("drop-guards", [INDEX_HTML]);

    const only = await api("DELETE", "/api/artifacts/drop-guards/versions/1");
    expect(only.status).toBe(409);
    expect((await jsonOf(only))["error"]).toContain("this is the only version");

    await publishFiles("drop-guards", [SECOND_HTML]);
    await api("PATCH", "/api/artifacts/drop-guards", { body: { pinned: 2 } });
    const pinned = await api("DELETE", "/api/artifacts/drop-guards/versions/2");
    expect(pinned.status).toBe(409);
    expect((await jsonOf(pinned))["error"]).toContain("is pinned");

    await api("PATCH", "/api/artifacts/drop-guards", { body: { pinned: null } });
    expect((await api("DELETE", "/api/artifacts/drop-guards/versions/9")).status).toBe(404);

    const stranger = await api("DELETE", "/api/artifacts/drop-guards/versions/1", { email: STRANGER });
    expect([403, 404]).toContain(stranger.status);

    await api("PUT", `/api/artifacts/drop-guards/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "viewer" } });
    await api("PUT", `/api/artifacts/drop-guards/shares/${encodeURIComponent(EDITOR)}`, { body: { role: "editor" } });
    expect((await api("DELETE", "/api/artifacts/drop-guards/versions/1", { email: VIEWER })).status).toBe(403);
    expect((await api("DELETE", "/api/artifacts/drop-guards/versions/1", { email: EDITOR })).status).toBe(403);

    const token = (await jsonOf(await api("POST", "/api/tokens", { body: { name: "pub", scope: "publish" } })))[
      "token"
    ] as string;
    const scoped = await api("DELETE", "/api/artifacts/drop-guards/versions/1", { email: null, token });
    expect(scoped.status).toBe(403);
  });

  it("needs force for a theme version and for a theme artifact", async () => {
    await api("POST", "/api/artifacts", { body: { slug: "theme-guarded" } });
    await publishFiles("theme-guarded", [INDEX_HTML]);
    await publishFiles("theme-guarded", [SECOND_HTML]);

    const plain = await api("DELETE", "/api/artifacts/theme-guarded/versions/2");
    expect(plain.status).toBe(409);
    expect((await jsonOf(plain))["error"]).toContain("pass force");

    const forced = await api("DELETE", "/api/artifacts/theme-guarded/versions/2?force=1");
    expect(forced.status).toBe(200);
    expect((await jsonOf(forced))["served"]).toBe(1);

    const whole = await api("DELETE", "/api/artifacts/theme-guarded");
    expect(whole.status).toBe(409);
    expect((await jsonOf(whole))["error"]).toContain("pass force");
    expect((await api("DELETE", "/api/artifacts/theme-guarded?force=1")).status).toBe(204);
  });

  it("does not serve a deleted version from the cache of another data center", async () => {
    await createArtifact("drop-cached");
    await publishFiles("drop-cached", [INDEX_HTML]);
    await publishFiles("drop-cached", [SECOND_HTML]);
    await publishFiles("drop-cached", [THIRD_HTML]);
    await setMode("drop-cached", "public");

    // v2 must not be the served version, else the access record answers and versionFor never runs.
    expect((await page("/drop-cached/v2/")).status).toBe(200);

    await env.DB.batch([
      env.DB.prepare("DELETE FROM versions WHERE slug = ?1 AND n = ?2").bind("drop-cached", 2),
      env.DB.prepare("UPDATE artifacts SET version_gen = version_gen + 1 WHERE slug = ?1").bind("drop-cached")
    ]);
    expect(await bumpedVersionGen("drop-cached")).toBe(1);
    await invalidateAccess("drop-cached");

    expect((await page("/drop-cached/v2/")).status).toBe(404);
  });

  it("keeps the version counter above the newest after the migration", async () => {
    await createArtifact("drop-counter");
    await publishFiles("drop-counter", [INDEX_HTML]);
    await env.DB.prepare("UPDATE artifacts SET last_n = 0, latest = 5 WHERE slug = ?1").bind("drop-counter").run();

    const next = await publishFiles("drop-counter", [SECOND_HTML]);
    expect(next.status).toBe(201);
    expect((await jsonOf(next))["n"]).toBe(6);
  });

  it("records the published number as last_n", async () => {
    await createArtifact("drop-lastn");
    await publishFiles("drop-lastn", [INDEX_HTML]);
    await publishFiles("drop-lastn", [SECOND_HTML]);
    await publishFiles("drop-lastn", [THIRD_HTML]);
    await api("DELETE", "/api/artifacts/drop-lastn/versions/3");

    const row = await env.DB.prepare("SELECT latest, last_n FROM artifacts WHERE slug = ?1")
      .bind("drop-lastn")
      .first<{ latest: number; last_n: number }>();
    expect(row?.latest).toBe(2);
    expect(row?.last_n).toBe(3);

    expect((await publishFiles("drop-lastn", [INDEX_HTML], OWNER)).status).toBe(201);
  });
});

describe("a recreated slug never reuses a version number", () => {
  it("continues from the highest number after the whole artifact is deleted", async () => {
    await createArtifact("recreate-one");
    await publishFiles("recreate-one", [INDEX_HTML]);
    await publishFiles("recreate-one", [SECOND_HTML]);

    expect((await page("/recreate-one/v1/")).status).toBe(200);
    expect(await (await page("/recreate-one/v1/")).text()).toContain("hello one");

    expect((await api("DELETE", "/api/artifacts/recreate-one")).status).toBe(204);
    expect((await page("/recreate-one/v1/")).status).toBe(404);

    expect((await createArtifact("recreate-one")).status).toBe(201);
    const next = await publishFiles("recreate-one", [THIRD_HTML]);
    expect(next.status).toBe(201);
    expect((await jsonOf(next))["n"]).toBe(3);

    expect((await page("/recreate-one/v1/")).status).toBe(404);
    expect(await (await page("/recreate-one/")).text()).toContain("hello three");
  });

  it("does not serve the old version from the cache of another data center after a recreate", async () => {
    await createArtifact("recreate-cached");
    await publishFiles("recreate-cached", [INDEX_HTML]);
    await setMode("recreate-cached", "public");
    expect((await page("/recreate-cached/v1/")).status).toBe(200);

    const oldRow = await env.DB.prepare(
      "SELECT slug, n, label, manifest_key, files, bytes, created_by, created_at FROM versions WHERE slug = ?1 AND n = ?2"
    )
      .bind("recreate-cached", 1)
      .first<VersionRow>();
    if (!oldRow) throw new Error("version 1 was not stored");
    const oldGen = await bumpedVersionGen("recreate-cached");

    expect((await api("DELETE", "/api/artifacts/recreate-cached")).status).toBe(204);
    expect((await createArtifact("recreate-cached")).status).toBe(201);
    const published = await publishFiles("recreate-cached", [SECOND_HTML]);
    expect(published.status).toBe(201);

    // v1 must not be the served version, else the access record answers and versionFor never runs.
    const current = await env.DB.prepare("SELECT COALESCE(pinned, latest) AS served FROM artifacts WHERE slug = ?1")
      .bind("recreate-cached")
      .first<{ served: number | null }>();
    expect(current?.served).not.toBe(1);

    await caches.default.put(
      versionCacheKey("recreate-cached", 1, oldGen),
      new Response(JSON.stringify(oldRow), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=31536000, immutable" }
      })
    );

    await setMode("recreate-cached", "public");
    await invalidateAccess("recreate-cached");

    expect((await page("/recreate-cached/v1/")).status).toBe(404);
    expect(await bumpedVersionGen("recreate-cached")).toBeGreaterThan(oldGen);
  });

  it("keeps counting up over a delete, create, delete, create and publish", async () => {
    await createArtifact("recreate-twice");
    await publishFiles("recreate-twice", [INDEX_HTML]);
    await publishFiles("recreate-twice", [SECOND_HTML]);

    expect((await api("DELETE", "/api/artifacts/recreate-twice")).status).toBe(204);
    expect((await createArtifact("recreate-twice")).status).toBe(201);
    expect((await jsonOf(await publishFiles("recreate-twice", [THIRD_HTML])))["n"]).toBe(3);

    expect((await api("DELETE", "/api/artifacts/recreate-twice")).status).toBe(204);
    expect((await createArtifact("recreate-twice")).status).toBe(201);
    expect((await jsonOf(await publishFiles("recreate-twice", [INDEX_HTML])))["n"]).toBe(4);

    expect((await page("/recreate-twice/v3/")).status).toBe(404);
    expect((await page("/recreate-twice/v4/")).status).toBe(200);
  });

  it("starts a slug deleted with no version published at v1", async () => {
    expect((await createArtifact("recreate-empty")).status).toBe(201);
    expect((await api("DELETE", "/api/artifacts/recreate-empty")).status).toBe(204);
    expect((await createArtifact("recreate-empty")).status).toBe(201);

    expect((await jsonOf(await publishFiles("recreate-empty", [INDEX_HTML])))["n"]).toBe(1);
  });

  it("starts a fresh slug at v1", async () => {
    expect((await createArtifact("recreate-fresh")).status).toBe(201);

    expect((await jsonOf(await publishFiles("recreate-fresh", [INDEX_HTML])))["n"]).toBe(1);
  });

  it("returns the same artifact shape from the create", async () => {
    await createArtifact("recreate-shape");
    await publishFiles("recreate-shape", [INDEX_HTML]);
    await api("DELETE", "/api/artifacts/recreate-shape");

    const created = await createArtifact("recreate-shape");
    expect(created.status).toBe(201);
    const body = await jsonOf(created);
    expect(Object.keys(body).sort()).toEqual([
      "latest",
      "mode",
      "owner",
      "pinned",
      "project",
      "role",
      "served",
      "slug",
      "tags",
      "title",
      "updated_at",
      "url"
    ]);
    expect(body["last_n"]).toBeUndefined();
    expect(body["version_gen"]).toBeUndefined();
  });
});
