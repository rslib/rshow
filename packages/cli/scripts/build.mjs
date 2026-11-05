#!/usr/bin/env node
// Bundle the CLI so the published package does not need rshow-shared at runtime.
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkgDir = path.resolve(import.meta.dirname, '..');

// katex is a devDependency, because rshow ships no runtime dependencies: the
// whole library goes into the bundle, which is also what the single executable
// and `rshow check` read.
const KATEX = fileURLToPath(import.meta.resolve('katex'));

// MIT asks for its notice in every copy, and the single binary ships no fonts
// folder for a reader to open, so the licence of the bundled KaTeX goes at the
// top of the bundle, after the shebang and under a comment block.
async function katexNotice() {
  const text = await readFile(path.join(path.dirname(KATEX), '..', 'LICENSE'), 'utf8');
  const body = text.trimEnd().split('\n').map((line) => (line === '' ? ' *' : ` * ${line}`));
  return ['/*', ' * KaTeX, bundled into this file, https://github.com/KaTeX/KaTeX', ' *', ...body, ' */'].join('\n');
}

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
    banner: { js: ['#!/usr/bin/env node', await katexNotice()].join('\n') },
    define: { __RSHOW_VERSION__: JSON.stringify(pkg.version) },
    minify: false,
    packages: 'external',
    external: ['node:*'],
    plugins: [
      {
        name: 'katex',
        setup(build) {
          build.onResolve({ filter: /^katex$/ }, () => ({ path: KATEX }));
        },
      },
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
