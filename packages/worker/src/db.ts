import { MAX_D1_BOUND_PARAMS, type ShareRole } from "./constants";
import type {
  ArtifactRow,
  Env,
  ProjectAccess,
  ProjectMemberInfo,
  ProjectMemberRow,
  ProjectRow,
  ShareRow,
  VersionRow
} from "./types";

const ARTIFACT_COLUMNS =
  "slug, title, owner, mode, pinned, latest, last_n, version_gen, project, created_at, updated_at";
const PROJECT_COLUMNS = "slug, title, description, owner, created_at, updated_at";

export interface ArtifactFilter {
  tag?: string;
  project?: string;
  q?: string;
}

export async function getArtifact(env: Env, slug: string): Promise<ArtifactRow | null> {
  return await env.DB.prepare(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE slug = ?1`)
    .bind(slug)
    .first<ArtifactRow>();
}

export async function getShares(env: Env, slug: string): Promise<ShareRow[]> {
  const result = await env.DB.prepare("SELECT slug, email, role FROM shares WHERE slug = ?1 ORDER BY email")
    .bind(slug)
    .all<ShareRow>();
  return result.results ?? [];
}

export async function getShare(env: Env, slug: string, email: string): Promise<ShareRow | null> {
  return await env.DB.prepare("SELECT slug, email, role FROM shares WHERE slug = ?1 AND email = ?2")
    .bind(slug, email)
    .first<ShareRow>();
}

export async function sharesForSlugs(env: Env, slugs: readonly string[]): Promise<Map<string, ShareRow[]>> {
  const unique = [...new Set(slugs)];
  const map = new Map<string, ShareRow[]>();
  for (let offset = 0; offset < unique.length; offset += MAX_D1_BOUND_PARAMS) {
    const chunk = unique.slice(offset, offset + MAX_D1_BOUND_PARAMS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const result = await env.DB.prepare(`SELECT slug, email, role FROM shares WHERE slug IN (${placeholders}) ORDER BY email`)
      .bind(...chunk)
      .all<ShareRow>();
    for (const row of result.results ?? []) {
      const rows = map.get(row.slug) ?? [];
      rows.push(row);
      map.set(row.slug, rows);
    }
  }
  return map;
}

export async function getVersion(env: Env, slug: string, n: number): Promise<VersionRow | null> {
  return await env.DB.prepare(
    "SELECT slug, n, label, manifest_key, files, bytes, created_by, created_at FROM versions WHERE slug = ?1 AND n = ?2"
  )
    .bind(slug, n)
    .first<VersionRow>();
}

export async function listVersions(env: Env, slug: string): Promise<VersionRow[]> {
  const result = await env.DB.prepare(
    "SELECT slug, n, label, manifest_key, files, bytes, created_by, created_at FROM versions WHERE slug = ?1 ORDER BY n DESC"
  )
    .bind(slug)
    .all<VersionRow>();
  return result.results ?? [];
}

export async function countVersions(env: Env, slug: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM versions WHERE slug = ?1")
    .bind(slug)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function servedVersion(env: Env, artifact: ArtifactRow): Promise<VersionRow | null> {
  const n = artifact.pinned ?? artifact.latest;
  if (n === null) return null;
  return await getVersion(env, artifact.slug, n);
}

export async function sharesForEmail(env: Env, email: string): Promise<Map<string, ShareRow>> {
  const result = await env.DB.prepare("SELECT slug, email, role FROM shares WHERE email = ?1").bind(email).all<ShareRow>();
  const map = new Map<string, ShareRow>();
  for (const row of result.results ?? []) map.set(row.slug, row);
  return map;
}

export async function listArtifactsFor(env: Env, email: string, filter: ArtifactFilter = {}): Promise<ArtifactRow[]> {
  const params: string[] = [email];
  const clauses = [
    "(owner = ?1 OR slug IN (SELECT slug FROM shares WHERE email = ?1) OR project IN (SELECT project FROM project_members WHERE email = ?1) OR project IN (SELECT slug FROM projects WHERE owner = ?1))"
  ];

  if (filter.project !== undefined) {
    params.push(filter.project);
    clauses.push(`project = ?${params.length}`);
  }
  if (filter.tag !== undefined) {
    params.push(filter.tag);
    clauses.push(`slug IN (SELECT slug FROM artifact_tags WHERE tag = ?${params.length})`);
  }
  if (filter.q !== undefined && filter.q !== "") {
    const like = `%${filter.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    params.push(like);
    const slugParam = params.length;
    params.push(like);
    const titleParam = params.length;
    clauses.push(`(slug LIKE ?${slugParam} ESCAPE '\\' OR title LIKE ?${titleParam} ESCAPE '\\')`);
  }

  const result = await env.DB.prepare(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, slug`
  )
    .bind(...params)
    .all<ArtifactRow>();
  return result.results ?? [];
}

export async function listArtifactsInProject(env: Env, project: string): Promise<ArtifactRow[]> {
  const result = await env.DB.prepare(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE project = ?1 ORDER BY updated_at DESC, slug`
  )
    .bind(project)
    .all<ArtifactRow>();
  return result.results ?? [];
}

export async function getProject(env: Env, slug: string): Promise<ProjectRow | null> {
  return await env.DB.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE slug = ?1`)
    .bind(slug)
    .first<ProjectRow>();
}

export async function getProjectMembers(env: Env, project: string): Promise<ProjectMemberRow[]> {
  const result = await env.DB.prepare("SELECT project, email, role FROM project_members WHERE project = ?1 ORDER BY email")
    .bind(project)
    .all<ProjectMemberRow>();
  return result.results ?? [];
}

export async function getProjectMember(env: Env, project: string, email: string): Promise<ProjectMemberRow | null> {
  return await env.DB.prepare("SELECT project, email, role FROM project_members WHERE project = ?1 AND email = ?2")
    .bind(project, email)
    .first<ProjectMemberRow>();
}

export async function listProjectsFor(env: Env, email: string): Promise<ProjectRow[]> {
  const result = await env.DB.prepare(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE owner = ?1 OR slug IN (SELECT project FROM project_members WHERE email = ?1) ORDER BY updated_at DESC, slug`
  )
    .bind(email)
    .all<ProjectRow>();
  return result.results ?? [];
}

