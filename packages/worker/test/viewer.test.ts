import { describe, expect, it } from "vitest";
import {
  api,
  createArtifact,
  EDITOR,
  INDEX_HTML,
  OWNER,
  publishFiles,
  setMode,
  STRANGER,
  VIEWER,
  viewer
} from "./helpers";

const SECOND_HTML = {
  path: "index.html",
  body: "<!doctype html><title>two</title><p>hello two</p>",
  type: "text/html"
};

async function publicDoc(slug: string): Promise<void> {
  await createArtifact(slug);
  await publishFiles(slug, [INDEX_HTML]);
  await setMode(slug, "public");
}

describe("viewer routing", () => {
  it("redirects /<slug> to /<slug>/", async () => {
    await publicDoc("redirect-doc");
    const res = await viewer("/redirect-doc");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/redirect-doc/");
  });

  it("adds a trailing slash when <path>/index.html exists", async () => {
    await createArtifact("slash-doc");
    await publishFiles("slash-doc", [INDEX_HTML, { path: "sub/index.html", body: "<p>sub</p>", type: "text/html" }]);
    await setMode("slash-doc", "public");
    const res = await viewer("/slash-doc/sub");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/slash-doc/sub/");
  });

  it("serves index.html for a directory", async () => {
    await createArtifact("dir-doc");
    await publishFiles("dir-doc", [INDEX_HTML, { path: "sub/index.html", body: "<p>sub page</p>", type: "text/html" }]);
    await setMode("dir-doc", "public");
    const res = await viewer("/dir-doc/sub/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("sub page");
  });

  it("404s unknown files and slugs", async () => {
    await publicDoc("known-doc");
    expect((await viewer("/known-doc/missing.html")).status).toBe(404);
    expect((await viewer("/no-such-slug/")).status).toBe(404);
    expect((await viewer("/")).status).toBe(404);
  });

  it("rejects encoded traversal", async () => {
    await publicDoc("safe-doc");
    expect((await viewer("/safe-doc/%2e%2e/%2e%2e/etc/passwd")).status).toBe(404);
  });
});

describe("viewer access", () => {
  it("serves a public artifact to anonymous visitors", async () => {
    await publicDoc("public-doc");
    const res = await viewer("/public-doc/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=15, must-revalidate");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self' https://artd.example.com");
    expect(csp).toContain("https://cdnjs.cloudflare.com");
    expect(await res.text()).toContain("hello one");
  });

  it("returns 302 to the login for anonymous visitors of a private artifact", async () => {
    await createArtifact("private-doc");
    await publishFiles("private-doc", [INDEX_HTML]);
    const res = await viewer("/private-doc/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/_auth/login?next=%2Fprivate-doc%2F");
  });

  it("returns 403 naming the signed-in email for a non-viewer", async () => {
    await createArtifact("closed-doc");
    await publishFiles("closed-doc", [INDEX_HTML]);
    const res = await viewer("/closed-doc/", STRANGER);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain(STRANGER);
  });

  it("lets an editor in for a private artifact and a viewer not", async () => {
    await createArtifact("editor-doc");
    await publishFiles("editor-doc", [INDEX_HTML]);
    await api("PUT", `/api/artifacts/editor-doc/shares/${encodeURIComponent(EDITOR)}`, { body: { role: "editor" } });
    await api("PUT", `/api/artifacts/editor-doc/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "viewer" } });
    expect((await viewer("/editor-doc/", EDITOR)).status).toBe(200);
    expect((await viewer("/editor-doc/", VIEWER)).status).toBe(403);
    await setMode("editor-doc", "people");
    expect((await viewer("/editor-doc/", VIEWER)).status).toBe(200);
  });

  it("serves the pinned version on the live url", async () => {
    await createArtifact("pinned-doc");
    await publishFiles("pinned-doc", [INDEX_HTML]);
    await publishFiles("pinned-doc", [SECOND_HTML]);
    await setMode("pinned-doc", "public");

    expect(await (await viewer("/pinned-doc/")).text()).toContain("hello two");
    expect(await (await viewer("/pinned-doc/v1/")).text()).toContain("hello one");
    expect(await (await viewer("/pinned-doc/v2/")).text()).toContain("hello two");

    await api("PATCH", "/api/artifacts/pinned-doc", { body: { pinned: 1 } });
    expect(await (await viewer("/pinned-doc/")).text()).toContain("hello one");

    const versioned = await viewer("/pinned-doc/v2/");
    expect(versioned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable, s-maxage=300");
  });

  it("sends private caching headers for a non-public artifact", async () => {
    await createArtifact("nocache-doc");
    await publishFiles("nocache-doc", [INDEX_HTML]);
    const res = await viewer("/nocache-doc/", OWNER);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("answers 304 for a matching If-None-Match", async () => {
    await publicDoc("etag-doc");
    const first = await viewer("/etag-doc/");
    const etag = first.headers.get("etag") ?? "";
    expect(etag.startsWith('"')).toBe(true);
    const second = await viewer("/etag-doc/", null, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
  });
});

describe("_auth/login", () => {
  it("follows a safe next", async () => {
    const res = await viewer("/_auth/login?next=%2Fsome%2Fpage%3Fa%3D1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/some/page?a=1");
  });

  it("refuses open redirects", async () => {
    for (const next of [
      "//evil.com",
      "%2F%5Cevil.com",
      "https://evil.com",
      "/%09/evil.com",
      "/%0A/evil.com",
      "/%0D/evil.com",
      "%2F%2F%2Fevil.com"
    ]) {
      const res = await viewer(`/_auth/login?next=${next}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
    }
  });
});

describe("_data", () => {
  it("stores and reads values for viewers", async () => {
    await publicDoc("data-doc");
    const put = await viewer("/data-doc/_data/count", OWNER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: { hits: 3 } })
    });
    expect(put.status).toBe(200);

    const get = await viewer("/data-doc/_data/count");
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ value: { hits: 3 }, updated_by: OWNER });
    expect(get.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);

    expect((await viewer("/data-doc/_data/missing")).status).toBe(404);
  });

  it("requires a signed-in viewer to write", async () => {
    await publicDoc("data-anon-doc");
    const res = await viewer("/data-anon-doc/_data/x", null, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 })
    });
    expect(res.status).toBe(403);
  });

  it("refuses writes on artifacts you cannot view", async () => {
    await createArtifact("data-private");
    const res = await viewer("/data-private/_data/x", STRANGER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 })
    });
    expect(res.status).toBe(403);
    const get = await viewer("/data-private/_data/x");
    expect(get.status).toBe(302);
  });

  it("enforces json content type and the 64 KiB limit", async () => {
    await publicDoc("data-limit");
    const wrongType = await viewer("/data-limit/_data/k", OWNER, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ value: 1 })
    });
    expect(wrongType.status).toBe(415);

    const tooBig = await viewer("/data-limit/_data/k", OWNER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(70 * 1024) })
    });
    expect(tooBig.status).toBe(413);

    const badKey = await viewer("/data-limit/_data/bad!key", OWNER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 })
    });
    expect(badKey.status).toBe(404);
  });

  it("caps the number of keys at 500", async () => {
    await createArtifact("data-keys");
    await setMode("data-keys", "public");
    const statements: D1PreparedStatement[] = [];
    const db = (await import("cloudflare:test")).env.DB;
    const now = new Date().toISOString();
    for (let i = 0; i < 500; i += 1) {
      statements.push(
        db
          .prepare("INSERT INTO page_data (slug, key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
          .bind("data-keys", `k${i}`, "1", OWNER, now)
      );
    }
    await db.batch(statements);

    const res = await viewer("/data-keys/_data/one-more", OWNER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 })
    });
    expect(res.status).toBe(409);

    const update = await viewer("/data-keys/_data/k0", OWNER, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 2 })
    });
    expect(update.status).toBe(200);
  });
});
