import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './exit.ts';

export const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  wasm: 'application/wasm',
};

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export type ManifestEntry = { path: string; file: string; hash: string; size: number; type: string };
export type ManifestFile = { hash: string; size: number; type: string };
export type Manifest = { entries: ManifestEntry[]; files: Record<string, ManifestFile> };

const SKIPPED_NAMES = new Set(['node_modules']);

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  return CONTENT_TYPES[ext] ?? DEFAULT_CONTENT_TYPE;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readEntry(abs: string, rel: string): Promise<ManifestEntry> {
  const bytes = await readFile(abs);
  return {
    path: rel,
    file: abs,
    hash: sha256Hex(bytes),
    size: bytes.byteLength,
    type: contentTypeFor(rel),
  };
}

async function collectPaths(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIPPED_NAMES.has(entry.name)) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      found.push(rel);
    }
  }

  await walk(root, '');
  return found;
}

export type ManifestOptions = { requireIndex?: boolean };

export async function buildManifest(input: string, opts: ManifestOptions = {}): Promise<Manifest> {
  const root = path.resolve(input);
  const info = await stat(root).catch(() => undefined);
  if (info === undefined) throw new UsageError(`no such file or folder: ${input}`);

  const entries: ManifestEntry[] = [];
  if (info.isFile()) {
    entries.push(await readEntry(root, 'index.html'));
  } else if (info.isDirectory()) {
    const paths = await collectPaths(root);
    if (opts.requireIndex !== false && !paths.includes('index.html')) {
      throw new UsageError(`${input} has no index.html`);
    }
    for (const rel of paths) entries.push(await readEntry(path.join(root, rel), rel));
  } else {
    throw new UsageError(`not a file or folder: ${input}`);
  }

  const files: Record<string, ManifestFile> = {};
  for (const entry of entries) {
    files[entry.path] = { hash: entry.hash, size: entry.size, type: entry.type };
  }
  return { entries, files };
}
