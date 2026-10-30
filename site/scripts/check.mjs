// Usage: node scripts/check.mjs <guides|reference|theme>
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(site, '..');
const dist = join(site, 'dist');

function ok(message) {
  console.log(`ok: ${message}`);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
  ok(message);
}

function build(args = [], env = {}) {
  return spawnSync('npm', ['run', 'build', '--silent', ...(args.length ? ['--', ...args] : [])], {
    cwd: site,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function buildOrFail(args = [], env = {}) {
  const result = build(args, env);
  if (result.status !== 0) fail(`site build failed\n${result.stdout}\n${result.stderr}`);
  return result;
}

function page(outDir, route) {
  const file = join(outDir, route, 'index.html');
  if (!existsSync(file)) fail(`missing built page ${file}`);
  return readFileSync(file, 'utf8');
}

function titleOf(html) {
  return (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? '';
}

function firstHeading(file) {
  const line = readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('# '));
  return line.slice(2).trim();
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// docs/api.md is a reference page, so it is not one of the guides.
const NOT_A_GUIDE = ['api.md'];

function guides() {
  buildOrFail();
  const docs = join(root, 'docs');
  for (const name of readdirSync(docs).filter((f) => f.endsWith('.md') && !NOT_A_GUIDE.includes(f))) {
    const slug = name.replace(/\.md$/, '');
    const title = firstHeading(join(docs, name));
    const html = page(dist, `guides/${slug}`);
    assert(titleOf(html).includes(escapeHtml(title)), `guides/${slug} is titled "${title}"`);
  }
  const home = page(dist, '');
  assert(home.includes('npm i -g rshow'), 'start page has the install text from the README');
  assert(home.includes('rshow init'), 'start page has the quickstart from the README');

  const work = mkdtempSync(join(tmpdir(), 'rshow-site-'));
  try {
    const extra = join(work, 'docs');
    mkdirSync(extra);

    writeFileSync(
      join(extra, 'new-guide.md'),
      '# How to try a new guide\n\nA new guide needs no site change.\n\n' +
        '> [!WARNING]\n> A pinned version stays.\n> The host says `publish <dir>` in code.\n\n' +
        'The reason names <slug> and <version> in plain text.\n',
    );
    const out = join(work, 'out-new');
    buildOrFail(['--outDir', out], { RSHOW_SITE_EXTRA_DOCS: extra });
    const newPage = page(out, 'guides/new-guide');
    assert(titleOf(newPage).includes('How to try a new guide'), 'new guide page has the title How to try a new guide');
    assert(/class="starlight-aside starlight-aside--caution"/.test(newPage), 'a GitHub WARNING alert becomes a caution callout');
    assert(newPage.includes('A pinned version stays.'), 'the callout keeps its text');
    assert(newPage.includes('names &lt;slug&gt; and &lt;version&gt; in plain text'), 'a plain-text placeholder shows as text');
    assert(/<code[^>]*>publish &lt;dir&gt;<\/code>/.test(newPage), 'a placeholder in code stays as it is');
    assert(page(out, '').includes('/rshow/guides/new-guide/'), 'sidebar lists the new guide');

    writeFileSync(join(extra, 'new-guide.md'), '# Broken\n\nSee [the missing guide](missing.md).\n');
    const bad = build(['--outDir', join(work, 'out-bad')], { RSHOW_SITE_EXTRA_DOCS: extra });
    assert(bad.status !== 0, 'build exits non-zero on a link to missing.md');
    assert(/missing/.test(bad.stdout + bad.stderr), 'build output names missing');
  } finally {
    rmSync(work, { recursive: true, force: true });
    spawnSync('node', ['scripts/sync.mjs'], { cwd: site });
  }
}

function reference() {
  buildOrFail();
  const commands = page(dist, 'reference/commands');
  assert(
    /<a href="\/rshow\/reference\/commands\/publish\/"[^>]*><code[^>]*>rshow publish<\/code><\/a>/.test(commands),
    'commands overview links publish',
  );
  const publish = page(dist, 'reference/commands/publish');
  assert(/<pre[^>]*data-language="sh"/.test(publish), 'the publish page holds a shell code block');
  assert(publish.includes('usage: rshow publish'), 'the publish page holds the usage text');

  const tokens = page(dist, 'reference/theme-tokens');
  for (const token of ['--bg', '--accent', '--chart-1']) {
    assert(new RegExp(`<code[^>]*>${token}</code>`).test(tokens), `the theme tokens page lists ${token}`);
  }
  assert(/the ground of a page, a deck slide, a report/.test(tokens), 'a token row carries its role');

  const exits = page(dist, 'reference/exit-codes');
  assert(/<td>7<\/td>/.test(exits) && exits.includes('compare'), 'the exit codes page lists 7 for compare');

  const api = page(dist, 'reference/api');
  assert(api.includes('art.example.com') && api.includes('artd.example.com'), 'the API page names the example hosts');
  assert(!/rs\.ht/.test(api), 'the API page holds no host of the author');
}

function cssOf(html) {
  return [...html.matchAll(/<link rel="stylesheet" href="\/rshow\/([^"]+\.css)"/g)]
    .map((m) => readFileSync(join(dist, m[1]), 'utf8'))
    .join('\n');
}

function theme() {
  buildOrFail();
  const index = page(dist, '');
  assert(/class="rs-title-org[^"]*"[^>]*>rslib</.test(index), 'the site title shows rslib/');
  assert(/class="rs-title-project[^"]*"[^>]*>rshow</.test(index), 'the site title shows rshow after rslib/');
  const css = cssOf(index);
  assert(css.includes('--rs-code-bg'), 'pages load the theme tokens');
  assert(css.includes('Bricolage Grotesque'), 'pages load the theme fonts');
  const guide = page(dist, 'guides/getting-started');
  assert(/<pre[^>]*data-language="sh"/.test(guide), 'code blocks render');
  // #e0def4 is the rose-pine-moon text color; the theme draws its own code background.
  assert(/#e0def4/i.test(cssOf(guide) + guide), 'code blocks use the rose-pine colors');
}

const parts = { guides, reference, theme };
const part = process.argv[2];
if (!parts[part]) fail(`unknown part "${part}"; use guides, reference or theme`);
parts[part]();
console.log(`${part} checks passed`);
