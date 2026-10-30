import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { sha256Hex } from "../src/auth";
import {
  ARTD,
  createArtifact,
  hashOf,
  INDEX_HTML,
  jsonOf,
  OWNER,
  publishFiles,
  setMode,
  STRANGER,
  api,
  uploadBlob
} from "./helpers";

const HASH_404 = "f".repeat(64);

describe("identity and me", () => {
  it("returns the dev identity", async () => {
    const res = await api("GET", "/api/me");
    expect(res.status).toBe(200);
    expect(await jsonOf(res)).toEqual({ email: OWNER, scope: "full" });
  });

  it("is 401 without any identity", async () => {
    const res = await api("GET", "/api/me", { email: null });
    expect(res.status).toBe(401);
    expect(await jsonOf(res)).toHaveProperty("error");
  });
});

describe("csrf and origin", () => {
  it("rejects a cookie POST without Origin", async () => {
    const res = await api("POST", "/api/artifacts", {
      email: OWNER,
      body: { slug: "csrf-one" },
      omitOrigin: true
    });
    expect(res.status).toBe(403);
  });

  it("rejects a cookie POST with the wrong Origin", async () => {
    const res = await api("POST", "/api/artifacts", {
      email: OWNER,
      body: { slug: "csrf-two" },
      headers: { origin: "https://evil.example.com" }
    });
    expect(res.status).toBe(403);
  });

  it("rejects a cookie POST without a json content type", async () => {
    const res = await api("POST", "/api/artifacts", {
      email: OWNER,
      body: { slug: "csrf-three" },
      omitContentType: true
    });
    expect(res.status).toBe(403);
  });

  it("accepts a cookie POST with the right Origin", async () => {
    const res = await api("POST", "/api/artifacts", { email: OWNER, body: { slug: "csrf-four" } });
    expect(res.status).toBe(201);
  });

  it("lets bearer requests skip the origin check", async () => {
    const created = await api("POST", "/api/tokens", { body: { name: "cli", scope: "publish" } });
    const token = (await jsonOf(created))["token"] as string;
    const res = await api("POST", "/api/artifacts", {
      email: null,
      token,
      body: { slug: "csrf-five" },
      omitOrigin: true
    });
    expect(res.status).toBe(201);
  });

  it("accepts a bearer blob upload with a raw body", async () => {
    const body = "raw bytes";
    const hash = await hashOf(body);
    const res = await api("PUT", `/api/blobs/${hash}`, { raw: body, omitContentType: true });
    expect(res.status).toBe(204);
  });

  it("requires the right origin for a cookie blob upload", async () => {
    const body = "cookie bytes";
    const hash = await hashOf(body);
    const bad = await api("PUT", `/api/blobs/${hash}`, { raw: body, omitContentType: true, omitOrigin: true });
    expect(bad.status).toBe(403);
    const good = await api("PUT", `/api/blobs/${hash}`, { raw: body, omitContentType: true });
    expect(good.status).toBe(204);
  });
});

