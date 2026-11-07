import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { versionCacheKey } from "../src/cache";
import {
  addProjectMember,
  api,
  awaitCachedBlob,
  createArtifact,
  createProject,
  EDITOR,
  hashOf,
  INDEX_HTML,
  OWNER,
  publishFiles,
  readCalls,
  resetCalls,
  setMode,
  VIEWER,
  viewer,
  type FileSpec
} from "./helpers";

const originalDelete = caches.default.delete.bind(caches.default);

const WARM_FILE: FileSpec = {
  path: "index.html",
  body: "<!doctype html><title>warm</title><p>warm file</p>",
  type: "text/html"
};

const SECOND_FILE: FileSpec = {
  path: "index.html",
  body: "<!doctype html><title>warm two</title><p>warm file two</p>",
  type: "text/html"
};

describe("viewer cache", () => {
  it("serves a warm request without D1 or R2 calls", async () => {
    await createArtifact("warm-doc");
    await publishFiles("warm-doc", [WARM_FILE]);
    await setMode("warm-doc", "public");

    const first = await viewer("/warm-doc/");
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("warm file");
    await awaitCachedBlob(await hashOf(WARM_FILE.body));

    resetCalls();
    const second = await viewer("/warm-doc/");
    expect(second.status).toBe(200);
    expect(await second.text()).toContain("warm file");
    expect(readCalls()).toEqual({ d1: 0, r2: 0 });

    resetCalls();
    const pinned = await viewer("/warm-doc/v1/");
    expect(pinned.status).toBe(200);
    expect(await pinned.text()).toContain("warm file");
    expect(readCalls()).toEqual({ d1: 0, r2: 0 });

    await publishFiles("warm-doc", [SECOND_FILE]);
    expect(await (await viewer("/warm-doc/")).text()).toContain("warm file two");
    expect((await viewer("/warm-doc/v1/")).status).toBe(200);

    resetCalls();
    const old = await viewer("/warm-doc/v1/");
    expect(old.status).toBe(200);
    expect(await old.text()).toContain("warm file");
    expect(readCalls()).toEqual({ d1: 0, r2: 0 });
  });

  it("drops the cached version rows when the artifact is deleted", async () => {
    await createArtifact("drop-versions");
    await publishFiles("drop-versions", [WARM_FILE]);
    await publishFiles("drop-versions", [SECOND_FILE]);
    await setMode("drop-versions", "public");
    expect((await viewer("/drop-versions/v1/")).status).toBe(200);

    const key = versionCacheKey("drop-versions", 1, 0);
    expect((await caches.default.match(key)) ?? null).not.toBeNull();

    await api("DELETE", "/api/artifacts/drop-versions", { email: OWNER });
    expect((await caches.default.match(key)) ?? null).toBeNull();
    expect((await viewer("/drop-versions/v1/")).status).toBe(404);
  });

  it("stores the access record and the manifest in the default cache", async () => {
    await createArtifact("cache-record");
    await publishFiles("cache-record", [WARM_FILE]);
    await setMode("cache-record", "public");
    await viewer("/cache-record/");

    const access = await caches.default.match("https://rshow.internal/access/cache-record");
    expect(access).not.toBeNull();
    const row = await env.DB.prepare("SELECT manifest_key FROM versions WHERE slug = ?1 AND n = 1")
      .bind("cache-record")
      .first<{ manifest_key: string }>();
    const manifest = await caches.default.match(`https://rshow.internal/manifest/${row?.manifest_key ?? ""}`);
    expect(manifest).not.toBeNull();
    const blob = await caches.default.match(`https://rshow.internal/blob/${await hashOf(WARM_FILE.body)}`);
    expect(blob).not.toBeNull();
  });

  it("drops the cached access record when the mode changes", async () => {
    await createArtifact("mode-cache");
    await publishFiles("mode-cache", [WARM_FILE]);
    await setMode("mode-cache", "public");
    expect((await viewer("/mode-cache/")).status).toBe(200);

    await setMode("mode-cache", "private");
    expect((await caches.default.match("https://rshow.internal/access/mode-cache")) ?? null).toBeNull();
    expect((await viewer("/mode-cache/")).status).toBe(302);
  });

  it("drops the cached access record when a share is added", async () => {
    await createArtifact("share-cache");
    await publishFiles("share-cache", [WARM_FILE]);
    await setMode("share-cache", "people");
    expect((await viewer("/share-cache/", VIEWER)).status).toBe(403);

    await api("PUT", `/api/artifacts/share-cache/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "viewer" } });
    expect((await viewer("/share-cache/", VIEWER)).status).toBe(200);
  });

  it("drops the cached access record when a version is published", async () => {
    await createArtifact("version-cache");
    await publishFiles("version-cache", [WARM_FILE]);
    await setMode("version-cache", "public");
    expect(await (await viewer("/version-cache/")).text()).toContain("warm file");

    await publishFiles("version-cache", [SECOND_FILE]);
    expect(await (await viewer("/version-cache/")).text()).toContain("warm file two");
  });

  it("drops the cached access record when the artifact is pinned", async () => {
    await createArtifact("pin-cache");
    await publishFiles("pin-cache", [WARM_FILE]);
    await publishFiles("pin-cache", [SECOND_FILE]);
    await setMode("pin-cache", "public");
    expect(await (await viewer("/pin-cache/")).text()).toContain("warm file two");

    await api("PATCH", "/api/artifacts/pin-cache", { email: OWNER, body: { pinned: 1 } });
    expect(await (await viewer("/pin-cache/")).text()).toContain("warm file");
  });

  it("drops the cached access record when the artifact is deleted", async () => {
    await createArtifact("delete-cache");
    await publishFiles("delete-cache", [INDEX_HTML]);
    await setMode("delete-cache", "public");
    expect((await viewer("/delete-cache/")).status).toBe(200);

    await api("DELETE", "/api/artifacts/delete-cache", { email: OWNER });
    expect((await viewer("/delete-cache/")).status).toBe(404);
  });
});

describe("project access cache", () => {
  function accessKey(slug: string): string {
    return `https://rshow.internal/access/${slug}`;
  }

  // Warm the access record of an artifact, then prove the next request is served
  // from the isolate without touching D1.
  async function warm(slug: string, email: string | null): Promise<void> {
    await viewer(`/${slug}/`, email);
    resetCalls();
    await viewer(`/${slug}/`, email);
    expect(readCalls()).toEqual({ d1: 0, r2: 0 });
  }

  // After an invalidation neither the isolate nor the colo cache may answer, so
  // the request has to read D1 again.
  async function reloads(slug: string, email: string | null): Promise<Response> {
    resetCalls();
    const res = await viewer(`/${slug}/`, email);
    expect(readCalls().d1).toBeGreaterThan(0);
    return res;
  }

  function watchDeletes(): string[] {
    const keys: string[] = [];
    const original = caches.default.delete.bind(caches.default);
    caches.default.delete = async (key: RequestInfo | URL) => {
      keys.push(String(key));
      return await original(key);
    };
    return keys;
  }

  function restoreDeletes(): void {
    caches.default.delete = originalDelete;
  }

  async function projectWithArtifacts(slugs: string[]): Promise<void> {
    await createProject("cache-team");
    for (const slug of slugs) {
      await createArtifact(slug);
      await publishFiles(slug, [WARM_FILE]);
      await setMode(slug, "people");
      const moved = await api("PATCH", `/api/artifacts/${slug}`, { email: OWNER, body: { project: "cache-team" } });
      expect(moved.status).toBe(200);
    }
  }

  it("drops every artifact of a project when a member is added", async () => {
    await projectWithArtifacts(["member-a", "member-b"]);
    await warm("member-a", VIEWER);
    await warm("member-b", VIEWER);
    expect((await viewer("/member-a/", VIEWER)).status).toBe(403);

    const deleted = watchDeletes();
    try {
      expect((await addProjectMember("cache-team", VIEWER, "viewer")).status).toBe(200);
      restoreDeletes();
      expect(deleted).toContain(accessKey("member-a"));
      expect(deleted).toContain(accessKey("member-b"));
    } finally {
      restoreDeletes();
    }

    expect((await reloads("member-a", VIEWER)).status).toBe(200);
    expect((await reloads("member-b", VIEWER)).status).toBe(200);
  });

  it("drops every artifact of a project when a member is removed", async () => {
    await projectWithArtifacts(["remove-a", "remove-b"]);
    await addProjectMember("cache-team", EDITOR, "editor");
    await warm("remove-a", EDITOR);
    await warm("remove-b", EDITOR);
    expect((await viewer("/remove-a/", EDITOR)).status).toBe(200);

    const deleted = watchDeletes();
    try {
      expect((await api("DELETE", `/api/projects/cache-team/members/${encodeURIComponent(EDITOR)}`)).status).toBe(204);
      restoreDeletes();
      expect(deleted).toContain(accessKey("remove-a"));
      expect(deleted).toContain(accessKey("remove-b"));
    } finally {
      restoreDeletes();
    }

    expect((await reloads("remove-a", EDITOR)).status).toBe(403);
    expect((await reloads("remove-b", EDITOR)).status).toBe(403);
  });

  it("drops the artifact of a project when a member role changes", async () => {
    await createProject("role-cache-team");
    await createArtifact("role-cache-doc");
    await publishFiles("role-cache-doc", [WARM_FILE]);
    await api("PATCH", "/api/artifacts/role-cache-doc", { body: { project: "role-cache-team" } });
    await addProjectMember("role-cache-team", VIEWER, "viewer");
    await warm("role-cache-doc", VIEWER);
    expect((await viewer("/role-cache-doc/", VIEWER)).status).toBe(403);

    const deleted = watchDeletes();
    try {
      expect((await addProjectMember("role-cache-team", VIEWER, "editor")).status).toBe(200);
      restoreDeletes();
      expect(deleted).toContain(accessKey("role-cache-doc"));
    } finally {
      restoreDeletes();
    }

    expect((await reloads("role-cache-doc", VIEWER)).status).toBe(200);
  });

  it("drops the access record when an artifact moves into and out of a project", async () => {
    await createProject("move-cache-team");
    await addProjectMember("move-cache-team", EDITOR, "editor");
    await createArtifact("move-cache-doc");
    await publishFiles("move-cache-doc", [WARM_FILE]);
    await warm("move-cache-doc", EDITOR);
    expect((await viewer("/move-cache-doc/", EDITOR)).status).toBe(403);

    const intoProject = watchDeletes();
    try {
      expect((await api("PATCH", "/api/artifacts/move-cache-doc", { body: { project: "move-cache-team" } })).status).toBe(200);
      restoreDeletes();
      expect(intoProject).toContain(accessKey("move-cache-doc"));
    } finally {
      restoreDeletes();
    }
    expect((await reloads("move-cache-doc", EDITOR)).status).toBe(200);

    const outOfProject = watchDeletes();
    try {
      expect((await api("PATCH", "/api/artifacts/move-cache-doc", { body: { project: null } })).status).toBe(200);
      restoreDeletes();
      expect(outOfProject).toContain(accessKey("move-cache-doc"));
    } finally {
      restoreDeletes();
    }
    expect((await viewer("/move-cache-doc/", EDITOR)).status).toBe(403);
  });

  it("drops every access record when the project is deleted", async () => {
    await projectWithArtifacts(["delete-a", "delete-b"]);
    await addProjectMember("cache-team", EDITOR, "editor");
    await warm("delete-a", EDITOR);
    await warm("delete-b", EDITOR);
    expect((await viewer("/delete-a/", EDITOR)).status).toBe(200);

    const deleted = watchDeletes();
    try {
      expect((await api("DELETE", "/api/projects/cache-team", { email: OWNER })).status).toBe(204);
      restoreDeletes();
      expect(deleted).toContain(accessKey("delete-a"));
      expect(deleted).toContain(accessKey("delete-b"));
    } finally {
      restoreDeletes();
    }

    expect((await reloads("delete-a", EDITOR)).status).toBe(403);
    expect((await reloads("delete-b", EDITOR)).status).toBe(403);
  });
});

describe("access cache written by another isolate", () => {
  const DIRECT_BODY = "<!doctype html><title>direct</title><p>direct file</p>";

  function accessKey(slug: string): string {
    return `https://rshow.internal/access/${slug}`;
  }

  // The write goes straight to D1 and R2, as a write made by another isolate in
  // the same data center would. Replacing it with an API call would run this
  // isolate's invalidation and hide the bug.
  async function writeElsewhere(slug: string, mode: string): Promise<void> {
    const now = new Date().toISOString();
    const hash = await hashOf(DIRECT_BODY);
    const size = new TextEncoder().encode(DIRECT_BODY).byteLength;
    const manifestKey = `manifests/${slug}/1-direct.json`;
    await env.BUCKET.put(`blobs/${hash}`, DIRECT_BODY, { httpMetadata: { contentType: "text/html" } });
    await env.BUCKET.put(manifestKey, JSON.stringify({ "index.html": { hash, size, type: "text/html" } }));
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO artifacts (slug, title, owner, mode, pinned, latest, last_n, version_gen, project, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, 1, 1, 0, NULL, ?5, ?5)"
      ).bind(slug, slug, OWNER, mode, now),
      env.DB.prepare(
        "INSERT INTO versions (slug, n, label, manifest_key, files, bytes, created_by, created_at) VALUES (?1, 1, '', ?2, 1, ?3, ?4, ?5)"
      ).bind(slug, manifestKey, size, OWNER, now)
    ]);
  }

  async function setModeElsewhere(slug: string, mode: string): Promise<void> {
    await env.DB.prepare("UPDATE artifacts SET mode = ?2, updated_at = ?3 WHERE slug = ?1")
      .bind(slug, mode, new Date().toISOString())
      .run();
  }

  it("serves a page as soon as another isolate publishes it", async () => {
    expect((await viewer("/elsewhere-publish/")).status).toBe(404);
    await writeElsewhere("elsewhere-publish", "public");
    await caches.default.delete(accessKey("elsewhere-publish"));

    const res = await viewer("/elsewhere-publish/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("direct file");
  });

  it("hides a page as soon as another isolate makes it private", async () => {
    await writeElsewhere("elsewhere-private", "public");
    expect((await viewer("/elsewhere-private/")).status).toBe(200);
    await setModeElsewhere("elsewhere-private", "private");
    await caches.default.delete(accessKey("elsewhere-private"));

    expect((await viewer("/elsewhere-private/")).status).not.toBe(200);
  });
});
