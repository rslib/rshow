import type { Context } from "hono";
import { canView, projectRole } from "./authz";
import { resolveViewerIdentity } from "./auth";
import { MODE, PROJECT_SEGMENT, SLUG_PATTERN, THEME_PREFIX, type Mode } from "./constants";
import { getProject, getProjectMembers, listArtifactsInProject, projectInfoOf, sharesForSlugs } from "./db";
import { escapeHtml, formatDate } from "./html";
import { loginRedirect, MINIMAL_STYLE, notFoundPage } from "./hostPage";
import { redirect } from "./http";
import type { AppEnv, ArtifactRow, Env } from "./types";

const THEME_SLUG = `${THEME_PREFIX}default`;

const MODE_WORDS: Record<Mode, string> = {
  private: "Private",
  people: "People",
  public: "Public"
};

const LIST_STYLE =
  ".rshow-project{max-width:44rem}.rshow-project h1{margin-bottom:.25rem}.rshow-desc{color:var(--color-muted,#5A5E66);margin:0 0 1.5rem}.rshow-artifacts{list-style:none;padding:0;margin:0;display:grid;gap:.25rem}.rshow-artifacts li{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;padding:.75rem 0;border-top:1px solid var(--color-border,#E3E3DE)}.rshow-artifacts a{font-weight:600}.rshow-mode,.rshow-date{color:var(--color-muted,#5A5E66);font-size:.875rem}.rshow-empty{color:var(--color-muted,#5A5E66)}";

async function defaultThemeReady(env: Env): Promise<boolean> {
  const artifact = await env.DB.prepare("SELECT mode FROM artifacts WHERE slug = ?1")
    .bind(THEME_SLUG)
    .first<{ mode: string }>();
  if (!artifact || artifact.mode !== MODE.public) return false;
  const version = await env.DB.prepare("SELECT n FROM versions WHERE slug = ?1 LIMIT 1")
    .bind(THEME_SLUG)
    .first<{ n: number }>();
  return version !== null;
}

function groupPage(title: string, description: string, artifacts: readonly ArtifactRow[], theme: boolean): Response {
  const links = theme
    ? `<link rel="stylesheet" href="/_themes/default@latest/fonts.css">
<link rel="stylesheet" href="/_themes/default@latest/tokens.css">
<link rel="stylesheet" href="/_themes/default@latest/page.css">
<script src="/_themes/default@latest/mode.js"></script>`
    : `<style>${MINIMAL_STYLE}</style>`;

  const descriptionHtml =
    description === "" ? "" : `\n<p class="rshow-desc">${escapeHtml(description)}</p>`;
  const listHtml =
    artifacts.length === 0
      ? `\n<p class="rshow-empty">No artifacts to show yet.</p>`
      : `\n<ul class="rshow-artifacts">${artifacts
          .map(
            (artifact) =>
              `\n<li><a href="/${escapeHtml(artifact.slug)}/">${escapeHtml(artifact.title)}</a><span class="rshow-mode">${escapeHtml(
                MODE_WORDS[artifact.mode]
              )}</span><time class="rshow-date" datetime="${escapeHtml(artifact.updated_at)}">${escapeHtml(
                formatDate(artifact.updated_at)
              )}</time></li>`
          )
          .join("")}\n</ul>`;

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${links}
<style>${LIST_STYLE}</style>
</head>
<body><main class="rshow-project"><h1>${escapeHtml(title)}</h1>${descriptionHtml}${listHtml}</main></body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, no-store",
      "content-security-policy":
        "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }
  });
}

export async function handleProjectPage(c: Context<AppEnv>, rest: string[], url: URL): Promise<Response> {
  const env = c.env;
  const slug = rest[0] ?? "";
  if (!SLUG_PATTERN.test(slug)) return notFoundPage();
  if (rest.length === 1) return redirect(`/${PROJECT_SEGMENT}/${slug}/${url.search}`, 301);
  if (rest.length !== 2 || rest[1] !== "") return notFoundPage();

  const project = await getProject(env, slug);
  if (!project) return notFoundPage();

  const members = await getProjectMembers(env, slug);
  const info = projectInfoOf(project, members);
  const identity = await resolveViewerIdentity(env, c.req.raw.headers);
  const rows = await listArtifactsInProject(env, slug);

  if (identity.email === null && rows.some((row) => row.mode !== MODE.public)) {
    return loginRedirect(url.pathname, url.search);
  }

  const shares = await sharesForSlugs(
    env,
    rows.map((row) => row.slug)
  );
  const visible = rows.filter((row) => canView(row, identity.email, shares.get(row.slug) ?? [], info));

  if (visible.length === 0 && projectRole(info, identity.email) === null) {
    return notFoundPage();
  }

  const theme = await defaultThemeReady(env);
  return groupPage(project.title, project.description, visible, theme);
}
