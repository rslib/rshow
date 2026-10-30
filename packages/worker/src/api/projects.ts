import type { Hono } from "hono";
import { canManageProject, canView, projectRole, roleFor } from "../authz";
import { invalidateProjectAccess } from "../cache";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_TITLE_LENGTH,
  PROJECT_SEGMENT,
  SLUG_PATTERN,
  isShareRole,
  type Project,
  type Role,
  type ShareRole
} from "../constants";
import {
  countArtifactsByProject,
  getProject,
  getProjectMembers,
  listArtifactsInProject,
  listProjectsFor,
  projectInfoOf,
  projectMembershipsForEmail,
  sharesForSlugs,
  tagsForSlugs
} from "../db";
import { json, jsonError } from "../http";
import type { AppEnv, Env, ProjectMemberInfo, ProjectRow } from "../types";
import { actorOf, normalizeEmailInput, readBody, toArtifact, toShare } from "./common";

export function toProject(env: Env, row: ProjectRow, role: Role, artifacts: number): Project {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    owner: row.owner,
    role,
    artifacts,
    updated_at: row.updated_at,
    url: `https://${env.ART_HOST}/${PROJECT_SEGMENT}/${row.slug}/`
  };
}

function roleOnProject(row: ProjectRow, email: string, memberships: Map<string, ShareRole>): Role {
  if (row.owner === email) return "owner";
  return memberships.get(row.slug) === "editor" ? "editor" : "viewer";
}

function projectInfoFor(
  project: ProjectRow,
  members: readonly ProjectMemberInfo[]
): { owner: string; members: ProjectMemberInfo[] } {
  return projectInfoOf(project, members.map((member) => ({ project: project.slug, email: member.email, role: member.role })));
}

