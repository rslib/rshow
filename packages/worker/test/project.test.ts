import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
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
  viewer
} from "./helpers";

const SECOND_HTML = {
  path: "index.html",
  body: "<!doctype html><title>two</title><p>hello two</p>",
  type: "text/html"
};

async function token(scope: "publish" | "full", email = OWNER): Promise<string> {
  const created = await jsonOf(await api("POST", "/api/tokens", { email, body: { name: `t-${scope}`, scope } }));
  return created["token"] as string;
}

async function artifactInProject(slug: string, project: string, email = OWNER): Promise<void> {
  await createArtifact(slug, email);
  const moved = await api("PATCH", `/api/artifacts/${slug}`, { email, body: { project } });
  if (moved.status !== 200) throw new Error(`move failed: ${moved.status} ${await moved.text()}`);
}

describe("project endpoints", () => {
  it("creates, lists and shows a project", async () => {
    const created = await createProject("team-one", OWNER, { title: "Team one", description: "All the things" });
    expect(created.status).toBe(201);
    const body = await jsonOf(created);
    expect(body).toEqual({
      slug: "team-one",
      title: "Team one",
      description: "All the things",
      owner: OWNER,
      role: "owner",
      artifacts: 0,
      updated_at: expect.any(String),
      url: "https://art.example.com/_p/team-one/"
    });

    const list = await jsonOf(await api("GET", "/api/projects"));
    expect((list["projects"] as unknown[]).length).toBe(1);

    const detail = await jsonOf(await api("GET", "/api/projects/team-one"));
    expect(detail["slug"]).toBe("team-one");
    expect(detail["role"]).toBe("owner");
    expect(detail["members"]).toEqual([]);
    expect(detail["artifacts"]).toEqual([]);
  });

  it("defaults the title to the slug", async () => {
    const body = await jsonOf(await createProject("bare"));
    expect(body["title"]).toBe("bare");
    expect(body["description"]).toBe("");
  });

  it("rejects a taken slug, a bad slug and a long description", async () => {
    expect((await createProject("dup")).status).toBe(201);
    expect((await createProject("dup", EDITOR)).status).toBe(409);
    expect((await createProject("Bad_Slug")).status).toBe(400);
    expect((await createProject("long-desc", OWNER, { description: "x".repeat(501) })).status).toBe(400);
    expect((await createProject("ok-desc", OWNER, { description: "x".repeat(500) })).status).toBe(201);
  });

  it("requires an identity", async () => {
    expect((await api("GET", "/api/projects", { email: null })).status).toBe(401);
  });

  it("lists the projects you own or belong to", async () => {
    await createProject("shared-team");
    await createProject("other-team", EDITOR);
    await addProjectMember("shared-team", VIEWER, "editor");

    const owned = await jsonOf(await api("GET", "/api/projects"));
    expect((owned["projects"] as { slug: string }[]).map((row) => row.slug)).toEqual(["shared-team"]);

    const member = await jsonOf(await api("GET", "/api/projects", { email: VIEWER }));
    expect(member["projects"]).toEqual([expect.objectContaining({ slug: "shared-team", role: "editor", artifacts: 0 })]);

    const stranger = await jsonOf(await api("GET", "/api/projects", { email: STRANGER }));
    expect(stranger["projects"]).toEqual([]);

    expect((await api("GET", "/api/projects/shared-team", { email: STRANGER })).status).toBe(404);
    expect((await api("GET", "/api/projects/shared-team", { email: VIEWER })).status).toBe(200);
  });

  it("adds, changes and removes members", async () => {
    await createProject("roster");
    const email = encodeURIComponent("pal@example.com");

    expect(await jsonOf(await api("PUT", `/api/projects/roster/members/${email}`, { body: { role: "viewer" } }))).toEqual({
      email: "pal@example.com",
      role: "viewer"
    });
    expect(await jsonOf(await api("PUT", `/api/projects/roster/members/${email}`, { body: { role: "editor" } }))).toEqual({
      email: "pal@example.com",
      role: "editor"
    });
    const detail = await jsonOf(await api("GET", "/api/projects/roster"));
    expect(detail["members"]).toEqual([{ email: "pal@example.com", role: "editor" }]);

    expect((await api("DELETE", `/api/projects/roster/members/${email}`)).status).toBe(204);
    expect((await jsonOf(await api("GET", "/api/projects/roster")))["members"]).toEqual([]);
  });

  it("rejects bad member roles, bad emails and unknown projects", async () => {
    await createProject("member-rules");
    const email = encodeURIComponent("pal@example.com");
    expect((await api("PUT", `/api/projects/member-rules/members/${email}`, { body: { role: "owner" } })).status).toBe(400);
    expect((await api("PUT", "/api/projects/member-rules/members/notanemail", { body: { role: "viewer" } })).status).toBe(
      400
    );
    expect((await api("PUT", `/api/projects/nope/members/${email}`, { body: { role: "viewer" } })).status).toBe(404);
    expect((await api("DELETE", `/api/projects/nope/members/${email}`)).status).toBe(404);
  });

  it("keeps member management and delete to the session owner or a full token", async () => {
    await createProject("strict-team");
    const publish = await token("publish");
    const pal = encodeURIComponent("pal@example.com");

    const deniedAdd = await api("PUT", `/api/projects/strict-team/members/${pal}`, {
      email: null,
      token: publish,
      body: { role: "viewer" }
    });
    expect(deniedAdd.status).toBe(403);
    expect((await api("DELETE", "/api/projects/strict-team", { email: null, token: publish })).status).toBe(403);

    await addProjectMember("strict-team", STRANGER, "editor");
    expect(
      (await api("PUT", `/api/projects/strict-team/members/${pal}`, { email: STRANGER, body: { role: "viewer" } })).status
    ).toBe(403);
    expect((await api("DELETE", "/api/projects/strict-team", { email: STRANGER })).status).toBe(403);

    const full = await token("full");
    expect(
      (await api("PUT", `/api/projects/strict-team/members/${pal}`, { email: null, token: full, body: { role: "editor" } }))
        .status
    ).toBe(200);
    expect((await api("DELETE", "/api/projects/strict-team/members/notanemail", { email: null, token: full })).status).toBe(
      400
    );
    expect((await api("DELETE", "/api/projects/strict-team", { email: null, token: full })).status).toBe(204);
  });

  it("patches the title and description as the owner", async () => {
    await createProject("rename-team", OWNER, { title: "Old", description: "Old words" });
    const patched = await jsonOf(await api("PATCH", "/api/projects/rename-team", { body: { title: "New" } }));
    expect(patched["title"]).toBe("New");
    expect(patched["description"]).toBe("Old words");

    const described = await jsonOf(await api("PATCH", "/api/projects/rename-team", { body: { description: "New words" } }));
    expect(described["description"]).toBe("New words");

    expect((await api("PATCH", "/api/projects/rename-team", { body: { title: "" } })).status).toBe(400);
    expect((await api("PATCH", "/api/projects/rename-team", { body: { description: "x".repeat(501) } })).status).toBe(400);
    expect((await api("PATCH", "/api/projects/nope", { body: { title: "x" } })).status).toBe(404);

    await addProjectMember("rename-team", EDITOR, "editor");
    expect((await api("PATCH", "/api/projects/rename-team", { email: EDITOR, body: { title: "Mine" } })).status).toBe(403);
  });

  it("deletes a project and keeps the artifacts", async () => {
    await createProject("short-lived");
    await artifactInProject("kept-doc", "short-lived");
    await addProjectMember("short-lived", VIEWER, "viewer");
    await publishFiles("kept-doc", [INDEX_HTML]);

    expect((await api("DELETE", "/api/projects/short-lived")).status).toBe(204);
    expect((await api("GET", "/api/projects/short-lived")).status).toBe(404);

    const detail = await jsonOf(await api("GET", "/api/artifacts/kept-doc"));
    expect(detail["project"]).toBeNull();

    const rows = await env.DB.prepare("SELECT email FROM project_members WHERE project = ?1").bind("short-lived").all();
    expect(rows.results ?? []).toEqual([]);
  });
});

