import { describe, expect, it } from "vitest";
import { INDEX_HTML, OWNER, STRANGER, VIEWER, api, createArtifact, hashOf, publishFiles } from "./helpers";

const NESTED = { path: "assets/a b.css", body: "body { color: red; }", type: "text/css" };

async function bodyOf(res: Response): Promise<string> {
  return new TextDecoder().decode(await res.arrayBuffer());
}

async function published(slug: string): Promise<void> {
  expect((await createArtifact(slug)).status).toBe(201);
  expect((await publishFiles(slug, [INDEX_HTML, NESTED])).status).toBe(201);
}

describe("version file download", () => {
  it("returns the bytes of a file as an attachment", async () => {
    await published("pull-one");
    const res = await api("GET", "/api/artifacts/pull-one/versions/1/files/index.html");
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toBe(INDEX_HTML.body);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toBe("attachment");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-rshow-hash")).toBe(await hashOf(INDEX_HTML.body));
  });

  it("decodes a nested path with an escaped space", async () => {
    await published("pull-nested");
    const res = await api("GET", "/api/artifacts/pull-nested/versions/1/files/assets/a%20b.css");
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toBe(NESTED.body);
  });

  it("is 404 for a missing file, a bad path or a missing version", async () => {
    await published("pull-missing");
    for (const path of [
      "/api/artifacts/pull-missing/versions/1/files/nope.html",
      "/api/artifacts/pull-missing/versions/1/files/assets/..%2Findex.html",
      "/api/artifacts/pull-missing/versions/1/files/%E0%A4%A",
      "/api/artifacts/pull-missing/versions/1/files/constructor",
      "/api/artifacts/pull-missing/versions/2/files/index.html",
      "/api/artifacts/pull-missing/versions/0/files/index.html"
    ]) {
      expect((await api("GET", path)).status, path).toBe(404);
    }
  });

  it("hides a private artifact from a stranger and serves a viewer", async () => {
    await published("pull-private");
    const path = "/api/artifacts/pull-private/versions/1/files/index.html";
    expect((await api("GET", path, { email: STRANGER })).status).toBe(404);
    const share = await api("PUT", `/api/artifacts/pull-private/shares/${encodeURIComponent(VIEWER)}`, {
      email: OWNER,
      body: { role: "viewer" }
    });
    expect(share.status).toBe(200);
    expect((await api("GET", path, { email: VIEWER })).status).toBe(200);
  });

  it("is 401 without an identity", async () => {
    await published("pull-anon");
    const res = await api("GET", "/api/artifacts/pull-anon/versions/1/files/index.html", { email: null });
    expect(res.status).toBe(401);
  });
});