export async function projectAccessFor(env: Env, slug: string | null): Promise<ProjectAccess | null> {
  if (slug === null) return null;
  const project = await getProject(env, slug);
  if (!project) return null;
  const members = await getProjectMembers(env, slug);
  return { slug, owner: project.owner, members: members.map((row) => ({ email: row.email, role: row.role })) };
}

export async function projectMembershipsForEmail(env: Env, email: string): Promise<Map<string, ShareRole>> {
  const result = await env.DB.prepare("SELECT project, role FROM project_members WHERE email = ?1")
    .bind(email)
    .all<{ project: string; role: ShareRole }>();
  const map = new Map<string, ShareRole>();
  for (const row of result.results ?? []) map.set(row.project, row.role);
  return map;
}

export async function ownedProjectSlugs(env: Env, email: string): Promise<Set<string>> {
  const result = await env.DB.prepare("SELECT slug FROM projects WHERE owner = ?1").bind(email).all<{ slug: string }>();
  return new Set((result.results ?? []).map((row) => row.slug));
}

export async function countArtifactsByProject(env: Env, projects: readonly string[]): Promise<Map<string, number>> {
  const unique = [...new Set(projects)];
  const counts = new Map<string, number>();
  for (let offset = 0; offset < unique.length; offset += MAX_D1_BOUND_PARAMS) {
    const chunk = unique.slice(offset, offset + MAX_D1_BOUND_PARAMS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const result = await env.DB.prepare(
      `SELECT project, COUNT(*) AS total FROM artifacts WHERE project IN (${placeholders}) GROUP BY project`
    )
      .bind(...chunk)
      .all<{ project: string; total: number }>();
    for (const row of result.results ?? []) counts.set(row.project, row.total);
  }
  return counts;
}

export async function getArtifactTags(env: Env, slug: string): Promise<string[]> {
  const result = await env.DB.prepare("SELECT tag FROM artifact_tags WHERE slug = ?1 ORDER BY tag")
    .bind(slug)
    .all<{ tag: string }>();
  return (result.results ?? []).map((row) => row.tag);
}

export async function tagsForSlugs(env: Env, slugs: readonly string[]): Promise<Map<string, string[]>> {
  const unique = [...new Set(slugs)];
  const map = new Map<string, string[]>();
  for (let offset = 0; offset < unique.length; offset += MAX_D1_BOUND_PARAMS) {
    const chunk = unique.slice(offset, offset + MAX_D1_BOUND_PARAMS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const result = await env.DB.prepare(
      `SELECT slug, tag FROM artifact_tags WHERE slug IN (${placeholders}) ORDER BY slug, tag`
    )
      .bind(...chunk)
      .all<{ slug: string; tag: string }>();
    for (const row of result.results ?? []) {
      const tags = map.get(row.slug) ?? [];
      tags.push(row.tag);
      map.set(row.slug, tags);
    }
  }
  return map;
}

export async function tagCountsForSlugs(env: Env, slugs: readonly string[]): Promise<Map<string, number>> {
  const unique = [...new Set(slugs)];
  const counts = new Map<string, number>();
  for (let offset = 0; offset < unique.length; offset += MAX_D1_BOUND_PARAMS) {
    const chunk = unique.slice(offset, offset + MAX_D1_BOUND_PARAMS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const result = await env.DB.prepare(
      `SELECT tag, COUNT(*) AS total FROM artifact_tags WHERE slug IN (${placeholders}) GROUP BY tag`
    )
      .bind(...chunk)
      .all<{ tag: string; total: number }>();
    for (const row of result.results ?? []) counts.set(row.tag, row.total);
  }
  return counts;
}

export function projectInfoOf(project: ProjectRow, members: readonly ProjectMemberRow[]): {
  owner: string;
  members: ProjectMemberInfo[];
} {
  return { owner: project.owner, members: members.map((row) => ({ email: row.email, role: row.role })) };
}

export async function countPageDataKeys(env: Env, slug: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM page_data WHERE slug = ?1")
    .bind(slug)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

export async function blobSizes(env: Env, hashes: readonly string[]): Promise<Map<string, number>> {
  const unique = [...new Set(hashes)];
  const sizes = new Map<string, number>();
  for (let offset = 0; offset < unique.length; offset += MAX_D1_BOUND_PARAMS) {
    const chunk = unique.slice(offset, offset + MAX_D1_BOUND_PARAMS);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const result = await env.DB.prepare(`SELECT hash, size FROM blobs WHERE hash IN (${placeholders})`)
      .bind(...chunk)
      .all<{ hash: string; size: number }>();
    for (const row of result.results ?? []) sizes.set(row.hash, row.size);
  }
  return sizes;
}

export async function recordBlob(env: Env, hash: string, size: number, createdAt: string): Promise<void> {
  await env.DB.prepare("INSERT INTO blobs (hash, size, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (hash) DO NOTHING")
    .bind(hash, size, createdAt)
    .run();
}