describe("artifacts in projects", () => {
  it("creates an artifact inside a project and counts it", async () => {
    await createProject("with-artifacts");
    const created = await api("POST", "/api/artifacts", { body: { slug: "in-team", project: "with-artifacts" } });
    expect(created.status).toBe(201);
    expect((await jsonOf(created))["project"]).toBe("with-artifacts");

    const project = await jsonOf(await api("GET", "/api/projects/with-artifacts"));
    expect(project["artifacts"]).toEqual([expect.objectContaining({ slug: "in-team", role: "owner", project: "with-artifacts" })]);
    expect((await jsonOf(await api("GET", "/api/projects/with-artifacts")))["artifacts"]).toHaveLength(1);
    expect((await jsonOf(await api("GET", "/api/projects")))["projects"]).toEqual([
      expect.objectContaining({ slug: "with-artifacts", artifacts: 1 })
    ]);
  });

  it("refuses to create an artifact in a project you cannot edit", async () => {
    await createProject("closed-team");
    expect((await api("POST", "/api/artifacts", { body: { slug: "not-mine", project: "closed-team" }, email: EDITOR })).status).toBe(
      403
    );
    expect((await api("POST", "/api/artifacts", { body: { slug: "no-project", project: "ghost" } })).status).toBe(400);
    expect((await api("POST", "/api/artifacts", { body: { slug: "bad-project", project: 7 } })).status).toBe(400);
  });

  it("moves an artifact in and out of a project", async () => {
    await createProject("move-team");
    await createArtifact("movable");
    expect(await jsonOf(await api("PATCH", "/api/artifacts/movable", { body: { project: "move-team" } }))).toEqual(
      expect.objectContaining({ project: "move-team" })
    );
    expect(await jsonOf(await api("PATCH", "/api/artifacts/movable", { body: { project: null } }))).toEqual(
      expect.objectContaining({ project: null })
    );
    expect((await api("PATCH", "/api/artifacts/movable", { body: { project: 7 } })).status).toBe(400);
  });

  it("only lets a project editor move an artifact they own", async () => {
    await createProject("editor-team");
    await createArtifact("ed-owned", EDITOR);

    expect((await api("PATCH", "/api/artifacts/ed-owned", { email: EDITOR, body: { project: "editor-team" } })).status).toBe(
      403
    );

    await addProjectMember("editor-team", VIEWER, "viewer");
    await createArtifact("viewer-owned", VIEWER);
    expect((await api("PATCH", "/api/artifacts/viewer-owned", { email: VIEWER, body: { project: "editor-team" } })).status).toBe(
      403
    );

    await addProjectMember("editor-team", EDITOR, "editor");
    expect((await api("PATCH", "/api/artifacts/ed-owned", { email: EDITOR, body: { project: "editor-team" } })).status).toBe(
      200
    );

    // The project owner cannot move someone else's artifact.
    await createArtifact("third-party", VIEWER);
    await api("PUT", `/api/artifacts/third-party/shares/${encodeURIComponent(OWNER)}`, {
      email: VIEWER,
      body: { role: "viewer" }
    });
    expect((await api("PATCH", "/api/artifacts/third-party", { body: { project: "editor-team" } })).status).toBe(403);
  });

  it("gives project members their role on the artifacts", async () => {
    await createProject("role-team");
    await artifactInProject("role-doc", "role-team");
    await addProjectMember("role-team", EDITOR, "editor");
    await addProjectMember("role-team", VIEWER, "viewer");

    const editorList = await jsonOf(await api("GET", "/api/artifacts", { email: EDITOR }));
    expect(editorList["artifacts"]).toEqual([expect.objectContaining({ slug: "role-doc", role: "editor" })]);
    const viewerList = await jsonOf(await api("GET", "/api/artifacts", { email: VIEWER }));
    expect(viewerList["artifacts"]).toEqual([expect.objectContaining({ slug: "role-doc", role: "viewer" })]);
    expect((await api("GET", "/api/artifacts/role-doc", { email: STRANGER })).status).toBe(404);
  });

  it("applies the mode rules through the project", async () => {
    await createProject("mode-team");
    await artifactInProject("private-doc", "mode-team");
    await publishFiles("private-doc", [INDEX_HTML]);
    await addProjectMember("mode-team", EDITOR, "editor");
    await addProjectMember("mode-team", VIEWER, "viewer");

    expect((await viewer("/private-doc/", EDITOR)).status).toBe(200);
    expect((await viewer("/private-doc/", VIEWER)).status).toBe(403);
    expect((await viewer("/private-doc/")).status).toBe(302);

    await setMode("private-doc", "people");
    expect((await viewer("/private-doc/", VIEWER)).status).toBe(200);

    await api("DELETE", "/api/projects/mode-team/members/editor@example.com");
    expect((await viewer("/private-doc/", EDITOR)).status).toBe(403);
  });

  it("treats the project owner as an editor, never as the artifact owner", async () => {
    await createProject("publish-team", EDITOR);
    await addProjectMember("publish-team", OWNER, "editor", EDITOR);
    await artifactInProject("team-doc", "publish-team", OWNER);

    // The project owner (EDITOR here) may publish to the artifact.
    const hash = await uploadBlob(INDEX_HTML.body);
    const files = { "index.html": { hash, size: 10, type: "text/html" } };
    const published = await api("POST", "/api/artifacts/team-doc/versions", { email: EDITOR, body: { files } });
    expect(published.status).toBe(201);

    // But it may not delete it or change its shares.
    expect((await api("DELETE", "/api/artifacts/team-doc", { email: EDITOR })).status).toBe(403);
    expect(
      (await api("PUT", "/api/artifacts/team-doc/shares/pal%40example.com", { email: EDITOR, body: { role: "viewer" } }))
        .status
    ).toBe(403);

    // A project member with the editor role may publish too.
    const editorVersion = await api("POST", "/api/artifacts/team-doc/versions", { email: OWNER, body: { files } });
    expect(editorVersion.status).toBe(201);
  });
});

