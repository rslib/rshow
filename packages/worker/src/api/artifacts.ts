import type { Hono } from "hono";
import { canEditProject, canManage, canPublish, maxShareRole } from "../authz";
import { invalidateAccess, invalidateProjectAccess, invalidateVersions } from "../cache";
import {
  MAX_TITLE_LENGTH,
  MODE,
  SLUG_PATTERN,
  TAG_PATTERN,
  isMode,
  isShareRole,
  type Mode,
  type Role,
  type ShareRole
} from "../constants";
import { deleteArtifactData } from "../datastore";
import {
  getArtifact,
  getArtifactTags,
  getVersion,
  listArtifactsFor,
  listVersions,
  ownedProjectSlugs,
  projectAccessFor,
  projectMembershipsForEmail,
  sharesForEmail,
  tagsForSlugs,
  type ArtifactFilter
} from "../db";
import { json, jsonError } from "../http";
import type { AppEnv, ArtifactRow, ProjectAccess, ShareRow } from "../types";
import { actorOf, loadAccessible, normalizeEmailInput, parseTags, readBody, toArtifact, toShare } from "./common";
import { toVersion } from "./versions";

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

export function registerArtifactList(app: Hono<AppEnv>): void {
  app.get("/api/artifacts", async (c) => {
    const email = c.get("identity").email as string;
    const filter: ArtifactFilter = {};
    const tagParam = c.req.query("tag");
    if (tagParam !== undefined) {
      if (!TAG_PATTERN.test(tagParam)) return jsonError("tag must match [a-z0-9][a-z0-9-]{0,31}", 400);
      filter.tag = tagParam;
    }
    const projectParam = c.req.query("project");
    if (projectParam !== undefined) {
      if (!SLUG_PATTERN.test(projectParam)) return jsonError("project must match [a-z0-9][a-z0-9-]{0,62}", 400);
      filter.project = projectParam;
    }
    const qParam = c.req.query("q");
    if (qParam !== undefined) {
      if (qParam.length > MAX_TITLE_LENGTH) return jsonError(`q must be at most ${MAX_TITLE_LENGTH} characters`, 400);
      filter.q = qParam;
    }

    const rows = await listArtifactsFor(c.env, email, filter);
    const shares = await sharesForEmail(c.env, email);
    const memberships = await projectMembershipsForEmail(c.env, email);
    const owned = await ownedProjectSlugs(c.env, email);
    const tags = await tagsForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const artifacts = rows.map((row) =>
      toArtifact(c.env, row, effectiveRole(row, email, shares, memberships, owned), tags.get(row.slug) ?? [])
    );
    return json({ artifacts });
  });
}

export function registerArtifactCreate(app: Hono<AppEnv>): void {
  app.post("/api/artifacts", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const slug = body.body.slug;
    if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) {
      return jsonError("slug must match [a-z0-9][a-z0-9-]{0,62}", 400);
    }
    const rawTitle = body.body.title;
    if (rawTitle !== undefined && typeof rawTitle !== "string") return jsonError("title must be a string", 400);
    const title = (typeof rawTitle === "string" ? rawTitle.trim() : "") || slug;
    if (title.length > MAX_TITLE_LENGTH) return jsonError(`title must be at most ${MAX_TITLE_LENGTH} characters`, 400);

    let project: string | null = null;
    if (body.body.project !== undefined) {
      const raw = body.body.project;
      if (raw === null) project = null;
      else if (typeof raw === "string" && SLUG_PATTERN.test(raw)) project = raw;
      else return jsonError("project must be a slug or null", 400);
    }

    let tags: string[] = [];
    if (body.body.tags !== undefined) {
      const parsed = parseTags(body.body.tags);
      if (!parsed.ok) return jsonError(parsed.error, 400);
      tags = parsed.tags;
    }

    const email = c.get("identity").email as string;
    if (project !== null) {
      const target = await projectAccessFor(c.env, project);
      if (!target) return jsonError("no such project", 400);
      if (!canEditProject(target, email)) return jsonError("project owner or editor access is required", 403);
    }

    const existing = await getArtifact(c.env, slug);
    if (existing) return jsonError("slug is already taken", 409);

    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        "INSERT INTO artifacts (slug, title, owner, mode, pinned, latest, project, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5, ?6, ?6)"
      )
        .bind(slug, title, email, MODE.private, project, now)
        .run();
    } catch {
      return jsonError("slug is already taken", 409);
    }

    if (tags.length > 0) {
      await c.env.DB.batch(
        tags.map((tag) => c.env.DB.prepare("INSERT INTO artifact_tags (slug, tag) VALUES (?1, ?2)").bind(slug, tag))
      );
    }

    const created: ArtifactRow = {
      slug,
      title,
      owner: email,
      mode: MODE.private,
      pinned: null,
      latest: null,
      project,
      created_at: now,
      updated_at: now
    };
    await invalidateAccess(slug);
    return json(toArtifact(c.env, created, "owner", tags), 201);
  });
}

