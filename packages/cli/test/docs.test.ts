import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { commandRows } from '../src/commands/docs.ts';
import { EXIT } from '../src/exit.ts';
import { builtinThemeDir, themeTokenSets } from '../src/themes.ts';
import { PUBLISH_USAGE, THEME_NEW_USAGE, usageLine } from '../src/usage.ts';
import { runCli } from './helpers.ts';

const REPOSITORY_REFERENCE = fileURLToPath(new URL('../../../docs/reference', import.meta.url));
const STALE_HINT = 'run `node packages/cli/src/main.ts docs --out docs/reference`';

async function generate(env: Record<string, string> = {}): Promise<string> {
  const out = await mkdtemp(path.join(tmpdir(), 'rshow-docs-'));
  const result = await runCli(['docs', '--out', out], env);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  return out;
}

// Every file under `dir`, as a path to its bytes.
async function readTree(dir: string, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [name, text] of await readTree(dir, rel)) out.set(name, text);
    } else {
      out.set(rel, await readFile(path.join(dir, rel), 'utf8'));
    }
  }
  return out;
}

test('docs writes a page per command, an index and the reference pages', async () => {
  const out = await generate();
  const files = await readTree(out);
  const names = [...files.keys()].sort();

  assert.ok(names.includes('commands/index.md'));
  assert.ok(names.includes('theme-tokens.md'));
  assert.ok(names.includes('exit-codes.md'));
  assert.ok(names.includes('commands/theme.md'));
  assert.ok(names.includes('commands/theme-new.md'));
  assert.ok(names.includes('commands/project-share.md'));

  const index = files.get('commands/index.md') ?? '';
  assert.match(index, /^\| Command \| What it does \|$/m);
  for (const row of commandRows()) {
    assert.ok(index.includes(`[\`rshow ${row.name}\`](${row.file})`), `the index links ${row.name}`);
    assert.ok(names.includes(`commands/${row.file}`), `a page for ${row.name}`);
  }

  assert.ok((files.get('commands/publish.md') ?? '').includes(usageLine(PUBLISH_USAGE)));
  assert.ok((files.get('commands/theme-new.md') ?? '').includes(usageLine(THEME_NEW_USAGE)));
  for (const [name, text] of files) {
    if (!name.startsWith('commands/') || name === 'commands/index.md') continue;
    assert.match(text, /^# rshow [a-z]/m, `${name} starts with a title`);
    assert.ok(text.includes('```sh\nusage: rshow'), `${name} holds the usage text in a code block`);
  }
});

test('docs writes the same bytes on every run', async () => {
  const first = await readTree(await generate());
  const second = await readTree(await generate());
  assert.deepEqual([...second.keys()].sort(), [...first.keys()].sort());
  for (const [name, text] of first) assert.equal(second.get(name), text, `${name} is deterministic`);
});

test('docs lists every custom property of the built-in theme with its role', async () => {
  const out = await generate();
  const page = await readFile(path.join(out, 'theme-tokens.md'), 'utf8');
  const dir = (await builtinThemeDir('default')) as string;
  const sets = await themeTokenSets(dir);

  assert.match(page, /^\| Token \| Light \| Dark \| Role \|$/m);
  for (const token of sets.light) {
    assert.ok(page.includes(`| \`${token.name}\` |`), `the page lists ${token.name}`);
  }
  for (const token of sets.dark) {
    assert.ok(page.includes(`\`${token.value}\``), `the page lists the dark value of ${token.name}`);
  }
  assert.match(page, /^\| `--bg` \| `#ffffff` \| `#161616` \| the ground of a page/m);
  assert.match(page, /^\| `--chart-1` \| `#[0-9a-f]{6}` \| `#[0-9a-f]{6}` \| a categorical series/m);
  assert.match(page, /^\| `--support-error` \| `#[0-9a-f]{6}` \| `#[0-9a-f]{6}` \| a data mark/m);
});

test('docs lists every exit code of the CLI', async () => {
  const out = await generate();
  const page = await readFile(path.join(out, 'exit-codes.md'), 'utf8');
  assert.match(page, /^\| Code \| Name \| When \|$/m);
  for (const [name, code] of Object.entries(EXIT)) {
    assert.match(page, new RegExp(`^\\| ${code} \\| ${name} \\| \\S`, 'm'), `the page lists ${name}`);
  }
});

test('docs needs --out and prints its usage', async () => {
  const missing = await runCli(['docs']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^rshow: docs needs --out <dir> \(try: usage: rshow docs --out <dir>\)$/m);

  const help = await runCli(['docs', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: rshow docs --out <dir>$/m);
});

test('docs/reference in the repository is current', async () => {
  const generated = await readTree(await generate());
  const committed = await readTree(REPOSITORY_REFERENCE).catch(() => new Map<string, string>());
  const names = [...new Set([...generated.keys(), ...committed.keys()])].sort();
  const stale = names.filter(
    (name) => !generated.has(name) || !committed.has(name) || generated.get(name) !== committed.get(name),
  );
  assert.deepEqual(stale, [], `docs/reference is stale (${stale.join(', ')}); ${STALE_HINT}`);
});
