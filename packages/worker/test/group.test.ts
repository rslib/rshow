import { describe, expect, it } from "vitest";
import {
  addProjectMember,
  api,
  createArtifact,
  createProject,
  EDITOR,
  INDEX_HTML,
  jsonOf,
  OWNER,
  publishFiles,
  setMode,
  STRANGER,
  uploadBlob,
  VIEWER,
  viewer,
  type FileSpec
} from "./helpers";

const THEME_FILES: FileSpec[] = [
  { path: "fonts.css", body: "@font-face{font-family:'IBM Plex Sans';src:url(/x.woff2)}", type: "text/css" },
  { path: "tokens.css", body: ":root{--accent:#F2B33D}", type: "text/css" },
  { path: "page.css", body: "body{background:var(--bg)}", type: "text/css" },
  { path: "mode.js", body: "document.documentElement.dataset.theme='light'", type: "text/javascript" }
];

// Upload the theme blobs once and publish three versions so `default@3` exists.
async function publishTheme(slug: string, files: FileSpec[], versions: number, mode: string): Promise<void> {
  await createArtifact(slug);
  const manifest: Record<string, { hash: string; size: number; type: string }> = {};
  for (const file of files) {
    manifest[file.path] = {
      hash: await uploadBlob(file.body),
      size: new TextEncoder().encode(file.body).byteLength,
      type: file.type
    };
  }
  for (let n = 0; n < versions; n += 1) {
    const res = await api("POST", `/api/artifacts/${slug}/versions`, { body: { files: manifest } });
    if (res.status !== 201) throw new Error(`theme publish failed: ${res.status} ${await res.text()}`);
  }
  if (mode !== "private") await setMode(slug, mode);
}

async function publishDefaultTheme(): Promise<void> {
  await publishTheme("theme-default", THEME_FILES, 3, "public");
}

async function projectArtifact(slug: string, project: string, mode: string, title: string, email = OWNER): Promise<void> {
  await createArtifact(slug, email, title);
  await publishFiles(slug, [INDEX_HTML], email);
  if (mode !== "private") await setMode(slug, mode, email);
  const moved = await api("PATCH", `/api/artifacts/${slug}`, { email, body: { project } });
  if (moved.status !== 200) throw new Error(`move failed: ${moved.status} ${await moved.text()}`);
}

