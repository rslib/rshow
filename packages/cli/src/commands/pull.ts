import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCommandArgs } from '../args.ts';
import type { Ctx } from '../context.ts';
import { ApiError, UsageError } from '../exit.ts';
import { sha256Hex } from '../files.ts';
import { displayPath } from '../handoff.ts';
import { validateSlug } from '../slug.ts';
import { PULL_USAGE } from '../usage.ts';

const TARGET = /^([^@]+)(?:@v([0-9]+))?$/;

export function parsePullTarget(text: string): { slug: string; version: number | null } {
  const match = TARGET.exec(text);
  if (match === null) throw new UsageError(`expected <slug> or <slug>@v<n>, got: ${text}`);
  const slug = validateSlug(match[1] as string);
  if (match[2] === undefined) return { slug, version: null };
  const version = Number(match[2]);
  if (!Number.isSafeInteger(version) || version < 1) throw new UsageError(`invalid version: ${match[2]}`);
  return { slug, version };
}

async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw err;
  }
}

// The server checks paths too; this keeps a bad manifest from writing outside dir.
function targetFile(dir: string, filePath: string): string {
  const resolved = path.resolve(dir, ...filePath.split('/'));
  const relative = path.relative(dir, resolved);
  const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (relative === '' || outside || filePath.includes('\\')) {
    throw new ApiError(`refusing an unsafe path in the manifest: ${filePath}`);
  }
  return resolved;
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, { force: { type: 'boolean' } }, 1, 2, PULL_USAGE);
  const target = parsePullTarget(args.positionals[0] as string);
  const dir = path.resolve(args.positionals[1] ?? target.slug);
  if (args.values.force !== true && !(await isEmptyOrMissing(dir))) {
    throw new UsageError(`${displayPath(dir)} is not empty (use --force to write into it)`);
  }

  const api = await ctx.api();
  let version = target.version;
  if (version === null) {
    const artifact = await api.artifact(target.slug);
    if (typeof artifact?.served !== 'number') throw new ApiError(`${target.slug} has no version to pull`);
    version = artifact.served as number;
  }
  const detail = await api.version(target.slug, version);
  const entries = Object.entries(detail.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const files = entries.map(([filePath, entry]) => ({ filePath, entry, file: targetFile(dir, filePath) }));

  let bytes = 0;
  for (const { filePath, entry, file } of files) {
    const body = await api.fileBytes(target.slug, version, filePath);
    if (sha256Hex(body) !== entry.hash) throw new ApiError(`${filePath}: the bytes do not match the manifest hash`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    bytes += body.byteLength;
  }

  ctx.out.data({ slug: target.slug, version, dir, files: files.length, bytes });
  ctx.out.line(`slug: ${target.slug}`);
  ctx.out.line(`version: ${version}`);
  ctx.out.line(`files: ${files.length}`);
  ctx.out.line(`bytes: ${bytes}`);
  ctx.out.line(`dir: ${displayPath(dir)}`);
  ctx.out.line(`publish back: rshow publish ${displayPath(dir)} --slug ${target.slug}`);
}
