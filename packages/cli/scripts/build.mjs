#!/usr/bin/env node
// Bundle the CLI so the published package does not need rshow-shared at runtime.
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const pkgDir = path.resolve(import.meta.dirname, '..');

async function main() {
  const pkg = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'));
  await rm(path.join(pkgDir, 'dist'), { recursive: true, force: true });
  await build({
    absWorkingDir: pkgDir,
    entryPoints: ['src/main.ts'],
    outfile: 'dist/main.js',
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: '#!/usr/bin/env node' },
    define: { __RSHOW_VERSION__: JSON.stringify(pkg.version) },
    minify: false,
    packages: 'external',
    external: ['node:*'],
    plugins: [
      {
        name: 'workspace',
        setup(build) {
          build.onResolve({ filter: /^rshow-shared$/ }, () => ({
            path: path.join(pkgDir, '..', 'shared', 'src', 'index.ts'),
          }));
        },
      },
      {
        name: 'entry',
        setup(build) {
          build.onLoad({ filter: /src\/main\.ts$/ }, async (args) => ({
            contents: (await readFile(args.path, 'utf8')).replace(/^#!.*\n/, ''),
            loader: 'ts',
          }));
        },
      },
    ],
  });
}

main().catch((err) => {
  console.error(`build: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