describe("tokens", () => {
  it("refuses bearer auth on the token endpoints", async () => {
    const created = await api("POST", "/api/tokens", { body: { name: "self", scope: "full" } });
    const token = (await jsonOf(created))["token"] as string;
    const list = await api("GET", "/api/tokens", { email: null, token });
    expect(list.status).toBe(403);
    const post = await api("POST", "/api/tokens", { email: null, token, body: { name: "x", scope: "full" } });
    expect(post.status).toBe(403);
  });

  it("refuses bearer auth on the tokens UI", async () => {
    const created = await api("POST", "/api/tokens", { body: { name: "ui", scope: "full" } });
    const token = (await jsonOf(created))["token"] as string;
    const res = await api("GET", "/tokens", { email: null, token });
    expect(res.status).toBe(404);
  });

  it("creates, lists and revokes a token", async () => {
    const created = await api("POST", "/api/tokens", { body: { name: "laptop", scope: "publish" } });
    expect(created.status).toBe(201);
    const body = await jsonOf(created);
    const token = body["token"] as string;
    expect(token.startsWith("rsh_")).toBe(true);
    expect(token.length).toBe(47);
    expect(await sha256Hex(token)).toBe(body["id"]);

    const listed = await jsonOf(await api("GET", "/api/tokens"));
    expect((listed["tokens"] as unknown[]).length).toBe(1);

    const me = await api("GET", "/api/me", { email: null, token });
    expect(await jsonOf(me)).toEqual({ email: OWNER, scope: "publish" });

    const revoked = await api("DELETE", `/api/tokens/${body["id"] as string}`);
    expect(revoked.status).toBe(204);
    const after = await api("GET", "/api/me", { email: null, token });
    expect(after.status).toBe(401);
  });

  it("rejects an unknown token", async () => {
    const res = await api("GET", "/api/me", { email: null, token: `rsh_${"a".repeat(43)}` });
    expect(res.status).toBe(401);
  });

  it("only writes last_used_at when it is null or older than an hour", async () => {
    const created = await jsonOf(await api("POST", "/api/tokens", { body: { name: "clock", scope: "full" } }));
    const token = created["token"] as string;
    const id = created["id"] as string;

    await api("GET", "/api/me", { email: null, token });
    const first = await env.DB.prepare("SELECT last_used_at FROM tokens WHERE hash = ?1")
      .bind(id)
      .first<{ last_used_at: string }>();
    expect(first?.last_used_at).not.toBeNull();

    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await env.DB.prepare("UPDATE tokens SET last_used_at = ?2 WHERE hash = ?1").bind(id, recent).run();
    await api("GET", "/api/me", { email: null, token });
    const unchanged = await env.DB.prepare("SELECT last_used_at FROM tokens WHERE hash = ?1")
      .bind(id)
      .first<{ last_used_at: string }>();
    expect(unchanged?.last_used_at).toBe(recent);

    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare("UPDATE tokens SET last_used_at = ?2 WHERE hash = ?1").bind(id, old).run();
    await api("GET", "/api/me", { email: null, token });
    const refreshed = await env.DB.prepare("SELECT last_used_at FROM tokens WHERE hash = ?1")
      .bind(id)
      .first<{ last_used_at: string }>();
    expect(Date.parse(refreshed?.last_used_at ?? "")).toBeGreaterThan(Date.parse(old));
  });
});

