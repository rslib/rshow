import { readFile } from 'node:fs/promises';
import { MAX_BLOB_BYTES, MAX_VERSION_BYTES, MAX_VERSION_FILES } from 'rshow-shared';
import type { VersionDetail } from 'rshow-shared';
import type { Client } from './client.ts';
import { ApiError, UsageError } from './exit.ts';
import { buildManifest } from './files.ts';
import type { ManifestEntry } from './files.ts';
import type { Output } from './output.ts';
import { runPool } from './pool.ts';
import { sameTags } from './tags.ts';

export const MISSING_CHUNK = 1000;
export const UPLOAD_CONCURRENCY = 6;

export type PublishOptions = {
  slug: string;
  title?: string;
  label?: string;
  project?: string;
  tags?: string[];
  requireIndex?: boolean;
  force?: boolean;
  beforeUpload?: () => Promise<void>;
};

export type PublishResult = {
  slug: string;
  artifact: any;
  version: any;
  unchanged: boolean;
  files: number;
  hashes: number;
  uploaded: number;
  skipped: number;
  missing: string[];
};

async function ensureArtifact(api: Client, opts: PublishOptions): Promise<any> {
  const slug = opts.slug;
  let artifact = await api.artifact(slug, { allow404: true });
  let created = false;
  if (artifact === undefined) {
    try {
      artifact = await api.createArtifact({
        slug,
        title: opts.title,
        project: opts.project,
        tags: opts.tags,
      });
      created = true;
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 409) throw err;
      artifact = await api.artifact(slug, { allow404: true });
      if (artifact === undefined || artifact.role !== 'owner') {
        throw new ApiError(`slug is taken: ${slug}`, 409);
      }
    }
  }
  if (artifact.role !== 'owner' && artifact.role !== 'editor') {
    throw new ApiError(`no permission to publish to ${slug}`);
  }

  const patch: Record<string, unknown> = {};
  if (opts.title !== undefined && artifact.role === 'owner' && artifact.title !== opts.title) {
    patch.title = opts.title;
  }
  if (!created && opts.project !== undefined && artifact.project !== opts.project) {
    patch.project = opts.project;
  }
  if (!created && opts.tags !== undefined && !sameTags(artifact.tags, opts.tags)) {
    patch.tags = opts.tags;
  }
  if (Object.keys(patch).length > 0) artifact = await api.patchArtifact(slug, patch);
  return artifact;
}

export async function publishTarget(
  api: Client,
  target: string,
  opts: PublishOptions,
): Promise<PublishResult> {
  const manifest = await buildManifest(target, { requireIndex: opts.requireIndex });
  if (manifest.entries.length > MAX_VERSION_FILES) {
    throw new UsageError(`too many files: ${manifest.entries.length} (at most ${MAX_VERSION_FILES})`);
  }

  let total = 0;
  const byHash = new Map<string, ManifestEntry>();
  for (const entry of manifest.entries) {
    total += entry.size;
    if (entry.size > MAX_BLOB_BYTES) throw new UsageError(`file too large: ${entry.path}`);
    if (!byHash.has(entry.hash)) byHash.set(entry.hash, entry);
  }
  if (total > MAX_VERSION_BYTES) throw new UsageError(`version too large: ${total} bytes`);

  const hashes = [...byHash.keys()];

  if (opts.beforeUpload !== undefined) await opts.beforeUpload();

  const artifact = await ensureArtifact(api, opts);

  const latest = artifact.latest;
  if (opts.force !== true && typeof latest === 'number') {
    const existing = await versionOrNull(api, opts.slug, latest);
    if (sameFiles(manifest.files, existing?.files)) {
      return {
        slug: opts.slug,
        artifact,
        version: existing,
        unchanged: true,
        files: manifest.entries.length,
        hashes: hashes.length,
        uploaded: 0,
        skipped: hashes.length,
        missing: [],
      };
    }
  }

  const missing: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hashes.length; i += MISSING_CHUNK) {
    const reply = await api.missingBlobs(hashes.slice(i, i + MISSING_CHUNK));
    for (const hash of reply) {
      if (!byHash.has(hash) || seen.has(hash)) continue;
      seen.add(hash);
      missing.push(hash);
    }
  }

  let uploaded = 0;
  await runPool(missing, UPLOAD_CONCURRENCY, async (hash) => {
    const entry = byHash.get(hash) as ManifestEntry;
    await api.putBlob(hash, await readFile(entry.file));
    uploaded += 1;
  });

  const version = await api.createVersion(opts.slug, { label: opts.label, files: manifest.files });

  return {
    slug: opts.slug,
    artifact,
    version,
    unchanged: false,
    files: manifest.entries.length,
    hashes: hashes.length,
    uploaded,
    skipped: hashes.length - uploaded,
    missing,
  };
}

// A Worker that predates the version read answers 404, so a failed lookup means
// "cannot tell" and the publish goes ahead.
async function versionOrNull(api: Client, slug: string, n: number): Promise<VersionDetail | null> {
  try {
    return await api.version(slug, n);
  } catch {
    return null;
  }
}

// The manifest of a version comes back as path -> {hash, ...}; comparing hashes
// per path is what tells an unchanged folder from a changed one.
function sameFiles(local: Record<string, { hash: string }>, remote: unknown): boolean {
  if (typeof remote !== 'object' || remote === null) return false;
  const paths = Object.keys(local);
  const other = remote as Record<string, { hash?: unknown }>;
  if (paths.length !== Object.keys(other).length) return false;
  return paths.every((path) => other[path]?.hash === local[path]?.hash);
}

export function reportUnchanged(out: Output, result: PublishResult): void {
  out.data({ unchanged: true, slug: result.slug, version: result.version.n });
  out.line(`unchanged: ${result.slug} is already v${result.version.n}`);
}

export function reportPublish(out: Output, result: PublishResult): void {
  out.line(`slug: ${result.slug}`);
  out.line(`version: ${result.version.n}`);
  out.line(`files: ${result.files}`);
  out.line(`uploaded: ${result.uploaded}`);
  out.line(`skipped: ${result.skipped}`);
  if (result.version.label !== undefined && result.version.label !== '') {
    out.line(`label: ${result.version.label}`);
  }
  out.line(`version-url: ${result.version.url}`);
  out.line(`live-url: ${result.artifact.url}`);
}
