// rshow ships two ways: as the npm package, where the built-in theme, the skills
// and the worker sit next to dist, and as one executable built by
// `node --build-sea`, where they are assets embedded in the binary. This module
// detects the second case and unpacks the assets once into a per-version cache
// folder, so every reader can keep opening plain files.
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { VERSION } from './version.ts';

// The manifest the build script embeds, and the marker that says a folder is
// complete; both names are shared with packages/cli/scripts/sea.mjs.
export const ASSET_MANIFEST = 'assets.json';
export const COMPLETE_MARKER = '.complete';

type SeaModule = {
  isSea?: () => boolean;
  getRawAsset?: (key: string) => ArrayBuffer;
  getAssetKeys?: () => string[];
};

// node:sea answers false outside a single executable, and an older node may not
// have the module at all, so a load that fails only means "not a binary".
let sea: Promise<SeaModule | undefined> | undefined;

function seaModule(): Promise<SeaModule | undefined> {
  if (sea === undefined) {
    sea = import('node:sea').then(
      (mod) => mod as SeaModule,
      () => undefined,
    );
  }
  return sea;
}

export async function isBinary(): Promise<boolean> {
  const mod = await seaModule();
  if (mod === undefined || typeof mod.isSea !== 'function') return false;
  try {
    return mod.isSea();
  } catch {
    return false;
  }
}

export type AssetBundle = { keys: readonly string[]; read: (key: string) => Uint8Array };

export function cacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = (env.XDG_CACHE_HOME ?? '').trim();
  if (xdg !== '') return path.resolve(xdg);
  const home = (env.HOME ?? '').trim();
  return path.join(home !== '' ? home : homedir(), '.cache');
}

// One folder per version, because the assets of a version never change: an
// upgrade writes a new folder and the old one is simply no longer read.
export function binaryCacheDir(env: NodeJS.ProcessEnv = process.env, version: string = VERSION): string {
  return path.join(cacheRoot(env), 'rshow', version);
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined)) !== undefined;
}

// Writes the bundle into dir through a temporary folder beside it, so that no
// reader ever sees a half-written theme, and does nothing when the marker is
// already there.
export async function extractAssets(bundle: AssetBundle, dir: string): Promise<void> {
  if (await exists(path.join(dir, COMPLETE_MARKER))) return;
  const parent = path.dirname(dir);
  await mkdir(parent, { recursive: true });
  const tmp = await mkdtemp(path.join(parent, `${path.basename(dir)}.tmp-`));
  try {
    for (const key of bundle.keys) {
      const file = path.join(tmp, ...key.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bundle.read(key));
    }
    await writeFile(path.join(tmp, COMPLETE_MARKER), `${VERSION}\n`);
    // A partial folder of the same version is replaced. Two rshow runs that
    // unpack at once write the same bytes, so whichever rename wins is fine.
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

function safeKey(key: string): boolean {
  return key !== '' && !path.isAbsolute(key) && !key.split('/').includes('..');
}

function manifestKeys(read: (key: string) => Uint8Array): string[] {
  try {
    const doc: unknown = JSON.parse(new TextDecoder().decode(read(ASSET_MANIFEST)));
    if (doc !== null && typeof doc === 'object' && Array.isArray((doc as { keys?: unknown }).keys)) {
      const keys = (doc as { keys: unknown[] }).keys.filter((key): key is string => typeof key === 'string');
      if (keys.length > 0) return keys.filter(safeKey);
    }
  } catch {
    // A binary without the manifest still answers getAssetKeys.
  }
  return [];
}

function bundleOf(mod: SeaModule): AssetBundle {
  const raw = mod.getRawAsset as (key: string) => ArrayBuffer;
  const read = (key: string): Uint8Array => new Uint8Array(raw(key));
  const withManifest = manifestKeys(read);
  return { keys: withManifest.length > 0 ? withManifest : (mod.getAssetKeys?.() ?? []).filter(safeKey), read };
}

async function unpack(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (!(await isBinary())) return undefined;
  const mod = await seaModule();
  if (mod?.getRawAsset === undefined) throw new Error('this rshow binary carries no assets');
  const dir = binaryCacheDir(env);
  await extractAssets(bundleOf(mod), dir);
  return dir;
}

let root: Promise<string | undefined> | undefined;

// The unpacked assets' folder, or undefined when rshow is not a single
// executable. The first call does the unpacking; later calls reuse it.
export function binaryRoot(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  if (root === undefined) root = unpack(env);
  return root;
}

export async function binaryThemeBases(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const dir = await binaryRoot(env);
  return dir === undefined ? [] : [path.join(dir, 'themes')];
}

export async function binarySkillBases(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const dir = await binaryRoot(env);
  return dir === undefined ? [] : [path.join(dir, 'skills')];
}