export function registerArtifactItem(app: Hono<AppEnv>): void {
  app.get("/api/artifacts/:slug", async (c) => {
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);
    const versions = await listVersions(c.env, access.artifact.slug);
    const tags = await getArtifactTags(c.env, access.artifact.slug);
    return json({
      ...toArtifact(c.env, access.artifact, access.role, tags),
      versions: versions.map((row) => toVersion(c.env, access.artifact.slug, row)),
      shares: access.shares.map(toShare)
    });
  });

  app.patch("/api/artifacts/:slug", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);

    const actor = actorOf(c);
    const hasManage =
      body.body.title !== undefined ||
      body.body.mode !== undefined ||
      body.body.pinned !== undefined ||
      body.body.project !== undefined;
    const hasTags = body.body.tags !== undefined;
    if (hasManage) {
      if (!canManage(access.artifact, access.shares, actor, access.project)) {
        return jsonError("owner access is required", 403);
      }
    } else if (!canPublish(access.artifact, access.shares, actor, access.project)) {
      return jsonError("owner or editor access is required", 403);
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    let nextTitle = access.artifact.title;
    let nextMode: Mode = access.artifact.mode;
    let nextPinned = access.artifact.pinned;
    let nextProject = access.artifact.project;

    if (body.body.title !== undefined) {
      if (typeof body.body.title !== "string") return jsonError("title must be a string", 400);
      const title = body.body.title.trim();
      if (title === "" || title.length > MAX_TITLE_LENGTH) return jsonError("title must be 1 to 200 characters", 400);
      nextTitle = title;
      updates.push("title = ?");
      values.push(title);
    }

    if (body.body.mode !== undefined) {
      if (!isMode(body.body.mode)) return jsonError("mode must be private, people or public", 400);
      nextMode = body.body.mode;
      updates.push("mode = ?");
      values.push(nextMode);
    }

    if (body.body.pinned !== undefined) {
      const pinned = body.body.pinned;
      if (pinned === null) {
        nextPinned = null;
      } else {
        if (typeof pinned !== "number" || !Number.isInteger(pinned) || pinned < 1) {
          return jsonError("pinned must be a version number or null", 400);
        }
        const version = await getVersion(c.env, access.artifact.slug, pinned);
        if (!version) return jsonError("no such version", 400);
        nextPinned = pinned;
      }
      updates.push("pinned = ?");
      values.push(nextPinned);
    }

    if (body.body.project !== undefined) {
      const raw = body.body.project;
      if (raw === null) {
        nextProject = null;
      } else if (typeof raw === "string" && SLUG_PATTERN.test(raw)) {
        if (raw !== access.artifact.project) {
          const target = await projectAccessFor(c.env, raw);
          if (!target) return jsonError("no such project", 400);
          if (!canEditProject(target, email)) return jsonError("project owner or editor access is required", 403);
        }
        nextProject = raw;
      } else {
        return jsonError("project must be a slug or null", 400);
      }
      updates.push("project = ?");
      values.push(nextProject);
    }

    let nextTags: string[] | null = null;
    if (hasTags) {
      const parsed = parseTags(body.body.tags);
      if (!parsed.ok) return jsonError(parsed.error, 400);
      nextTags = parsed.tags;
    }

    const now = new Date().toISOString();
    const changed = updates.length > 0 || nextTags !== null;
    if (updates.length > 0) {
      await c.env.DB.prepare(`UPDATE artifacts SET ${updates.join(", ")}, updated_at = ? WHERE slug = ?`)
        .bind(...values, now, access.artifact.slug)
        .run();
    } else if (changed) {
      await c.env.DB.prepare("UPDATE artifacts SET updated_at = ?2 WHERE slug = ?1")
        .bind(access.artifact.slug, now)
        .run();
    }
    if (nextTags !== null) {
      const statements: D1PreparedStatement[] = [
        c.env.DB.prepare("DELETE FROM artifact_tags WHERE slug = ?1").bind(access.artifact.slug)
      ];
      for (const tag of nextTags) {
        statements.push(c.env.DB.prepare("INSERT INTO artifact_tags (slug, tag) VALUES (?1, ?2)").bind(access.artifact.slug, tag));
      }
      await c.env.DB.batch(statements);
    }

    if (changed) {
      if (nextProject !== access.artifact.project) {
        if (access.artifact.project !== null) await invalidateProjectAccess(c.env, access.artifact.project);
        await invalidateAccess(access.artifact.slug);
        if (nextProject !== null) await invalidateProjectAccess(c.env, nextProject);
      } else {
        await invalidateAccess(access.artifact.slug);
      }
    }

    const tags = nextTags ?? (await getArtifactTags(c.env, access.artifact.slug));
    const updated: ArtifactRow = {
      ...access.artifact,
      title: nextTitle,
      mode: nextMode,
      pinned: nextPinned,
      project: nextProject,
      updated_at: changed ? now : access.artifact.updated_at
    };
    return json(toArtifact(c.env, updated, access.role, tags));
  });

  app.delete("/api/artifacts/:slug", async (c) => {
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);
    if (!canManage(access.artifact, access.shares, actorOf(c), access.project)) {
      return jsonError("owner access is required", 403);
    }

    const prefix = `manifests/${access.artifact.slug}/`;
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const listed = await c.env.BUCKET.list({ prefix, cursor, limit: 1000 });
      for (const object of listed.objects) keys.push(object.key);
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    if (keys.length > 0) await c.env.BUCKET.delete(keys);
    // Large `sketch-` values live in R2 under data/<slug>/ and go with the artifact.
    await deleteArtifactData(c.env, access.artifact.slug);

    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM page_data WHERE slug = ?1").bind(access.artifact.slug),
      c.env.DB.prepare("DELETE FROM artifact_tags WHERE slug = ?1").bind(access.artifact.slug),
      c.env.DB.prepare("DELETE FROM versions WHERE slug = ?1").bind(access.artifact.slug),
      c.env.DB.prepare("DELETE FROM shares WHERE slug = ?1").bind(access.artifact.slug),
      c.env.DB.prepare("DELETE FROM artifacts WHERE slug = ?1").bind(access.artifact.slug)
    ]);
    await invalidateVersions(access.artifact.slug);
    await invalidateAccess(access.artifact.slug);

    return new Response(null, { status: 204 });
  });

  app.put("/api/artifacts/:slug/shares/:email", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);
    if (!canManage(access.artifact, access.shares, actorOf(c), access.project)) {
      return jsonError("owner access is required", 403);
    }

    const shareEmail = normalizeEmailInput(c.req.param("email"));
    if (!shareEmail) return jsonError("invalid email", 400);
    const role = body.body.role;
    if (!isShareRole(role)) return jsonError("role must be viewer or editor", 400);

    await c.env.DB.prepare(
      "INSERT INTO shares (slug, email, role) VALUES (?1, ?2, ?3) ON CONFLICT (slug, email) DO UPDATE SET role = excluded.role"
    )
      .bind(access.artifact.slug, shareEmail, role)
      .run();
    await invalidateAccess(access.artifact.slug);

    return json({ email: shareEmail, role });
  });

  app.delete("/api/artifacts/:slug/shares/:email", async (c) => {
    const email = c.get("identity").email as string;
    const access = await loadAccessible(c.env, c.req.param("slug"), email);
    if (!access) return jsonError("not found", 404);
    if (!canManage(access.artifact, access.shares, actorOf(c), access.project)) {
      return jsonError("owner access is required", 403);
    }

    const shareEmail = normalizeEmailInput(c.req.param("email"));
    if (!shareEmail) return jsonError("invalid email", 400);

    await c.env.DB.prepare("DELETE FROM shares WHERE slug = ?1 AND email = ?2").bind(access.artifact.slug, shareEmail).run();
    await invalidateAccess(access.artifact.slug);
    return new Response(null, { status: 204 });
  });
}
