import { describe, expect, it } from "vitest";
import {
  addProjectMember,
  api,
  createArtifact,
  createProject,
  EDITOR,
  INDEX_HTML,
  OWNER,
  publishFiles,
  setMode,
  STRANGER,
  VIEWER
} from "./helpers";

const SECOND_HTML = {
  path: "index.html",
  body: "<!doctype html><title>two</title><p>hello two</p>",
  type: "text/html"
};

function islandProps(body: string): Record<string, unknown>[] {
  return [...body.matchAll(/data-props="([^"]*)"/g)].map((match) =>
    JSON.parse((match[1] ?? "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>
  );
}

async function moveToProject(slug: string, project: string, email = OWNER): Promise<void> {
  const moved = await api("PATCH", `/api/artifacts/${slug}`, { email, body: { project } });
  if (moved.status !== 200) throw new Error(`move failed: ${moved.status} ${await moved.text()}`);
}

async function tagArtifact(slug: string, tags: string[], email = OWNER): Promise<void> {
  const tagged = await api("PATCH", `/api/artifacts/${slug}`, { email, body: { tags } });
  if (tagged.status !== 200) throw new Error(`tag failed: ${tagged.status} ${await tagged.text()}`);
}

describe("gallery", () => {
  it("renders the shell, navigation, projects, tags and table", async () => {
    await createProject("team-one", OWNER, { title: "Team one" });
    await createArtifact("gallery-doc", OWNER, "Gallery doc");
    await tagArtifact("gallery-doc", ["talks", "ai"]);
    await moveToProject("gallery-doc", "team-one");

    const res = await api("GET", "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(res.headers.get("content-security-policy")).not.toContain("unsafe-inline");
    const body = await res.text();

    expect(body).toContain('class="topbar"');
    expect(body).toContain("rshow");
    expect(body).toContain("Shared with me");
    expect(body).toContain('href="/?project=team-one"');
    expect(body).toContain("Team one");
    expect(body).toContain('href="/projects/new"');
    expect(body).toContain('href="/tokens"');
    expect(body).toContain("All artifacts");
    expect(body).toContain("Gallery doc");
    expect(body).toContain("gallery-doc/");
    expect(body).toContain("ai, talks");
    expect(body).toContain("Private");
    expect(body).toContain("Updated");
    expect(body).toContain('name="q"');
    expect(body).toContain('name="mode"');
    expect(body).toContain('<script src="/static/app.js"></script>');
    expect(body).not.toContain("onclick=");
    expect(body).not.toContain("<style");
  });

  it("escapes artifact titles and project titles", async () => {
    await createProject("escape-team", OWNER, { title: 'Team <b>"one"</b>' });
    await createArtifact("escape-doc", OWNER, 'Quote " and <b>tag</b>');
    await moveToProject("escape-doc", "escape-team");

    const gallery = await (await api("GET", "/")).text();
    expect(gallery).toContain("&lt;b&gt;tag&lt;/b&gt;");
    expect(gallery).toContain("&quot;");
    expect(gallery).toContain("Team &lt;b&gt;");
    expect(gallery).not.toContain("<b>tag</b>");
  });

  it("filters through the query string with links and a get form", async () => {
    await createProject("filter-team", OWNER, { title: "Filter team" });
    await createArtifact("alpha-talk", OWNER, "Alpha talk");
    await createArtifact("beta-talk", OWNER, "Beta talk");
    await createArtifact("gamma-report", OWNER, "Gamma report");
    await tagArtifact("alpha-talk", ["talks", "ai"]);
    await tagArtifact("beta-talk", ["talks"]);
    await tagArtifact("gamma-report", ["report"]);
    await moveToProject("alpha-talk", "filter-team");
    await setMode("beta-talk", "public");

    const byProject = await (await api("GET", "/?project=filter-team")).text();
    expect(byProject).toContain("Alpha talk");
    expect(byProject).not.toContain("Beta talk");
    expect(byProject).toContain("Filter team");

    const byTag = await (await api("GET", "/?tag=talks")).text();
    expect(byTag).toContain("Alpha talk");
    expect(byTag).toContain("Beta talk");
    expect(byTag).not.toContain("Gamma report");
    expect(byTag).toContain("tag-chip is-on");

    const byMode = await (await api("GET", "/?mode=public")).text();
    expect(byMode).toContain("Beta talk");
    expect(byMode).not.toContain("Alpha talk");
    expect(byMode).toContain('<option value="public" selected=""');

    const byQuery = await (await api("GET", "/?q=Gamma")).text();
    expect(byQuery).toContain("Gamma report");
    expect(byQuery).not.toContain("Alpha talk");

    const combined = await (await api("GET", "/?project=filter-team&tag=talks&q=alpha")).text();
    expect(combined).toContain("Alpha talk");
    expect(combined).not.toContain("Beta talk");
    expect(combined).toContain("project=filter-team");
    expect(combined).toContain("tag=ai");
  });

  it("shows shared artifacts and an empty state", async () => {
    await createArtifact("mine-doc", OWNER, "Mine");
    await createArtifact("theirs-doc", EDITOR, "Theirs");
    await api("PUT", `/api/artifacts/theirs-doc/shares/${encodeURIComponent(OWNER)}`, {
      email: EDITOR,
      body: { role: "viewer" }
    });

    const shared = await (await api("GET", "/?share=shared")).text();
    expect(shared).toContain("Shared with me");
    expect(shared).toContain("Theirs");
    expect(shared).not.toContain("Mine");

    const empty = await (await api("GET", "/?q=no-such-artifact")).text();
    expect(empty).toContain("No artifacts match these filters.");
  });

  it("shows theme urls for theme artifacts", async () => {
    await createArtifact("theme-solar");
    await publishFiles("theme-solar", [INDEX_HTML]);
    const body = await (await api("GET", "/")).text();
    expect(body).toContain("Themes");
    expect(body).toContain("/_themes/solar@1/");
    expect(body).toContain('href="https://art.example.com/_themes/solar@1/"');
  });
});

describe("artifact page", () => {
  it("renders the preview iframe, versions, tags, project and sharing controls", async () => {
    await createProject("art-team", OWNER, { title: "Art team" });
    await createArtifact("detail-doc", OWNER, "Detail doc");
    await publishFiles("detail-doc", [INDEX_HTML]);
    await publishFiles("detail-doc", [SECOND_HTML]);
    await moveToProject("detail-doc", "art-team");
    await tagArtifact("detail-doc", ["deck", "talks"]);

    const res = await api("GET", "/a/detail-doc?preview=1");
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain('data-island="share"');
    expect(body).toContain('data-island="versions"');
    expect(body).toContain('data-island="copy"');
    expect(body).toContain('data-island="delete"');
    expect(body).toContain("<iframe");
    expect(body).toContain('src="https://art.example.com/detail-doc/v1/"');
    expect(body).toContain('sandbox="allow-scripts"');
    expect(body).not.toContain("allow-same-origin");
    expect(body).toContain('loading="lazy"');
    expect(body).toContain('href="/a/detail-doc?preview=2"');
    expect(body).toContain('data-action="pin"');
    expect(body).not.toContain("Follow the newest version again");
    expect(body).toContain("Preview of v1");
    expect(body).toContain("v1");
    expect(body).toContain("v2");
    expect(body).toContain("deck");
    expect(body).toContain('data-form="tags"');
    expect(body).toContain('name="tag"');
    expect(body).toContain('data-form="project"');
    expect(body).toContain('name="project"');
    expect(body).toContain('data-form="mode"');
    expect(body).toContain('name="mode"');
    expect(body).toContain("Who can open this");
    expect(body).toContain("Only you, editors and project editors.");
    expect(body).toContain("1 member through Art team.");
    expect(body).toContain("Through project Art team");
    expect(body).toContain('name="email"');
    expect(body).toContain("Add person");
    expect(body).toContain("Delete artifact");
    expect(body).toContain("Art team");
    expect(body).toContain("<noscript>");
    expect(body).not.toContain("onclick=");
    expect(body).not.toContain("<style");
    expect(body).toContain('<script src="/static/app.js"></script>');

    const props = islandProps(body);
    expect(props.some((entry) => entry["slug"] === "detail-doc")).toBe(true);
    expect(props.some((entry) => Array.isArray(entry["tags"]))).toBe(true);
    expect(props.some((entry) => typeof entry["text"] === "string")).toBe(true);
  });

  it("escapes values and falls back to the live version", async () => {
    await createArtifact("escaped-doc", OWNER, 'Title <img src=x onerror=alert(1)>');
    await publishFiles("escaped-doc", [INDEX_HTML]);
    const body = await (await api("GET", "/a/escaped-doc?preview=999")).text();
    expect(body).toContain("Title &lt;img src=x onerror=alert(1)&gt;");
    expect(body).not.toContain("<img src=x");
    expect(body).toContain('src="https://art.example.com/escaped-doc/v1/"');
  });

  it("does not show owner actions to viewers but still renders the sharing summary", async () => {
    await createArtifact("shared-doc");
    await publishFiles("shared-doc", [INDEX_HTML]);
    await api("PUT", `/api/artifacts/shared-doc/shares/${encodeURIComponent(VIEWER)}`, { body: { role: "viewer" } });

    const body = await (await api("GET", "/a/shared-doc", { email: VIEWER })).text();
    expect(body).toContain("Who can open this");
    expect(body).toContain("Only you, editors and project editors.");
    expect(body).toContain("shared-doc/v1/");
    expect(body).not.toContain("Delete artifact");
    expect(body).not.toContain('data-form="tags"');
    expect(body).toContain("Only the owner can change sharing.");
  });

  it("shows a public sharing summary without the people editor", async () => {
    await createArtifact("public-doc");
    await publishFiles("public-doc", [INDEX_HTML]);
    await setMode("public-doc", "public");
    const body = await (await api("GET", "/a/public-doc")).text();
    expect(body).toContain("Anyone with the link");
    expect(body).not.toContain('aria-label="People"');
  });

  it("shows delete on a version only when a second one exists, and never on a theme", async () => {
    await createArtifact("two-versions");
    await publishFiles("two-versions", [INDEX_HTML]);
    const single = await (await api("GET", "/a/two-versions")).text();
    expect(single).not.toContain('data-action="delete-version"');

    await publishFiles("two-versions", [SECOND_HTML]);
    const both = await (await api("GET", "/a/two-versions")).text();
    expect(both).toContain('data-action="delete-version"');

    await createArtifact("theme-mono");
    await publishFiles("theme-mono", [INDEX_HTML]);
    await publishFiles("theme-mono", [SECOND_HTML]);
    const theme = await (await api("GET", "/a/theme-mono")).text();
    expect(theme).not.toContain('data-action="delete-version"');
  });

  it("renders a pinned artifact with a follow action", async () => {
    await createArtifact("pinned-doc");
    await publishFiles("pinned-doc", [INDEX_HTML]);
    await publishFiles("pinned-doc", [SECOND_HTML]);
    await api("PATCH", "/api/artifacts/pinned-doc", { body: { pinned: 1 } });
    const body = await (await api("GET", "/a/pinned-doc")).text();
    expect(body).toContain("Pinned to v1");
    expect(body).toContain('data-action="newest"');
    expect(body).toContain("Follow the newest version again");
    expect(body).toContain("Pinned, live");
  });
});

describe("project page", () => {
  it("renders the project, artifacts, kinds and members", async () => {
    await createProject("team-page", OWNER, {
      title: "Team page",
      description: "Everything the team made"
    });
    await createArtifact("team-deck", OWNER, "Team deck");
    await tagArtifact("team-deck", ["deck"]);
    await publishFiles("team-deck", [INDEX_HTML]);
    await moveToProject("team-deck", "team-page");
    await createArtifact("loose-poster", OWNER, "Loose poster");
    await addProjectMember("team-page", VIEWER, "viewer");

    const res = await api("GET", "/p/team-page");
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(body).toContain("All artifacts");
    expect(body).toContain("Team page");
    expect(body).toContain("https://art.example.com/_p/team-page/");
    expect(body).toContain("Copy group link");
    expect(body).toContain("Open group page");
    expect(body).toContain("Everything the team made");
    expect(body).toContain('data-form="description"');
    expect(body).toContain('name="description"');
    expect(body).toContain("Team deck");
    expect(body).toContain("Deck");
    expect(body).toContain("Private");
    expect(body).toContain("v1");
    expect(body).toContain("Members");
    expect(body).toContain(OWNER);
    expect(body).toContain(VIEWER);
    expect(body).toContain("Viewer");
    expect(body).toContain('data-form="member"');
    expect(body).toContain('name="email"');
    expect(body).toContain('data-action="remove-member"');
    expect(body).toContain('data-form="add-artifact"');
    expect(body).toContain('value="loose-poster"');
    expect(body).toContain('<script src="/static/app.js"></script>');
    expect(body).not.toContain("onclick=");
    expect(body).not.toContain("<style");
  });

  it("derives the artifact kind from tags, falling back to Page", async () => {
    await createProject("kind-team");
    for (const [slug, tag, kind] of [
      ["kind-poster", "poster", "Poster"],
      ["kind-report", "report", "Report"],
      ["kind-project", "project", "Project"],
      ["kind-dashboard", "dashboard", "Dashboard"],
      ["kind-page", "page", "Page"],
      ["kind-none", "", "Page"]
    ]) {
      await createArtifact(slug, OWNER, slug);
      if (tag !== "") await tagArtifact(slug, [tag]);
      await moveToProject(slug, "kind-team");
    }
    const body = await (await api("GET", "/p/kind-team")).text();
    for (const kind of ["Poster", "Report", "Project", "Dashboard"]) expect(body).toContain(kind);
    expect(body.match(/>Page</g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("escapes project values and hides owner forms from members", async () => {
    await createProject("escape-project", OWNER, {
      title: 'Escape <b>"project"</b>',
      description: "<script>alert(1)</script>"
    });
    await addProjectMember("escape-project", VIEWER, "viewer");

    const ownerBody = await (await api("GET", "/p/escape-project")).text();
    expect(ownerBody).toContain("Escape &lt;b&gt;&quot;project&quot;&lt;/b&gt;");
    expect(ownerBody).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(ownerBody).not.toContain("<script>alert(1)</script>");

    const memberBody = await (await api("GET", "/p/escape-project", { email: VIEWER })).text();
    expect(memberBody).toContain("Escape &lt;b&gt;");
    expect(memberBody).not.toContain('data-form="description"');
    expect(memberBody).not.toContain('data-form="member"');
    expect(memberBody).not.toContain('data-action="remove-member"');
  });

  it("404s a project for strangers", async () => {
    await createProject("private-project");
    expect((await api("GET", "/p/private-project", { email: STRANGER })).status).toBe(404);
    expect((await api("GET", "/p/missing-project")).status).toBe(404);
  });

  it("lets a project member view the page even without artifacts", async () => {
    await createProject("empty-team", OWNER, { title: "Empty team" });
    await addProjectMember("empty-team", VIEWER, "viewer");
    const body = await (await api("GET", "/p/empty-team", { email: VIEWER })).text();
    expect(body).toContain("Empty team");
    expect(body).toContain("No artifacts in this project yet.");
    expect(body).toContain("Viewer");
  });
});

describe("new project and tokens pages", () => {
  it("renders the new project form", async () => {
    const body = await (await api("GET", "/projects/new")).text();
    expect(body).toContain('data-form="project-new"');
    expect(body).toContain('name="slug"');
    expect(body).toContain('name="title"');
    expect(body).toContain('name="description"');
    expect(body).toContain("Create project");
    expect(body).toContain("New project");
    expect(body).toContain('<script src="/static/app.js"></script>');
    expect(body).not.toContain("onclick=");
  });

  it("renders the tokens page restyled with the tokens island", async () => {
    await api("POST", "/api/tokens", { body: { name: "island-token", scope: "publish" } });
    const body = await (await api("GET", "/tokens")).text();
    expect(body).toContain('data-island="tokens"');
    expect(body).toContain('data-form="token"');
    expect(body).toContain("island-token");
    expect(body).toContain('id="token-box"');
    expect(body).toContain('id="token-rows"');
    expect(body).toContain('data-action="revoke"');
    expect(body).toContain("Tokens");
    expect(body).not.toContain("onclick=");
    expect(body).not.toContain("<style");
  });

  it("wraps the token form and the revoke buttons in the tokens island", async () => {
    await api("POST", "/api/tokens", { body: { name: "revoke-token", scope: "publish" } });
    const body = await (await api("GET", "/tokens")).text();
    expect(body.match(/data-island="tokens"/g)).toHaveLength(1);
    const island = body.slice(body.indexOf('data-island="tokens"'), body.indexOf("</main>"));
    expect(island).toContain('data-form="token"');
    expect(island).toContain('data-action="revoke"');
  });

  it("renders the signed out page with the mode script", async () => {
    const body = await (await api("GET", "/", { email: null })).text();
    expect(body).toContain("Cloudflare Access");
    expect(body).toContain('<script src="/static/mode.js"></script>');
    expect(body).toContain('<script src="/static/app.js"></script>');
  });

  it("renders the not found page inside the app shell", async () => {
    const body = await (await api("GET", "/a/missing-doc")).text();
    expect(body).toContain("Not found");
    expect(body).toContain('class="topbar"');
    expect(body).toContain("All artifacts");
  });
});

interface ParsedTable {
  headers: string[];
  rows: { label: string | null }[][];
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

function parseTables(body: string): ParsedTable[] {
  return [...body.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map((table) => {
    const inner = table[1] ?? "";
    const headers = [...inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((th) => textOf(th[1] ?? ""));
    const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((tr) => [...(tr[1] ?? "").matchAll(/<td([^>]*)>/g)].map((td) => ({ label: /data-label="([^"]*)"/.exec(td[1] ?? "")?.[1] ?? null })))
      .filter((cells) => cells.length > 0);
    return { headers, rows };
  });
}

function expectLabelsMatchHeaders(body: string): void {
  const tables = parseTables(body).filter((table) => table.headers.length > 0);
  expect(tables.length).toBeGreaterThan(0);
  for (const table of tables) {
    for (const row of table.rows) {
      if (row.length !== table.headers.length) continue;
      expect(row[0]?.label).toBeNull();
      for (let index = 1; index < row.length; index += 1) {
        expect(row[index]?.label).toBe(table.headers[index]);
      }
    }
  }
}

describe("mobile table labels", () => {
  it("labels every stacked cell with its column header on the gallery, project and tokens tables", async () => {
    await createProject("label-team", OWNER, { title: "Label team" });
    await createArtifact("label-doc", OWNER, "Label doc");
    await moveToProject("label-doc", "label-team");
    await api("POST", "/api/tokens", { body: { name: "label-token", scope: "publish" } });

    const gallery = await (await api("GET", "/")).text();
    expectLabelsMatchHeaders(gallery);
    expect(gallery).toContain('data-label="Project"');
    expect(gallery).toContain('data-label="Live version"');

    const project = await (await api("GET", "/p/label-team")).text();
    expectLabelsMatchHeaders(project);
    expect(project).toContain('data-label="Kind"');

    const tokens = await (await api("GET", "/tokens")).text();
    expectLabelsMatchHeaders(tokens);
    expect(tokens).toContain('data-label="Scope"');
    expect(tokens).toContain('data-label="Actions"');
  });

  it("styles the stacked cells and the scrolling side menu in the stylesheet", async () => {
    const css = await (await api("GET", "/static/app.css")).text();
    expect(css).toContain("td[data-label]::before{content:attr(data-label)");
    expect(css).toContain(".sidenav{width:auto;display:flex;flex-wrap:nowrap");
    expect(css).toContain("overflow-x:auto");
    expect(css).toContain(".topbar{height:48px;flex:0 0 auto");
  });
});

describe("admin ui islands", () => {
  it("serves island mounting code without inline handlers", async () => {
    const res = await api("GET", "/static/app.js");
    expect(res.headers.get("content-type")).toContain("javascript");
    const script = await res.text();
    expect(script).toContain("data-island");
    expect(script).toContain("querySelectorAll");
    expect(script).toContain("propsOf");
    expect(script).toContain("data-submit-on-change");
    expect(script).toContain("remove-member");
    expect(script).toContain("project-new");
    expect(script).not.toContain("onclick");
  });

  it("serves a stylesheet with field-row buttons matching field height", async () => {
    const res = await api("GET", "/static/app.css");
    expect(res.headers.get("content-type")).toContain("css");
    const css = await res.text();
    expect(css).toContain(".field-row .btn{height:40px");
  });

  it("uses only external scripts, with mode.js before app.css", async () => {
    await createArtifact("no-inline-doc");
    for (const path of ["/", "/a/no-inline-doc", "/projects/new", "/tokens"]) {
      const body = await (await api("GET", path)).text();
      const inline = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)];
      expect(inline).toEqual([]);
      expect(body).not.toContain("onclick=");
      expect(body).not.toContain("onchange=");
      expect(body).not.toContain('style="');
      const head = body.slice(0, body.indexOf("</head>"));
      expect(head.indexOf("/static/mode.js")).toBeLessThan(head.indexOf("/static/app.css"));
    }
  });
});
