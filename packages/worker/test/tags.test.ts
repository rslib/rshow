import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import {
  addProjectMember,
  api,
  createArtifact,
  createProject,
  EDITOR,
  jsonOf,
  OWNER,
  setMode,
  STRANGER,
  VIEWER
} from "./helpers";

async function token(scope: "publish" | "full", email = OWNER): Promise<string> {
  const created = await jsonOf(await api("POST", "/api/tokens", { email, body: { name: `t-${scope}`, scope } }));
  return created["token"] as string;
}

function tagsOf(body: Record<string, unknown>): string[] {
  return body["tags"] as string[];
}

describe("tags on artifacts", () => {
  it("sets, replaces and clears tags", async () => {
    await createArtifact("tagged");
    const set = await jsonOf(await api("PATCH", "/api/artifacts/tagged", { body: { tags: ["Talks", "ai"] } }));
    expect(tagsOf(set)).toEqual(["ai", "talks"]);

    const replaced = await jsonOf(await api("PATCH", "/api/artifacts/tagged", { body: { tags: ["talks"] } }));
    expect(tagsOf(replaced)).toEqual(["talks"]);

    const cleared = await jsonOf(await api("PATCH", "/api/artifacts/tagged", { body: { tags: [] } }));
    expect(tagsOf(cleared)).toEqual([]);

    const rows = await env.DB.prepare("SELECT tag FROM artifact_tags WHERE slug = ?1").bind("tagged").all();
    expect(rows.results ?? []).toEqual([]);
  });

  it("lowercases, dedupes and sorts tags", async () => {
    await createArtifact("sorted-tags");
    const patched = await jsonOf(await api("PATCH", "/api/artifacts/sorted-tags", { body: { tags: ["b", "A", "b", "c"] } }));
    expect(tagsOf(patched)).toEqual(["a", "b", "c"]);
    const detail = await jsonOf(await api("GET", "/api/artifacts/sorted-tags"));
    expect(tagsOf(detail)).toEqual(["a", "b", "c"]);
  });

  it("accepts tags when an artifact is created", async () => {
    const created = await jsonOf(await api("POST", "/api/artifacts", { body: { slug: "born-tagged", tags: ["one", "two"] } }));
    expect(tagsOf(created)).toEqual(["one", "two"]);
    const listed = await jsonOf(await api("GET", "/api/artifacts"));
    expect((listed["artifacts"] as { slug: string; tags: string[] }[])[0].tags).toEqual(["one", "two"]);
    expect(tagsOf(await jsonOf(await api("GET", "/api/artifacts/born-tagged")))).toEqual(["one", "two"]);
  });

  it("caps an artifact at ten tags", async () => {
    await createArtifact("many-tags");
    const ten = Array.from({ length: 10 }, (_, index) => `t${index}`);
    expect((await api("PATCH", "/api/artifacts/many-tags", { body: { tags: ten } })).status).toBe(200);
    expect((await api("PATCH", "/api/artifacts/many-tags", { body: { tags: [...ten, "extra"] } })).status).toBe(400);
    // Duplicates collapse before the cap.
    expect((await api("PATCH", "/api/artifacts/many-tags", { body: { tags: [...ten, "t0", "T0"] } })).status).toBe(200);
  });

  it("rejects malformed tags and non arrays", async () => {
    await createArtifact("bad-tags");
    for (const tag of ["-leading", "with space", "UPPER!", "x".repeat(33), ""]) {
      expect((await api("PATCH", "/api/artifacts/bad-tags", { body: { tags: [tag] } })).status).toBe(400);
    }
    expect((await api("PATCH", "/api/artifacts/bad-tags", { body: { tags: "one" } })).status).toBe(400);
    expect((await api("PATCH", "/api/artifacts/bad-tags", { body: { tags: [1] } })).status).toBe(400);
    expect((await api("POST", "/api/artifacts", { body: { slug: "bad-new-tags", tags: ["ok", "#nope"] } })).status).toBe(400);
    expect(
      (await api("PATCH", "/api/artifacts/bad-tags", { body: { tags: [`a${"b".repeat(31)}`] } })).status
    ).toBe(200);
  });

  it("lets editors set tags with a publish token but not viewers", async () => {
    await createArtifact("tag-rights");
    await api("PUT", `/api/artifacts/tag-rights/shares/${encodeURIComponent(EDITOR)}`, { body: { role: "editor" } });
    await api("PUT", `/api/artifacts/tag-rights/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "viewer" } });

    const publish = await token("publish", EDITOR);
    const editorRes = await api("PATCH", "/api/artifacts/tag-rights", { email: null, token: publish, body: { tags: ["shared"] } });
    expect(editorRes.status).toBe(200);
    expect(tagsOf(await jsonOf(editorRes))).toEqual(["shared"]);

    expect((await api("PATCH", "/api/artifacts/tag-rights", { email: VIEWER, body: { tags: ["nope"] } })).status).toBe(403);
    expect((await api("PATCH", "/api/artifacts/tag-rights", { email: STRANGER, body: { tags: ["nope"] } })).status).toBe(404);

    // Tags are not a manage action, so a publish token is enough; mode is not.
    const publishOwner = await token("publish");
    expect(
      (await api("PATCH", "/api/artifacts/tag-rights", { email: null, token: publishOwner, body: { tags: ["x"], mode: "public" } }))
        .status
    ).toBe(403);
  });

  it("lets a project editor tag an artifact they do not own", async () => {
    await createProject("tag-team");
    await createArtifact("team-tagged");
    await api("PATCH", "/api/artifacts/team-tagged", { body: { project: "tag-team" } });
    await addProjectMember("tag-team", EDITOR, "editor");

    expect((await api("PATCH", "/api/artifacts/team-tagged", { email: EDITOR, body: { tags: ["team"] } })).status).toBe(200);
    await addProjectMember("tag-team", EDITOR, "viewer");
    expect((await api("PATCH", "/api/artifacts/team-tagged", { email: EDITOR, body: { tags: ["team"] } })).status).toBe(403);
  });

  it("drops tags when the artifact is deleted", async () => {
    await createArtifact("gone-tags");
    await api("PATCH", "/api/artifacts/gone-tags", { body: { tags: ["bye"] } });
    expect((await api("DELETE", "/api/artifacts/gone-tags")).status).toBe(204);
    const rows = await env.DB.prepare("SELECT tag FROM artifact_tags WHERE slug = ?1").bind("gone-tags").all();
    expect(rows.results ?? []).toEqual([]);
  });
});

describe("list filters", () => {
  async function seed(): Promise<void> {
    await createProject("filter-team");
    const rows: [string, string, string[]][] = [
      ["alpha-talk", "Alpha talk", ["talks", "ai"]],
      ["beta-talk", "Beta talk", ["talks"]],
      ["gamma-report", "Gamma report", ["report"]]
    ];
    for (const [slug, title, tags] of rows) {
      await api("POST", "/api/artifacts", { body: { slug, title, tags } });
    }
    await api("PATCH", "/api/artifacts/alpha-talk", { body: { project: "filter-team" } });
    await setMode("beta-talk", "public");
  }

  function slugsOf(body: Record<string, unknown>): string[] {
    return (body["artifacts"] as { slug: string }[]).map((row) => row.slug).sort();
  }

  it("filters by tag, project and q", async () => {
    await seed();
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts")))).toEqual(["alpha-talk", "beta-talk", "gamma-report"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=talks")))).toEqual(["alpha-talk", "beta-talk"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=report")))).toEqual(["gamma-report"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=none")))).toEqual([]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?project=filter-team")))).toEqual(["alpha-talk"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?q=beta")))).toEqual(["beta-talk"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?q=talk")))).toEqual(["alpha-talk", "beta-talk"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?q=Gamma")))).toEqual(["gamma-report"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=talks&q=alpha")))).toEqual(["alpha-talk"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=talks&project=filter-team")))).toEqual(["alpha-talk"]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=report&project=filter-team")))).toEqual([]);
    // LIKE wildcards in q are literals, not patterns.
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?q=%25")))).toEqual([]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?q=_")))).toEqual([]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?q=-")))).toEqual(["alpha-talk", "beta-talk", "gamma-report"]);
  });

  it("rejects malformed filter values", async () => {
    await seed();
    expect((await api("GET", "/api/artifacts?tag=NotATag")).status).toBe(400);
    expect((await api("GET", "/api/artifacts?project=Bad_Project")).status).toBe(400);
    expect((await api("GET", `/api/artifacts?q=${"x".repeat(201)}`)).status).toBe(400);
  });

  it("only ever lists what the caller can see", async () => {
    await seed();
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts", { email: STRANGER })))).toEqual([]);
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?tag=talks", { email: STRANGER })))).toEqual([]);
    await addProjectMember("filter-team", STRANGER, "viewer");
    expect(slugsOf(await jsonOf(await api("GET", "/api/artifacts?project=filter-team", { email: STRANGER })))).toEqual([
      "alpha-talk"
    ]);
  });
});

describe("GET /api/tags", () => {
  it("counts tags over the caller's artifacts", async () => {
    await api("POST", "/api/artifacts", { body: { slug: "one", tags: ["talks", "ai"] } });
    await api("POST", "/api/artifacts", { body: { slug: "two", tags: ["talks"] } });
    await api("POST", "/api/artifacts", { body: { slug: "three", tags: [] } });

    expect(await jsonOf(await api("GET", "/api/tags"))).toEqual({
      tags: [
        { tag: "ai", count: 1 },
        { tag: "talks", count: 2 }
      ]
    });
    expect(await jsonOf(await api("GET", "/api/tags", { email: STRANGER }))).toEqual({ tags: [] });
  });

  it("includes artifacts shared through a project", async () => {
    await createProject("tag-count-team");
    await api("POST", "/api/artifacts", { body: { slug: "team-counted", tags: ["team"] } });
    await api("PATCH", "/api/artifacts/team-counted", { body: { project: "tag-count-team" } });
    await addProjectMember("tag-count-team", VIEWER, "viewer");

    expect(await jsonOf(await api("GET", "/api/tags", { email: VIEWER }))).toEqual({
      tags: [{ tag: "team", count: 1 }]
    });
  });

  it("requires an identity", async () => {
    expect((await api("GET", "/api/tags", { email: null })).status).toBe(401);
  });
});
