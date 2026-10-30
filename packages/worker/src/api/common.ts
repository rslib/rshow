import type { Context } from "hono";
import { roleFor } from "../authz";
import { EMAIL_PATTERN, MAX_TAGS, TAG_PATTERN, type Artifact, type Role, type Share, type ShareRole } from "../constants";
import { getArtifact, getShares, projectAccessFor } from "../db";
import { jsonError } from "../http";
import type { AppEnv, ArtifactRow, Env, ProjectAccess, ShareRow } from "../types";

export type JsonObject = Record<string, unknown>;

export function toArtifact(env: Env, row: ArtifactRow, role: Role, tags: readonly string[] = []): Artifact {
  return {
    slug: row.slug,
    title: row.title,
    owner: row.owner,
    mode: row.mode,
    pinned: row.pinned,
    latest: row.latest,
    served: row.pinned ?? row.latest,
    project: row.project,
    tags: [...tags],
    updated_at: row.updated_at,
    role,
    url: `https://${env.ART_HOST}/${row.slug}/`
  };
}

export function toShare(row: { email: string; role: ShareRole }): Share {
  return { email: row.email, role: row.role };
}

export function actorOf(c: Context<AppEnv>) {
  const identity = c.get("identity");
  return { email: identity.email, scope: identity.scope };
}

export async function readBody(c: Context<AppEnv>): Promise<{ ok: true; body: JsonObject } | { ok: false; response: Response }> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    return { ok: false, response: jsonError("expected a JSON body", 400) };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: jsonError("expected a JSON object", 400) };
  }
  return { ok: true, body: parsed as JsonObject };
}

export function normalizeEmailInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function parseTags(value: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: "tags must be an array" };
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { ok: false, error: "tags must be strings" };
    const tag = item.trim().toLowerCase();
    if (!TAG_PATTERN.test(tag)) return { ok: false, error: `invalid tag: ${item}` };
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { ok: false, error: `at most ${MAX_TAGS} tags` };
  tags.sort();
  return { ok: true, tags };
}

export async function loadAccessible(
  env: Env,
  slug: string,
  email: string
): Promise<{ artifact: ArtifactRow; shares: ShareRow[]; project: ProjectAccess | null; role: Role } | null> {
  const artifact = await getArtifact(env, slug);
  if (!artifact) return null;
  const shares = await getShares(env, slug);
  const project = await projectAccessFor(env, artifact.project);
  const role = roleFor(artifact, email, shares, project);
  if (role === null) return null;
  return { artifact, shares, project, role };
}
