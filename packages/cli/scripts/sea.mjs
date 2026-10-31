#!/usr/bin/env node
// Build rshow as one executable for this machine: the built CLI bundled as
// CommonJS, with the assembled package files embedded as SEA assets.
// Run `npm run build` first; everything embedded here is build output.
//
// Usage: node packages/cli/scripts/sea.mjs [--out <file>]
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const pkgDir = path.resolve(import.meta.dirname, '..');

// Asset keys equal the path of the file in the package, which is what the
// runtime unpacks into its cache; the manifest names them so that a binary does
// not need getAssetKeys.
const ASSET_DIRS = [
  'worker',
  'skills',
  path.join('themes', 'default'),
];
const ASSET_FILES = ['LICENSE'];
const MANIFEST = 'assets.json';

const PLATFORMS = ['darwin', 'linux'];
const ARCHES = ['x64', 'arm64'];

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

function usage() {
  return 'usage: node packages/cli/scripts/sea.mjs [--out <file>]';
}

function outputPathOf(argv) {
  let out;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      const value = argv[i + 1];
      if (value === undefined || value === '') throw new Error(`--out needs a file (${usage()})`);
      out = value;
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg} (${usage()})`);
    }
  }
  if (out !== undefined) return path.resolve(out);
  const platform = process.platform;
  const arch = process.arch;
  if (!PLATFORMS.includes(platform) || !ARCHES.includes(arch)) {
    throw new Error(`no binary for ${platform}-${arch} (use --out to name the file)`);
  }
  return path.join(pkgDir, 'sea', `rshow-${platform}-${arch}`);
}

async function isFile(file) {
  const info = await stat(file).catch(() => undefined);
  return info !== undefined && info.isFile();
}

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, rel)));
    else if (entry.isFile()) out.push(rel);
  }
  return out.sort();
}

async function collectAssets() {
  const assets = new Map();
  for (const dir of ASSET_DIRS) {
    // listFiles returns paths relative to the package, which are the keys.
    for (const rel of await listFiles(pkgDir, dir)) {
      assets.set(rel.split(path.sep).join('/'), path.join(pkgDir, rel));
    }
  }
  for (const name of ASSET_FILES) assets.set(name, path.join(pkgDir, name));
  return assets;
}

// The SEA entry point is CommonJS in every node that can build one, so the ESM
// bundle is bundled again as CJS. import.meta is empty there, which the sources
// guard for: a binary reads its files from the unpacked cache.
async function bundleCommonJs(entry, outfile) {
  const result = await build({
    absWorkingDir: pkgDir,
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['node:*'],
    logLevel: 'warning',
    logOverride: { 'empty-import-meta': 'silent' },
  });
  if (result.errors.length > 0) throw new Error(`cannot bundle ${path.relative(pkgDir, entry)} as CommonJS`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error !== undefined) throw new Error(`${command}: ${messageOf(result.error)}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail === '' ? '' : `: ${detail}`}`);
  }
  return result;
}

// An arm64 binary that no longer matches its signature is killed on launch;
// node --build-sea rewrites the executable, so sign it again ad hoc.
function adhocSign(file) {
  spawnSync('codesign', ['--remove-signature', file], { encoding: 'utf8' });
  run('codesign', ['--sign', '-', file]);
}

function sizeOf(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const out = outputPathOf(process.argv.slice(2));
  const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  const bundle = path.join(pkgDir, 'dist', 'main.js');
  if (!(await isFile(bundle))) throw new Error(`missing ${path.relative(process.cwd(), bundle)}: run npm run build first`);
  const assets = await collectAssets();
  if (assets.size === 0) throw new Error(`no assets to embed: run npm run build first`);

  const work = await mkdtemp(path.join(tmpdir(), 'rshow-sea-'));
  try {
    const entry = path.join(work, 'main.cjs');
    await bundleCommonJs(bundle, entry);

    const keys = [...assets.keys()].sort();
    const manifest = path.join(work, MANIFEST);
    await writeFile(manifest, `${JSON.stringify({ version: pkg.version, keys }, null, 2)}\n`);

    const config = path.join(work, 'sea.json');
    const seaConfig = {
      main: entry,
      output: out,
      assets: { [MANIFEST]: manifest, ...Object.fromEntries(keys.map((key) => [key, assets.get(key)])) },
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      useSnapshot: false,
      // Node reads the proxy environment only at startup, and the binary runs
      // where nobody can add the variable in front of it. --use-system-ca is
      // left out: the runtime merge honours RSHOW_SYSTEM_CA=0, the flag would not.
      execArgv: ['--use-env-proxy'],
    };
    await writeFile(config, `${JSON.stringify(seaConfig, null, 2)}\n`);

    await mkdir(path.dirname(out), { recursive: true });
    run(process.execPath, ['--build-sea', config]);
    await chmod(out, 0o755);
    if (process.platform === 'darwin') adhocSign(out);

    const info = await stat(out);
    process.stdout.write(`sea: ${path.relative(process.cwd(), out)} (${sizeOf(info.size)}, ${keys.length} assets)\n`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`sea: ${messageOf(err)}\n`);
  process.exit(1);
});