describe("publish flow", () => {
  it("runs end to end", async () => {
    const created = await createArtifact("flow-demo", OWNER, "Flow demo");
    expect(created.status).toBe(201);
    const artifact = await jsonOf(created);
    expect(artifact["mode"]).toBe("private");
    expect(artifact["url"]).toBe("https://art.example.com/flow-demo/");
    expect(artifact["role"]).toBe("owner");

    const indexBody = "<!doctype html><title>flow</title><p>flow demo</p>";
    const indexHash = await hashOf(indexBody);
    const styleBody = "body{color:rebeccapurple}";
    const styleHash = await hashOf(styleBody);

    const missing = await jsonOf(
      await api("POST", "/api/blobs/missing", { body: { hashes: [indexHash, styleHash, HASH_404] } })
    );
    expect(missing["missing"]).toEqual([indexHash, styleHash, HASH_404]);

    const wrong = await api("PUT", `/api/blobs/${HASH_404}`, { raw: "not that hash", omitContentType: true });
    expect(wrong.status).toBe(400);

    const noIndex = await api("POST", "/api/artifacts/flow-demo/versions", {
      body: { files: { "style.css": { hash: styleHash, size: 16, type: "text/css" } } }
    });
    expect(noIndex.status).toBe(400);

    const missingBlob = await api("POST", "/api/artifacts/flow-demo/versions", {
      body: { files: { "index.html": { hash: HASH_404, size: 10, type: "text/html" } } }
    });
    expect(missingBlob.status).toBe(400);

    await uploadBlob(indexBody);
    await uploadBlob(styleBody);

    const stillMissing = await jsonOf(await api("POST", "/api/blobs/missing", { body: { hashes: [indexHash, styleHash] } }));
    expect(stillMissing["missing"]).toEqual([]);

    const published = await api("POST", "/api/artifacts/flow-demo/versions", {
      body: {
        label: "first",
        files: {
          "index.html": { hash: indexHash, size: indexBody.length, type: "text/html" },
          "style.css": { hash: styleHash, size: styleBody.length, type: "text/css" }
        }
      }
    });
    expect(published.status).toBe(201);
    const version = await jsonOf(published);
    expect(version["n"]).toBe(1);
    expect(version["label"]).toBe("first");
    expect(version["files"]).toBe(2);
    expect(version["url"]).toBe("https://art.example.com/flow-demo/v1/");

    const detail = await jsonOf(await api("GET", "/api/artifacts/flow-demo"));
    expect(detail["latest"]).toBe(1);
    expect(detail["served"]).toBe(1);
    expect((detail["versions"] as unknown[]).length).toBe(1);

    const second = await jsonOf(
      await api("POST", "/api/artifacts/flow-demo/versions", {
        body: { files: { "index.html": { hash: indexHash, size: indexBody.length, type: "text/html" } } }
      })
    );
    expect(second["n"]).toBe(2);
  });

  it("rejects traversal and malformed paths", async () => {
    await createArtifact("traverse");
    const hash = await uploadBlob(INDEX_HTML.body);
    for (const path of ["../x", "/x", "a//b", "a\\b"]) {
      const res = await api("POST", "/api/artifacts/traverse/versions", {
        body: {
          files: {
            "index.html": { hash, size: 10, type: "text/html" },
            [path]: { hash, size: 10, type: "text/javascript" }
          }
        }
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects a taken slug", async () => {
    expect((await createArtifact("taken-slug")).status).toBe(201);
    expect((await createArtifact("taken-slug", STRANGER)).status).toBe(409);
  });

  it("lets a viewer read but not publish", async () => {
    await createArtifact("shared-doc");
    await api("PUT", `/api/artifacts/shared-doc/shares/${encodeURIComponent("viewer@example.com")}`, {
      body: { role: "viewer" }
    });
    expect((await api("GET", "/api/artifacts/shared-doc", { email: "viewer@example.com" })).status).toBe(200);
    const res = await api("POST", "/api/artifacts/shared-doc/versions", {
      email: "viewer@example.com",
      body: { files: { "index.html": { hash: (await hashOf(INDEX_HTML.body)), size: 10, type: "text/html" } } }
    });
    expect(res.status).toBe(403);
  });

  it("hides artifacts you cannot see", async () => {
    await createArtifact("hidden-doc");
    expect((await api("GET", "/api/artifacts/hidden-doc", { email: STRANGER })).status).toBe(404);
    const list = await jsonOf(await api("GET", "/api/artifacts", { email: STRANGER }));
    expect(list["artifacts"]).toEqual([]);
  });

  it("limits pin, mode and delete to the owner with a full scope", async () => {
    await createArtifact("own-doc");
    await publishFiles("own-doc", [INDEX_HTML]);

    const pinPublishToken = await jsonOf(await api("POST", "/api/tokens", { body: { name: "p", scope: "publish" } }));
    const publishToken = pinPublishToken["token"] as string;
    const denied = await api("PATCH", "/api/artifacts/own-doc", {
      email: null,
      token: publishToken,
      body: { pinned: 1 }
    });
    expect(denied.status).toBe(403);

    const badPin = await api("PATCH", "/api/artifacts/own-doc", { body: { pinned: 99 } });
    expect(badPin.status).toBe(400);

    const ok = await jsonOf(await api("PATCH", "/api/artifacts/own-doc", { body: { pinned: 1, mode: "public" } }));
    expect(ok["pinned"]).toBe(1);
    expect(ok["mode"]).toBe("public");
    expect(ok["served"]).toBe(1);

    await setMode("own-doc", "people");

    const deleted = await api("DELETE", "/api/artifacts/own-doc");
    expect(deleted.status).toBe(204);
    expect((await api("GET", "/api/artifacts/own-doc")).status).toBe(404);

    const manifests = await env.BUCKET.list({ prefix: "manifests/own-doc/" });
    expect(manifests.objects.length).toBe(0);
  });

  it("changes a share role and removes it", async () => {
    await createArtifact("share-doc");
    const email = encodeURIComponent("pal@example.com");
    expect(await jsonOf(await api("PUT", `/api/artifacts/share-doc/shares/${email}`, { body: { role: "viewer" } }))).toEqual({
      email: "pal@example.com",
      role: "viewer"
    });
    expect(await jsonOf(await api("PUT", `/api/artifacts/share-doc/shares/${email}`, { body: { role: "editor" } }))).toEqual({
      email: "pal@example.com",
      role: "editor"
    });
    const detail = await jsonOf(await api("GET", "/api/artifacts/share-doc"));
    expect(detail["shares"]).toEqual([{ email: "pal@example.com", role: "editor" }]);
    expect((await api("DELETE", `/api/artifacts/share-doc/shares/${email}`)).status).toBe(204);
    const after = await jsonOf(await api("GET", "/api/artifacts/share-doc"));
    expect(after["shares"]).toEqual([]);
  });

  it("rejects bad share roles and emails", async () => {
    await createArtifact("bad-share");
    expect(
      (await api("PUT", `/api/artifacts/bad-share/shares/${encodeURIComponent("a@b.com")}`, { body: { role: "owner" } }))
        .status
    ).toBe(400);
    expect(
      (await api("PUT", "/api/artifacts/bad-share/shares/notanemail", { body: { role: "viewer" } })).status
    ).toBe(400);
  });
});

describe("host routing", () => {
  it("404s an unknown host", async () => {
    const { SELF } = await import("cloudflare:test");
    const res = await SELF.fetch("https://elsewhere.example.com/api/me", { headers: { "x-dev-email": OWNER } });
    expect(res.status).toBe(404);
  });

  it("does not serve admin paths on the art host", async () => {
    const { viewer } = await import("./helpers");
    expect((await viewer("/api/me")).status).toBe(404);
    expect((await viewer("/tokens")).status).toBe(404);
    expect((await viewer("/static/app.css")).status).toBe(404);
  });
});

describe("admin ui", () => {
  it("renders the gallery", async () => {
    await createArtifact("gallery-item", OWNER, "Gallery <b>item</b>");
    const res = await api("GET", "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    const body = await res.text();
    expect(body).toContain("/a/gallery-item");
    expect(body).toContain("Gallery &lt;b&gt;item&lt;/b&gt;");
  });

  it("renders the artifact page", async () => {
    await createArtifact("ui-doc");
    await publishFiles("ui-doc", [INDEX_HTML]);
    const body = await (await api("GET", "/a/ui-doc")).text();
    expect(body).toContain("v1");
    expect(body).toContain('sandbox="allow-scripts"');
  });

  it("asks signed out visitors to sign in", async () => {
    const res = await api("GET", "/", { email: null });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Cloudflare Access");
  });

  it("serves the static assets", async () => {
    const css = await api("GET", "/static/app.css");
    expect(css.headers.get("content-type")).toContain("text/css");
    const js = await api("GET", "/static/app.js");
    expect(js.headers.get("content-type")).toContain("javascript");
  });

  it("404s unknown ui routes", async () => {
    expect((await api("GET", "/nope/nope")).status).toBe(404);
  });
});

describe("base url", () => {
  it("builds admin urls from ARTD", () => {
    expect(ARTD).toBe("https://artd.example.com");
  });
});