export function registerProjects(app: Hono<AppEnv>): void {
  app.get("/api/projects", async (c) => {
    const email = c.get("identity").email as string;
    const rows = await listProjectsFor(c.env, email);
    const memberships = await projectMembershipsForEmail(c.env, email);
    const counts = await countArtifactsByProject(
      c.env,
      rows.map((row) => row.slug)
    );
    const projects = rows.map((row) => toProject(c.env, row, roleOnProject(row, email, memberships), counts.get(row.slug) ?? 0));
    return json({ projects });
  });

  app.post("/api/projects", async (c) => {
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
    const rawDescription = body.body.description;
    if (rawDescription !== undefined && typeof rawDescription !== "string") {
      return jsonError("description must be a string", 400);
    }
    const description = typeof rawDescription === "string" ? rawDescription.trim() : "";
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return jsonError(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`, 400);
    }

    const email = c.get("identity").email as string;
    const existing = await getProject(c.env, slug);
    if (existing) return jsonError("slug is already taken", 409);

    const now = new Date().toISOString();
    try {
      await c.env.DB.prepare(
        "INSERT INTO projects (slug, title, description, owner, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)"
      )
        .bind(slug, title, description, email, now)
        .run();
    } catch {
      return jsonError("slug is already taken", 409);
    }

    const created: ProjectRow = { slug, title, description, owner: email, created_at: now, updated_at: now };
    return json(toProject(c.env, created, "owner", 0), 201);
  });

  app.get("/api/projects/:slug", async (c) => {
    const email = c.get("identity").email as string;
    const project = await getProject(c.env, c.req.param("slug"));
    if (!project) return jsonError("not found", 404);
    const members = await getProjectMembers(c.env, project.slug);
    const info = projectInfoFor(project, members);
    const role = projectRole(info, email);
    if (role === null) return jsonError("not found", 404);

    const rows = await listArtifactsInProject(c.env, project.slug);
    const shares = await sharesForSlugs(
      c.env,
      rows.map((row) => row.slug)
    );
    const visible = rows.filter((row) => canView(row, email, shares.get(row.slug) ?? [], info));
    const tags = await tagsForSlugs(
      c.env,
      visible.map((row) => row.slug)
    );
    const artifacts = visible.map((row) =>
      toArtifact(c.env, row, roleFor(row, email, shares.get(row.slug) ?? [], info) ?? "viewer", tags.get(row.slug) ?? [])
    );

    return json({
      ...toProject(c.env, project, role, artifacts.length),
      members: members.map(toShare),
      artifacts
    });
  });

  app.patch("/api/projects/:slug", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const email = c.get("identity").email as string;
    const project = await getProject(c.env, c.req.param("slug"));
    if (!project) return jsonError("not found", 404);
    const members = await getProjectMembers(c.env, project.slug);
    const info = projectInfoFor(project, members);
    if (!canManageProject(info, actorOf(c))) return jsonError("owner access is required", 403);

    let nextTitle = project.title;
    let nextDescription = project.description;
    const updates: string[] = [];
    const values: string[] = [];

    if (body.body.title !== undefined) {
      if (typeof body.body.title !== "string") return jsonError("title must be a string", 400);
      const title = body.body.title.trim();
      if (title === "" || title.length > MAX_TITLE_LENGTH) return jsonError("title must be 1 to 200 characters", 400);
      nextTitle = title;
      updates.push("title = ?");
      values.push(title);
    }
    if (body.body.description !== undefined) {
      if (typeof body.body.description !== "string") return jsonError("description must be a string", 400);
      const description = body.body.description.trim();
      if (description.length > MAX_DESCRIPTION_LENGTH) {
        return jsonError(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters`, 400);
      }
      nextDescription = description;
      updates.push("description = ?");
      values.push(description);
    }

    const now = new Date().toISOString();
    if (updates.length > 0) {
      await c.env.DB.prepare(`UPDATE projects SET ${updates.join(", ")}, updated_at = ? WHERE slug = ?`)
        .bind(...values, now, project.slug)
        .run();
    }

    const updated: ProjectRow = {
      ...project,
      title: nextTitle,
      description: nextDescription,
      updated_at: updates.length > 0 ? now : project.updated_at
    };
    const counts = await countArtifactsByProject(c.env, [project.slug]);
    return json(toProject(c.env, updated, "owner", counts.get(project.slug) ?? 0));
  });

  app.delete("/api/projects/:slug", async (c) => {
    const project = await getProject(c.env, c.req.param("slug"));
    if (!project) return jsonError("not found", 404);
    const members = await getProjectMembers(c.env, project.slug);
    const info = projectInfoFor(project, members);
    if (!canManageProject(info, actorOf(c))) return jsonError("owner access is required", 403);

    await invalidateProjectAccess(c.env, project.slug);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE artifacts SET project = NULL WHERE project = ?1").bind(project.slug),
      c.env.DB.prepare("DELETE FROM project_members WHERE project = ?1").bind(project.slug),
      c.env.DB.prepare("DELETE FROM projects WHERE slug = ?1").bind(project.slug)
    ]);
    return new Response(null, { status: 204 });
  });

  app.put("/api/projects/:slug/members/:email", async (c) => {
    const body = await readBody(c);
    if (!body.ok) return body.response;
    const project = await getProject(c.env, c.req.param("slug"));
    if (!project) return jsonError("not found", 404);
    const members = await getProjectMembers(c.env, project.slug);
    const info = projectInfoFor(project, members);
    if (!canManageProject(info, actorOf(c))) return jsonError("owner access is required", 403);

    const memberEmail = normalizeEmailInput(c.req.param("email"));
    if (!memberEmail) return jsonError("invalid email", 400);
    const role = body.body.role;
    if (!isShareRole(role)) return jsonError("role must be viewer or editor", 400);

    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT INTO project_members (project, email, role) VALUES (?1, ?2, ?3) ON CONFLICT (project, email) DO UPDATE SET role = excluded.role"
      ).bind(project.slug, memberEmail, role),
      c.env.DB.prepare("UPDATE projects SET updated_at = ?2 WHERE slug = ?1").bind(project.slug, now)
    ]);
    await invalidateProjectAccess(c.env, project.slug);

    return json({ email: memberEmail, role });
  });

  app.delete("/api/projects/:slug/members/:email", async (c) => {
    const project = await getProject(c.env, c.req.param("slug"));
    if (!project) return jsonError("not found", 404);
    const members = await getProjectMembers(c.env, project.slug);
    const info = projectInfoFor(project, members);
    if (!canManageProject(info, actorOf(c))) return jsonError("owner access is required", 403);

    const memberEmail = normalizeEmailInput(c.req.param("email"));
    if (!memberEmail) return jsonError("invalid email", 400);

    await c.env.DB.prepare("DELETE FROM project_members WHERE project = ?1 AND email = ?2")
      .bind(project.slug, memberEmail)
      .run();
    await invalidateProjectAccess(c.env, project.slug);
    return new Response(null, { status: 204 });
  });
}