describe("project access through shares", () => {
  it("takes the higher of the direct and project roles", async () => {
    await createProject("higher-team");
    await artifactInProject("higher-doc", "higher-team");
    await addProjectMember("higher-team", VIEWER, "viewer");
    await api("PUT", `/api/artifacts/higher-doc/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "editor" } });

    expect((await jsonOf(await api("GET", "/api/artifacts/higher-doc", { email: VIEWER })))["role"]).toBe("editor");
    await publishFiles("higher-doc", [SECOND_HTML]);

    await api("PUT", `/api/artifacts/higher-doc/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "viewer" } });
    await addProjectMember("higher-team", VIEWER, "editor");
    expect((await jsonOf(await api("GET", "/api/artifacts/higher-doc", { email: VIEWER })))["role"]).toBe("editor");
  });
});

describe("project csrf", () => {
  it("rejects cookie writes without the admin origin", async () => {
    const missing = await api("POST", "/api/projects", { body: { slug: "csrf-team" }, omitOrigin: true });
    expect(missing.status).toBe(403);
    const wrong = await api("POST", "/api/projects", {
      body: { slug: "csrf-team" },
      headers: { origin: "https://evil.example.com" }
    });
    expect(wrong.status).toBe(403);
    expect((await createProject("csrf-team")).status).toBe(201);

    expect((await api("PATCH", "/api/projects/csrf-team", { body: { title: "x" }, omitOrigin: true })).status).toBe(403);
    expect(
      (await api("PUT", `/api/projects/csrf-team/members/${encodeURIComponent(EDITOR)}`, { body: { role: "viewer" }, omitOrigin: true }))
        .status
    ).toBe(403);
    expect((await api("DELETE", "/api/projects/csrf-team", { omitOrigin: true })).status).toBe(403);
    expect((await api("PATCH", "/api/artifacts/csrf-team-nope", { body: { tags: [] }, omitOrigin: true })).status).toBe(403);
  });

  it("lets a bearer token skip the origin check", async () => {
    const created = await jsonOf(await api("POST", "/api/tokens", { body: { name: "cli", scope: "full" } }));
    const full = created["token"] as string;
    const res = await api("POST", "/api/projects", { email: null, token: full, body: { slug: "bearer-team" }, omitOrigin: true });
    expect(res.status).toBe(201);
  });
});
