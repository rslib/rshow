#!/usr/bin/env node
// Assemble the published rshow package: copy the worker bundle, its migrations,
// the skills, the default theme and the root LICENSE into packages/cli so that
// `npm pack` ships a self-contained tarball. Everything copied here is build
// output and is ignored by git; run the worker and cli builds first.
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..'); // packages/cli
const packagesDir = path.resolve(pkgDir, '..'); // packages
const root = path.resolve(packagesDir, '..'); // repo root
const workerDir = path.join(packagesDir, 'worker');
const workerDist = path.join(workerDir, 'dist');

async function bundleFile() {
  const preferred = path.join(workerDist, 'index.js');
  try {
    const info = await stat(preferred);
    if (info.isFile()) return preferred;
  } catch {
    // fall through to scanning
  }
  let entries;
  try {
    entries = await readdir(workerDist);
  } catch {
    throw new Error(`missing ${path.relative(root, workerDist)}: run npm run build -w rshow-worker first`);
  }
  const js = entries.filter((name) => name.endsWith('.js')).sort();
  if (js.length !== 1) {
    throw new Error(`expected exactly one .js bundle in ${workerDist}, found ${js.length ? js.join(', ') : 'none'}`);
  }
  return path.join(workerDist, js[0]);
}

async function copy(src, dst) {
  await rm(dst, { recursive: true, force: true });
  await mkdir(path.dirname(dst), { recursive: true });
  await cp(src, dst, { recursive: true });
  console.log(`assembled ${path.relative(root, dst)}`);
}

async function main() {
  const bundle = await bundleFile();
  const to = (dst) => path.join(pkgDir, dst);

  // The bundle is self-contained (hono and jose inlined), so it is written as a
  // single file; the wrangler source map stays out of the package.
  const dest = to(path.join('worker', 'index.js'));
  await rm(path.dirname(dest), { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  const code = await readFile(bundle, 'utf8');
  await writeFile(dest, code.replace(/^\/\/# sourceMappingURL=.*$\n?/m, ''));
  console.log(`assembled ${path.relative(root, dest)}`);

  await copy(path.join(workerDir, 'migrations'), to(path.join('worker', 'migrations')));
  await copy(path.join(root, 'skills'), to('skills'));
  await copy(path.join(root, 'themes', 'default'), to(path.join('themes', 'default')));
  await copy(path.join(root, 'LICENSE'), to('LICENSE'));
}

main().catch((err) => {
  console.error(`assemble: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