describe("group page", () => {
  it("lists the public artifacts of a project for an anonymous viewer", async () => {
    await createProject("open-group", OWNER, { title: "Open group", description: "Everything public" });
    await projectArtifact("open-one", "open-group", "public", "Open one");

    const res = await viewer("/_p/open-group/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await res.text();
    expect(body).toContain("<title>Open group</title>");
    expect(body).toContain("Everything public");
    expect(body).toContain('href="/open-one/"');
    expect(body).toContain("Open one");
    expect(body).toContain("Public");
    // No theme published yet: the minimal inline style is the fallback.
    expect(body).toContain("<style>");
    expect(body).not.toContain("/_themes/default@latest/page.css");
  });

  it("uses the default theme look when the theme is published", async () => {
    await publishDefaultTheme();
    await createProject("themed-group");
    await projectArtifact("themed-one", "themed-group", "public", "Themed one");

    const body = await (await viewer("/_p/themed-group/")).text();
    expect(body).toContain('<link rel="stylesheet" href="/_themes/default@latest/fonts.css">');
    expect(body).toContain('<link rel="stylesheet" href="/_themes/default@latest/tokens.css">');
    expect(body).toContain('<link rel="stylesheet" href="/_themes/default@latest/page.css">');
    expect(body).toContain('<script src="/_themes/default@latest/mode.js"></script>');
    expect(body).toContain("Themed one");
  });

  it("falls back to the minimal style when the theme is not public", async () => {
    await publishTheme("theme-default", [THEME_FILES[1]], 3, "private");
    await createProject("unthemed-group");
    await projectArtifact("unthemed-one", "unthemed-group", "public", "Unthemed one");

    const body = await (await viewer("/_p/unthemed-group/")).text();
    expect(body).not.toContain("/_themes/default@latest/page.css");
    expect(body).toContain("Unthemed one");
  });

  it("asks anonymous viewers to sign in when something in the project is not public", async () => {
    await createProject("mixed-group");
    await projectArtifact("mixed-public", "mixed-group", "public", "Mixed public");
    await projectArtifact("mixed-private", "mixed-group", "private", "Mixed private");

    const res = await viewer("/_p/mixed-group/");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/_auth/login?next=%2F_p%2Fmixed-group%2F");
  });

  it("lists only the artifacts a member may see", async () => {
    await createProject("member-group");
    await projectArtifact("member-public", "member-group", "public", "Member public");
    await projectArtifact("member-private", "member-group", "private", "Member private");
    await addProjectMember("member-group", EDITOR, "editor");
    await addProjectMember("member-group", VIEWER, "viewer");

    const editorBody = await (await viewer("/_p/member-group/", EDITOR)).text();
    expect(editorBody).toContain("Member public");
    expect(editorBody).toContain("Member private");

    const viewerBody = await (await viewer("/_p/member-group/", VIEWER)).text();
    expect(viewerBody).toContain("Member public");
    expect(viewerBody).not.toContain("Member private");

    const strangerBody = await (await viewer("/_p/member-group/", STRANGER)).text();
    expect(strangerBody).toContain("Member public");
    expect(strangerBody).not.toContain("Member private");
  });

  it("shows an empty state to a member who can see nothing", async () => {
    await createProject("private-group");
    await projectArtifact("private-only", "private-group", "private", "Private only");
    await addProjectMember("private-group", VIEWER, "viewer");

    const res = await viewer("/_p/private-group/", VIEWER);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("No artifacts to show yet.");
    expect(body).not.toContain("Private only");
  });

  it("404s a project with nothing to show and a non-member", async () => {
    await createProject("secret-group");
    await projectArtifact("secret-doc", "secret-group", "private", "Secret doc");

    expect((await viewer("/_p/secret-group/", STRANGER)).status).toBe(404);
    expect((await viewer("/_p/secret-group/", OWNER)).status).toBe(200);
  });

  it("404s unknown and malformed project slugs", async () => {
    expect((await viewer("/_p/")).status).toBe(404);
    expect((await viewer("/_p/unknown-group/")).status).toBe(404);
    expect((await viewer("/_p/Bad_Group/")).status).toBe(404);
    expect((await viewer("/_p/unknown-group/extra/")).status).toBe(404);
    expect((await viewer("/_p/unknown-group/extra")).status).toBe(404);
  });

  it("redirects the project root without a trailing slash", async () => {
    await createProject("slash-group");
    const res = await viewer("/_p/slash-group");
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/_p/slash-group/");
  });

  it("escapes the project and artifact text", async () => {
    const created = await jsonOf(
      await createProject("escape-group", OWNER, { title: "<b>Team</b>", description: "<script>alert(1)</script>" })
    );
    expect(created["slug"]).toBe("escape-group");
    await projectArtifact("escape-doc", "escape-group", "public", 'Doc <img src=x onerror="alert(1)">');

    const body = await (await viewer("/_p/escape-group/")).text();
    expect(body).toContain("&lt;b&gt;Team&lt;/b&gt;");
    expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body).toContain("Doc &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(body).not.toContain("<script>alert(1)</script>");
  });

  it("shows the mode and the update date of each artifact", async () => {
    await createProject("facts-group");
    await projectArtifact("facts-doc", "facts-group", "people", "Facts doc");

    const body = await (await viewer("/_p/facts-group/", OWNER)).text();
    expect(body).toContain("People");
    expect(body).toMatch(/<time class="rshow-date" datetime="[0-9T:.Z-]+">[0-9]{4}-[0-9]{2}-[0-9]{2}/);
  });

  it("does not treat _p as a slug", async () => {
    expect((await createArtifact("_p")).status).toBe(400);
    expect((await viewer("/_p")).status).toBe(404);
  });
});
