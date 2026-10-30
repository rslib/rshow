import { Hono } from "hono";
import { resolveAdminIdentity } from "./auth";
import { canView, maxShareRole, projectRole, roleFor } from "./authz";
import { registerApi } from "./api";
import { isMode, SLUG_PATTERN, TAG_PATTERN } from "./constants";
import {
  getArtifact,
  getArtifactTags,
  getProject,
  getProjectMembers,
  getShares,
  listArtifactsFor,
  listArtifactsInProject,
  listProjectsFor,
  listVersions,
  ownedProjectSlugs,
  projectAccessFor,
  projectInfoOf,
  projectMembershipsForEmail,
  sharesForEmail,
  sharesForSlugs,
  tagCountsForSlugs,
  tagsForSlugs
} from "./db";
import { jsonError } from "./http";
import { registerStatic } from "./static";
import {
  artifactPage,
  galleryPage,
  newProjectPage,
  projectPage,
  renderPage,
  signInPage,
  tokensPage,
  uiNotFoundPage,
  type GalleryFilters,
  type GalleryTag,
  type NavProject,
  type UiArtifact,
  type UiProject,
  type UiProjectAccess,
  type UiToken
} from "./ui";
import type { Role, ShareRole } from "./constants";
import type { AppEnv, ArtifactRow, Env, ProjectRow, ShareRow } from "./types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function adminCsp(env: Env): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src 'self' data:",
    `frame-src https://${env.ART_HOST}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join("; ");
}

function isBlobPut(pathname: string): boolean {
  return /^\/api\/blobs\/[^/]+$/.test(pathname);
}

function effectiveRole(
  row: ArtifactRow,
  email: string,
  shares: Map<string, ShareRow>,
  memberships: Map<string, ShareRole>,
  owned: Set<string>
): Role {
  if (row.owner === email) return "owner";
  const direct = shares.get(row.slug)?.role ?? null;
  let viaProject: ShareRole | null = null;
  if (row.project !== null) {
    viaProject = owned.has(row.project) ? "editor" : (memberships.get(row.project) ?? null);
  }
  return maxShareRole(direct, viaProject) === "editor" ? "editor" : "viewer";
}

function toUiArtifact(row: ArtifactRow, role: Role, tags: string[] = []): UiArtifact {
  return {
    slug: row.slug,
    title: row.title,
    owner: row.owner,
    mode: row.mode,
    pinned: row.pinned,
    latest: row.latest,
    served: row.pinned ?? row.latest,
    updated_at: row.updated_at,
    role,
    project: row.project,
    tags
  };
}

function navProjectsFrom(projects: ProjectRow[], items: readonly UiArtifact[]): NavProject[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.project === null) continue;
    counts.set(item.project, (counts.get(item.project) ?? 0) + 1);
  }
  return projects.map((project) => {
    const title = project.title;
    return { slug: project.slug, title, count: counts.get(project.slug) ?? 0 };
  });
}

async function navProjectsFor(env: Env, email: string): Promise<NavProject[]> {
  const [projects, rows] = await Promise.all([listProjectsFor(env, email), listArtifactsFor(env, email)]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.project === null) continue;
    counts.set(row.project, (counts.get(row.project) ?? 0) + 1);
  }
  return projects.map((project) => ({ slug: project.slug, title: project.title, count: counts.get(project.slug) ?? 0 }));
}

function galleryFiltersOf(c: { req: { query: (name: string) => string | undefined } }): GalleryFilters {
  const project = c.req.query("project") ?? null;
  const tag = c.req.query("tag") ?? null;
  const mode = c.req.query("mode") ?? null;
  const q = (c.req.query("q") ?? "").slice(0, 200);
  return {
    project: project !== null && SLUG_PATTERN.test(project) ? project : null,
    tag: tag !== null && TAG_PATTERN.test(tag) ? tag : null,
    mode: mode !== null && isMode(mode) ? mode : null,
    q,
    share: c.req.query("share") === "shared"
  };
}

function filterGallery(items: readonly UiArtifact[], filters: GalleryFilters, email: string): UiArtifact[] {
  const q = filters.q.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.project !== null && item.project !== filters.project) return false;
    if (filters.tag !== null && !item.tags.includes(filters.tag)) return false;
    if (filters.mode !== null && item.mode !== filters.mode) return false;
    if (filters.share && item.owner === email) return false;
    if (q !== "" && !item.title.toLowerCase().includes(q) && !item.slug.includes(q)) return false;
    return true;
  });
}

export function createAdminApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    await next();
    const response = c.res;
    const headers = new Headers(response.headers);
    headers.set("content-security-policy", adminCsp(c.env));
    headers.set("x-content-type-options", "nosniff");
    headers.set("referrer-policy", "same-origin");
    if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
    c.res = new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });

  app.use("/api/*", async (c, next) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    c.set("identity", identity);
    if (identity.email === null) return jsonError("unauthorized", 401);

    if (!SAFE_METHODS.has(c.req.method) && identity.kind !== "bearer") {
      const origin = c.req.header("origin");
      if (origin !== `https://${c.env.ARTD_HOST}`) return jsonError("cross-origin request refused", 403);
      if (!isBlobPut(new URL(c.req.url).pathname)) {
        const contentType = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
        if (contentType !== "application/json") return jsonError("content-type must be application/json", 403);
      }
    }

    await next();
  });

  registerApi(app);

  registerStatic(app);

  app.get("/", async (c) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    if (identity.email === null) return htmlPage(signInPage(c.env));
    const email = identity.email;
    const rows = await listArtifactsFor(c.env, email);
    const shares = await sharesForEmail(c.env, email);
    const memberships = await projectMembershipsForEmail(c.env, email);
    const owned = await ownedProjectSlugs(c.env, email);
    const tagsBySlug = await tagsForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const items = rows.map((row) =>
      toUiArtifact(row, effectiveRole(row, email, shares, memberships, owned), tagsBySlug.get(row.slug) ?? [])
    );
    const projectRows = await listProjectsFor(c.env, email);
    const navProjects = navProjectsFrom(projectRows, items);
    const tagCounts = await tagCountsForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const tags: GalleryTag[] = [...tagCounts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((left, right) => left.tag.localeCompare(right.tag));
    const filters = galleryFiltersOf(c);
    const filtered = filterGallery(items, filters, email);
    return htmlPage(galleryPage(c.env, email, filtered, navProjects, tags, filters));
  });

  app.get("/a/:slug", async (c) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    if (identity.email === null) return htmlPage(signInPage(c.env));
    const email = identity.email;
    const slug = c.req.param("slug");
    const artifact = await getArtifact(c.env, slug);
    const shares = artifact ? await getShares(c.env, slug) : [];
    const project = artifact ? await projectAccessFor(c.env, artifact.project) : null;
    const role = artifact ? roleFor(artifact, email, shares, project) : null;
    if (!artifact || role === null) return htmlPage(uiNotFoundPage(c.env, email), 404);
    const versions = await listVersions(c.env, slug);
    const tags = await getArtifactTags(c.env, slug);
    const projectRow = artifact.project === null ? null : await getProject(c.env, artifact.project);
    const projectMembers = artifact.project === null ? [] : await getProjectMembers(c.env, artifact.project);
    const projectAccess: UiProjectAccess | null =
      project === null
        ? null
        : {
            slug: project.slug,
            title: projectRow?.title ?? project.slug,
            owner: project.owner,
            members: project.members.map((member) => ({ email: member.email, role: member.role }))
          };
    const projects = await listProjectsFor(c.env, email);
    const memberships = await projectMembershipsForEmail(c.env, email);
    const editableProjects = projects
      .filter((row) => row.owner === email || memberships.get(row.slug) === "editor")
      .map((row) => ({ slug: row.slug, title: row.title }));
    const rawPreview = c.req.query("preview") ?? "";
    const requested = /^[0-9]{1,9}$/.test(rawPreview) ? Number(rawPreview) : null;
    const preview =
      requested !== null && versions.some((version) => version.n === requested)
        ? requested
        : (artifact.pinned ?? artifact.latest);
    return htmlPage(
      artifactPage(
        c.env,
        email,
        toUiArtifact(artifact, role, tags),
        versions,
        shares,
        projectAccess,
        editableProjects,
        preview
      )
    );
  });

  app.get("/p/:slug", async (c) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    if (identity.email === null) return htmlPage(signInPage(c.env));
    const email = identity.email;
    const project = await getProject(c.env, c.req.param("slug"));
    if (!project) return htmlPage(uiNotFoundPage(c.env, email), 404);
    const members = await getProjectMembers(c.env, project.slug);
    const info = projectInfoOf(project, members);
    const role = projectRole(info, email);
    if (role === null) return htmlPage(uiNotFoundPage(c.env, email), 404);

    const rows = await listArtifactsInProject(c.env, project.slug);
    const shares = await sharesForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const tagsBySlug = await tagsForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const visible = rows.filter((row) => canView(row, email, shares.get(row.slug) ?? [], info));
    const artifacts = visible.map((row) =>
      toUiArtifact(
        row,
        roleFor(row, email, shares.get(row.slug) ?? [], info) ?? "viewer",
        tagsBySlug.get(row.slug) ?? []
      )
    );

    const allRows = await listArtifactsFor(c.env, email);
    const ownArtifacts = allRows
      .filter((row) => row.owner === email && row.project !== project.slug)
      .map((row) => toUiArtifact(row, "owner"));
    const navProjects = await navProjectsFor(c.env, email);
    const view: UiProject = {
      slug: project.slug,
      title: project.title,
      description: project.description,
      owner: project.owner,
      role,
      updated_at: project.updated_at
    };
    return htmlPage(
      projectPage(
        c.env,
        email,
        view,
        members.map((member) => ({ email: member.email, role: member.role })),
        artifacts,
        ownArtifacts
      )
    );
  });

  app.get("/projects/new", async (c) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    if (identity.email === null) return htmlPage(signInPage(c.env));
    const projects = await navProjectsFor(c.env, identity.email);
    return htmlPage(newProjectPage(c.env, identity.email, projects));
  });

  app.get("/tokens", async (c) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    if (identity.email === null) return htmlPage(signInPage(c.env));
    if (identity.kind === "bearer") return htmlPage(uiNotFoundPage(c.env, identity.email), 404);
    const result = await c.env.DB.prepare(
      "SELECT hash, name, scope, created_at, last_used_at FROM tokens WHERE email = ?1 ORDER BY created_at DESC, name"
    )
      .bind(identity.email)
      .all<{ hash: string; name: string; scope: string; created_at: string; last_used_at: string | null }>();
    const tokens: UiToken[] = (result.results ?? []).map((row) => ({
      id: row.hash,
      name: row.name,
      scope: row.scope,
      created_at: row.created_at,
      last_used_at: row.last_used_at
    }));
    return htmlPage(tokensPage(c.env, identity.email, tokens, await navProjectsFor(c.env, identity.email)));
  });

  app.all("*", async (c) => {
    const identity = await resolveAdminIdentity(c.env, c.req.raw.headers);
    if (identity.email === null) return htmlPage(signInPage(c.env));
    return htmlPage(uiNotFoundPage(c.env, identity.email), 404);
  });

  return app;
}

function htmlPage(body: unknown, status = 200): Response {
  return new Response(renderPage(body), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
  });
}
