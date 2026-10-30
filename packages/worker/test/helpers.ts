import { SELF } from "cloudflare:test";
import { sha256Hex } from "../src/auth";
import { callCounts, resetCallCounts, type CallCounts } from "../src/metrics";

export type { CallCounts };

export const ART = "https://art.example.com";
export const ARTD = "https://artd.example.com";
export const OWNER = "owner@example.com";
export const EDITOR = "editor@example.com";
export const VIEWER = "viewer@example.com";
export const STRANGER = "stranger@example.com";

export interface CallOptions {
  email?: string | null;
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
  omitOrigin?: boolean;
  omitContentType?: boolean;
  raw?: BodyInit;
}

export async function api(method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  if (options.email !== null) headers["x-dev-email"] = options.email ?? OWNER;
  if (options.token) headers["authorization"] = `Bearer ${options.token}`;
  const unsafe = method !== "GET" && method !== "HEAD";
  if (unsafe && !options.omitOrigin && headers["origin"] === undefined) headers["origin"] = ARTD;
  if (unsafe && !options.omitContentType && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }

  let body: BodyInit | undefined;
  if (options.raw !== undefined) body = options.raw;
  else if (options.body !== undefined) body = JSON.stringify(options.body);

  return await SELF.fetch(new URL(path, ARTD), { method, headers, body, redirect: "manual" });
}

export async function viewer(path: string, email: string | null = null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (email !== null) headers.set("x-dev-email", email);
  return await SELF.fetch(new URL(path, ART), { ...init, headers, redirect: "manual" });
}

export async function hashOf(body: string): Promise<string> {
  return await sha256Hex(new TextEncoder().encode(body));
}

export async function createArtifact(slug: string, email = OWNER, title?: string): Promise<Response> {
  return await api("POST", "/api/artifacts", { email, body: { slug, title } });
}

export async function uploadBlob(body: string, email = OWNER): Promise<string> {
  const hash = await hashOf(body);
  const res = await api("PUT", `/api/blobs/${hash}`, { email, raw: body, omitContentType: true });
  if (res.status !== 204) throw new Error(`blob upload failed: ${res.status} ${await res.text()}`);
  return hash;
}

export async function createProject(slug: string, email = OWNER, extra: { title?: string; description?: string } = {}): Promise<Response> {
  return await api("POST", "/api/projects", { email, body: { slug, ...extra } });
}

export async function addProjectMember(
  project: string,
  memberEmail: string,
  role: "viewer" | "editor",
  email = OWNER
): Promise<Response> {
  return await api("PUT", `/api/projects/${project}/members/${encodeURIComponent(memberEmail)}`, {
    email,
    body: { role }
  });
}

export interface FileSpec {
  path: string;
  body: string;
  type: string;
}

export async function publishFiles(slug: string, files: FileSpec[], email = OWNER): Promise<Response> {
  const manifest: Record<string, { hash: string; size: number; type: string }> = {};
  for (const file of files) {
    const hash = await uploadBlob(file.body, email);
    manifest[file.path] = { hash, size: new TextEncoder().encode(file.body).byteLength, type: file.type };
  }
  return await api("POST", `/api/artifacts/${slug}/versions`, { email, body: { files: manifest } });
}

export const INDEX_HTML: FileSpec = {
  path: "index.html",
  body: "<!doctype html><title>one</title><p>hello one</p>",
  type: "text/html"
};

export async function setMode(slug: string, mode: string, email = OWNER): Promise<void> {
  const res = await api("PATCH", `/api/artifacts/${slug}`, { email, body: { mode } });
  if (res.status !== 200) throw new Error(`patch failed: ${res.status} ${await res.text()}`);
}

export async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

export function resetCalls(): void {
  resetCallCounts();
}

export function readCalls(): CallCounts {
  return callCounts();
}

export async function awaitCachedBlob(hash: string): Promise<void> {
  const key = `https://rshow.internal/blob/${hash}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await caches.default.match(key)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("blob was not cached in time");
}
