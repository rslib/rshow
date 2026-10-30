import { describe, expect, it } from "vitest";
import { api, createArtifact, INDEX_HTML, jsonOf, publishFiles, setMode, viewer, type FileSpec } from "./helpers";

const DECK_CSS: FileSpec = {
  path: "deck.css",
  body: ":root{--accent:#F2B33D}",
  type: "text/css"
};

const DECK_CSS_TWO: FileSpec = {
  path: "deck.css",
  body: ":root{--accent:#6EA8FF}",
  type: "text/css"
};

async function publishTheme(name: string, versions: FileSpec[][], mode = "public"): Promise<void> {
  const slug = `theme-${name}`;
  await createArtifact(slug);
  for (const files of versions) await publishFiles(slug, files);
  if (mode !== "private") await setMode(slug, mode);
}

describe("themes", () => {
  it("serves a theme file with artifact headers and a one year cache", async () => {
    await publishTheme("default", [[INDEX_HTML, DECK_CSS]]);
    const res = await viewer("/_themes/default@1/deck.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'self' https://artd.example.com");
    expect(await res.text()).toBe(DECK_CSS.body);
  });

  it("serves index.html at the theme root", async () => {
    await publishTheme("root", [[INDEX_HTML, DECK_CSS]]);
    const res = await viewer("/_themes/root@1/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("hello one");
  });

  it("serves the requested version and not only the served one", async () => {
    await publishTheme("versions", [[INDEX_HTML, DECK_CSS], [INDEX_HTML, DECK_CSS_TWO]]);
    expect(await (await viewer("/_themes/versions@1/deck.css")).text()).toBe(DECK_CSS.body);
    expect(await (await viewer("/_themes/versions@2/deck.css")).text()).toBe(DECK_CSS_TWO.body);
  });

  it("404s a theme that is not public", async () => {
    await publishTheme("private", [[INDEX_HTML, DECK_CSS]], "private");
    expect((await viewer("/_themes/private@1/deck.css")).status).toBe(404);
  });

  it("404s unknown, invalid and missing themes or versions", async () => {
    await publishTheme("known", [[INDEX_HTML, DECK_CSS]]);
    expect((await viewer("/_themes/unknown@1/deck.css")).status).toBe(404);
    expect((await viewer("/_themes/Bad_Name@1/deck.css")).status).toBe(404);
    expect((await viewer("/_themes/known@9/deck.css")).status).toBe(404);
    expect((await viewer("/_themes")).status).toBe(404);
    expect((await viewer("/_themes/")).status).toBe(404);
    expect((await viewer("/_themes/known@1/missing.css")).status).toBe(404);
  });

  it("redirects the version segment without a trailing slash", async () => {
    await publishTheme("redirect", [[INDEX_HTML, DECK_CSS]]);
    const res = await viewer("/_themes/redirect@1");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/_themes/redirect@1/");
  });

  it("publishes a theme folder without index.html", async () => {
    await createArtifact("theme-plain");
    const published = await publishFiles("theme-plain", [
      { path: "tokens.css", body: DECK_CSS.body, type: "text/css" },
      { path: "theme.json", body: '{"name":"plain"}', type: "application/json" }
    ]);
    expect(published.status).toBe(201);
    await setMode("theme-plain", "public");

    const res = await viewer("/_themes/plain@1/tokens.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe(DECK_CSS.body);
  });

  it("rejects traversal inside a theme path", async () => {
    await publishTheme("safe", [[INDEX_HTML, DECK_CSS]]);
    expect((await viewer("/_themes/safe@1/%2e%2e/deck.css")).status).toBe(404);
  });

  it("reports the served theme version as json", async () => {
    await publishTheme("latest", [[INDEX_HTML, DECK_CSS], [INDEX_HTML, DECK_CSS_TWO]]);

    const res = await viewer("/_themes/latest.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await jsonOf(res)).toEqual({ name: "latest", version: 2, url: "/_themes/latest@2/" });

    const head = await viewer("/_themes/latest.json", null, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("reports the pinned theme version as json", async () => {
    await publishTheme("pinned", [[INDEX_HTML, DECK_CSS], [INDEX_HTML, DECK_CSS_TWO]]);
    expect(await jsonOf(await viewer("/_themes/pinned.json"))).toEqual({
      name: "pinned",
      version: 2,
      url: "/_themes/pinned@2/"
    });

    await api("PATCH", "/api/artifacts/theme-pinned", { body: { pinned: 1 } });
    expect(await jsonOf(await viewer("/_themes/pinned.json"))).toEqual({
      name: "pinned",
      version: 1,
      url: "/_themes/pinned@1/"
    });
  });

  it("404s theme info for private, unknown and nested themes", async () => {
    await publishTheme("hidden", [[INDEX_HTML, DECK_CSS]], "private");
    await publishTheme("default", [[INDEX_HTML, DECK_CSS]]);

    expect(await jsonOf(await viewer("/_themes/hidden.json"))).toEqual({ error: "not found" });
    expect((await viewer("/_themes/hidden.json")).status).toBe(404);
    expect((await viewer("/_themes/unknown.json")).status).toBe(404);
    expect((await viewer("/_themes/default.json/x")).status).toBe(404);
  });

  it("does not treat _themes as a slug", async () => {
    await createArtifact("_themes");
    expect((await viewer("/_themes")).status).toBe(404);
  });
});
