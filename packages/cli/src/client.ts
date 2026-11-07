import type { VersionDetail } from 'rshow-shared';
import { ApiError, AuthError } from './exit.ts';
import { sendRequest } from './network.ts';
import { VERSION } from './version.ts';

export type SendOptions = {
  json?: unknown;
  bytes?: Uint8Array;
  contentType?: string;
  allow404?: boolean;
};

export type Reply = { status: number; body: any };

type ManifestPayload = Record<string, { hash: string; size: number; type: string }>;

export type ArtifactFilter = { project?: string; tag?: string; q?: string };

export type ArtifactInput = { slug: string; title?: string; project?: string; tags?: string[] };

export type ProjectInput = { slug: string; title?: string; description?: string };

function errorText(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `HTTP ${status}`;
}

function parseBody(text: string): any {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class Client {
  baseUrl: string;
  token: string;
  fetchImpl: typeof fetch;

  constructor(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async send(method: string, pathname: string, opts: SendOptions = {}): Promise<Reply> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.token}`,
      accept: 'application/json',
      'user-agent': `rshow/${VERSION}`,
    };
    let body: string | Uint8Array | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.bytes !== undefined) {
      headers['content-type'] = opts.contentType ?? 'application/octet-stream';
      body = opts.bytes;
    }

    const res = await sendRequest(this.fetchImpl, this.baseUrl + pathname, { method, headers, body });
    const text = await res.text();
    const parsed = parseBody(text);

    if (opts.allow404 === true && res.status === 404) return { status: 404, body: undefined };
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(errorText(parsed, res.status), res.status);
    }
    if (res.status < 200 || res.status > 299) {
      throw new ApiError(errorText(parsed, res.status), res.status);
    }
    return { status: res.status, body: parsed };
  }

  async artifacts(filter: ArtifactFilter = {}): Promise<{ artifacts: any[] }> {
    const params = new URLSearchParams();
    if (filter.project !== undefined) params.set('project', filter.project);
    if (filter.tag !== undefined) params.set('tag', filter.tag);
    if (filter.q !== undefined) params.set('q', filter.q);
    const query = params.toString();
    return (await this.send('GET', `/api/artifacts${query === '' ? '' : `?${query}`}`)).body;
  }

  async artifact(slug: string, opts: { allow404?: boolean } = {}): Promise<any> {
    return (await this.send('GET', `/api/artifacts/${encodeURIComponent(slug)}`, opts)).body;
  }

  async createArtifact(input: ArtifactInput): Promise<any> {
    const payload: ArtifactInput = { slug: input.slug };
    if (input.title !== undefined) payload.title = input.title;
    if (input.project !== undefined) payload.project = input.project;
    if (input.tags !== undefined) payload.tags = input.tags;
    return (await this.send('POST', '/api/artifacts', { json: payload })).body;
  }

  async patchArtifact(slug: string, patch: Record<string, unknown>): Promise<any> {
    return (await this.send('PATCH', `/api/artifacts/${encodeURIComponent(slug)}`, { json: patch })).body;
  }

  async deleteArtifact(slug: string, force = false): Promise<void> {
    await this.send('DELETE', `/api/artifacts/${encodeURIComponent(slug)}${force ? '?force=1' : ''}`);
  }

  async deleteVersion(slug: string, n: number, force = false): Promise<any> {
    const pathname = `/api/artifacts/${encodeURIComponent(slug)}/versions/${n}${force ? '?force=1' : ''}`;
    return (await this.send('DELETE', pathname)).body;
  }

  async putShare(slug: string, email: string, role: 'viewer' | 'editor'): Promise<any> {
    const pathname = `/api/artifacts/${encodeURIComponent(slug)}/shares/${encodeURIComponent(email)}`;
    return (await this.send('PUT', pathname, { json: { role } })).body;
  }

  async deleteShare(slug: string, email: string): Promise<void> {
    const pathname = `/api/artifacts/${encodeURIComponent(slug)}/shares/${encodeURIComponent(email)}`;
    await this.send('DELETE', pathname);
  }

  async projects(): Promise<{ projects: any[] }> {
    return (await this.send('GET', '/api/projects')).body;
  }

  async project(slug: string, opts: { allow404?: boolean } = {}): Promise<any> {
    return (await this.send('GET', `/api/projects/${encodeURIComponent(slug)}`, opts)).body;
  }

  async createProject(input: ProjectInput): Promise<any> {
    const payload: ProjectInput = { slug: input.slug };
    if (input.title !== undefined) payload.title = input.title;
    if (input.description !== undefined) payload.description = input.description;
    return (await this.send('POST', '/api/projects', { json: payload })).body;
  }

  async deleteProject(slug: string): Promise<void> {
    await this.send('DELETE', `/api/projects/${encodeURIComponent(slug)}`);
  }

  async putMember(slug: string, email: string, role: 'viewer' | 'editor'): Promise<any> {
    const pathname = `/api/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(email)}`;
    return (await this.send('PUT', pathname, { json: { role } })).body;
  }

  async deleteMember(slug: string, email: string): Promise<void> {
    const pathname = `/api/projects/${encodeURIComponent(slug)}/members/${encodeURIComponent(email)}`;
    await this.send('DELETE', pathname);
  }

  async missingBlobs(hashes: string[]): Promise<string[]> {
    const reply = (await this.send('POST', '/api/blobs/missing', { json: { hashes } })).body;
    return Array.isArray(reply?.missing) ? reply.missing : [];
  }

  async putBlob(hash: string, bytes: Uint8Array): Promise<void> {
    await this.send('PUT', `/api/blobs/${encodeURIComponent(hash)}`, { bytes });
  }

  async createVersion(
    slug: string,
    input: { label?: string; files: ManifestPayload },
  ): Promise<any> {
    const payload: { label?: string; files: ManifestPayload } = { files: input.files };
    if (input.label !== undefined) payload.label = input.label;
    return (await this.send('POST', `/api/artifacts/${encodeURIComponent(slug)}/versions`, { json: payload })).body;
  }

  async version(slug: string, n: number): Promise<VersionDetail> {
    const pathname = `/api/artifacts/${encodeURIComponent(slug)}/versions/${n}`;
    return (await this.send('GET', pathname)).body;
  }
}
