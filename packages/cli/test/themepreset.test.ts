import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildPreset, builtinThemeDir, checkPreset } from '../src/themes.ts';
import { artifact, jsonBody, makeTempDir, runCli, startCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const URL_PATTERN = /http:\/\/127\.0\.0\.1:[0-9]+\/index\.html/;

function themeRouter(slug: string, versionN: number) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}`) {
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') return { status: 201, body: artifact(slug) };
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: jsonBody(req).hashes } };
    }
    if (req.method === 'PUT' && req.path.startsWith('/api/blobs/')) return { status: 204 };
    if (req.method === 'POST' && req.path === `/api/artifacts/${slug}/versions`) {
      return {
        status: 201,
        body: {
          n: versionN,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 20,
          bytes: 4000,
          url: `https://art.example.com/${slug}/v${versionN}/`,
        },
      };
    }
    if (req.method === 'PATCH' && req.path === `/api/artifacts/${slug}`) {
      return { status: 200, body: artifact(slug, { mode: 'public' }) };
    }
    return undefined;
  };
}

function themeJson(value: unknown): Record<string, string> {
  return { 'theme.json': `${JSON.stringify(value, null, 2)}\n` };
}

test('builtinThemeDir looks in the repo first, then the package, and then gives up', async () => {
  const repo = await makeTempDir({ 'themes/acme/theme.json': '{"name":"acme"}' });
  const pkg = await makeTempDir({ 'themes/acme/theme.json': '{"name":"package"}' });
  const bases = [path.join(repo, 'themes'), path.join(pkg, 'themes')];

  assert.equal(await builtinThemeDir('acme', bases), path.join(repo, 'themes', 'acme'));

  const onlyPackage = [path.join(repo, 'nothing'), path.join(pkg, 'themes')];
  assert.equal(await builtinThemeDir('acme', onlyPackage), path.join(pkg, 'themes', 'acme'));
  assert.equal(await builtinThemeDir('missing', bases), undefined);

  const shipped = await builtinThemeDir('default');
  assert.ok(shipped !== undefined);
  assert.match(await readFile(path.join(shipped, 'theme.json'), 'utf8'), /"name": "default"/);
});

test('buildPreset copies the base, appends the three token blocks and mints theme.json', async () => {
  const preset = await makeTempDir({
    ...themeJson({
      name: 'acme',
      extends: 'default',
      description: 'acme branding',
      tokens: { '--font-sans': 'Inter, system-ui, sans-serif' },
      modeTokens: { light: { '--accent': '#0055ff' }, dark: { '--bg': '#101010' } },
      fonts: [{ family: 'Inter', weight: 400, style: 'normal', file: 'fonts/Inter-Regular.woff2' }],
    }),
    'fonts/Inter-Regular.woff2': 'font-bytes',
    'fonts/OFL.txt': 'licence',
  });
  const out = await makeTempDir({ 'stale.txt': 'stale' });

  await buildPreset(preset, out);
  const baseDir = (await builtinThemeDir('default')) as string;

  assert.equal(await readFile(path.join(out, 'deck.css'), 'utf8'), await readFile(path.join(baseDir, 'deck.css'), 'utf8'));
  await assert.rejects(readFile(path.join(out, 'stale.txt'), 'utf8'));

  const tokens = await readFile(path.join(out, 'tokens.css'), 'utf8');
  assert.match(tokens, /:root \{\n {2}--font-sans: Inter, system-ui, sans-serif;\n {2}--accent: #0055ff;\n\}/);
  assert.match(
    tokens,
    /@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-mode="light"\]\) \{\n {4}--bg: #101010;\n {2}\}\n\}/,
  );
  assert.match(tokens, /:root\[data-mode="dark"\] \{\n {2}--bg: #101010;\n\}/);
  assert.ok(tokens.trimEnd().endsWith(':root[data-mode="dark"] {\n  --bg: #101010;\n}'));

  const fonts = await readFile(path.join(out, 'fonts.css'), 'utf8');
  assert.match(
    fonts,
    /@font-face \{\n {2}font-family: "Inter";\n {2}font-style: normal;\n {2}font-weight: 400;\n {2}font-display: swap;\n {2}src: url\("fonts\/Inter-Regular\.woff2"\) format\("woff2"\);\n\}/,
  );
  assert.equal(await readFile(path.join(out, 'fonts', 'Inter-Regular.woff2'), 'utf8'), 'font-bytes');
  assert.equal(await readFile(path.join(out, 'fonts', 'OFL.txt'), 'utf8'), 'licence');

  const merged = JSON.parse(await readFile(path.join(out, 'theme.json'), 'utf8'));
  assert.equal(merged.name, 'acme');
  assert.equal(merged.description, 'acme branding');
  assert.deepEqual(merged.extends, { name: 'default', from: 'default' });
  assert.equal(merged.tokens['--font-sans'], 'Inter, system-ui, sans-serif');
  assert.equal(merged.tokens['--space-05'], '16px');
  assert.equal(merged.modeTokens.light['--accent'], '#0055ff');
  assert.equal(merged.modeTokens.light['--bg'], '#ffffff');
  assert.equal(merged.modeTokens.dark['--bg'], '#101010');
  assert.ok(merged.layouts.deck !== undefined);
});

test('buildPreset copies a full theme as it is and rejects an unknown base', async () => {
  const full = await makeTempDir({
    ...themeJson({ name: 'mine' }),
    'tokens.css': ':root{--bg:#ffffff}',
  });
  const out = await makeTempDir({});
  await buildPreset(full, out);
  assert.deepEqual(JSON.parse(await readFile(path.join(out, 'theme.json'), 'utf8')), { name: 'mine' });
  assert.equal(await readFile(path.join(out, 'tokens.css'), 'utf8'), ':root{--bg:#ffffff}');

  const broken = await makeTempDir(themeJson({ name: 'mine', extends: 'nope' }));
  await assert.rejects(buildPreset(broken, out), /no built-in theme: nope/);
});

test('checkPreset reports unknown tokens and bad colour values on their line', async () => {
  const text = [
    '{',
    '  "name": "acme",',
    '  "extends": "default",',
    '  "tokens": {',
    '    "--nope": "1px"',
    '  },',
    '  "modeTokens": {',
    '    "light": {',
    '      "--accent": "tomato"',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
  const dir = await makeTempDir({ 'theme.json': text });

  const findings = await checkPreset(dir);
  const unknown = findings.find((finding) => /unknown token: --nope/.test(finding.message));
  assert.equal(unknown?.severity, 'error');
  assert.equal(unknown?.line, 5);
  const bad = findings.find((finding) => /bad colour value for --accent: tomato/.test(finding.message));
  assert.equal(bad?.severity, 'error');
  assert.equal(bad?.line, 9);
  assert.equal(bad?.path, 'theme.json');
});

test('checkPreset resolves var() chains and measures contrast in light, dark and print', async () => {
  const dir = await makeTempDir({
    ...themeJson({
      name: 'acme',
      extends: 'default',
      modeTokens: {
        light: { '--muted': 'var(--placeholder)' },
        dark: { '--fg': '#333333' },
      },
    }),
  });

  const findings = await checkPreset(dir);
  const light = findings.find((finding) => finding.message.startsWith('light: --muted on --bg'));
  assert.equal(light?.severity, 'error');
  assert.match(light?.message ?? '', /^light: --muted on --bg is [0-9.]+:1, needs 4\.5:1$/);
  assert.ok(findings.some((finding) => finding.message.startsWith('print: --muted on --bg')));
  assert.ok(findings.some((finding) => finding.message.startsWith('dark: --fg on --bg')));
  assert.equal(
    findings.filter((finding) => /bad colour value/.test(finding.message)).length,
    0,
  );
});

test('checkPreset wants each font file and a licence beside it', async () => {
  const preset = {
    name: 'acme',
    extends: 'default',
    fonts: [{ family: 'Inter', weight: 400, file: 'fonts/Inter-Regular.woff2' }],
  };

  const bare = await makeTempDir(themeJson(preset));
  const missing = await checkPreset(bare);
  assert.ok(missing.some((finding) => finding.severity === 'error' && /missing font file/.test(finding.message)));
  assert.ok(missing.some((finding) => finding.severity === 'warning' && /no font licence/.test(finding.message)));

  const shipped = await makeTempDir({ ...themeJson(preset), 'fonts/Inter-Regular.woff2': 'x', 'fonts/OFL.txt': 'y' });
  const findings = await checkPreset(shipped);
  assert.equal(findings.filter((finding) => /font/.test(finding.message)).length, 0);
});

test('checkPreset holds the name to THEME_NAME_PATTERN and the theme- prefix rule', async () => {
  const upper = await checkPreset(await makeTempDir(themeJson({ name: 'Acme', extends: 'default' })));
  assert.ok(upper.some((finding) => finding.severity === 'error' && /invalid theme name: Acme/.test(finding.message)));

  const prefixed = await checkPreset(await makeTempDir(themeJson({ name: 'theme-acme', extends: 'default' })));
  assert.ok(prefixed.some((finding) => finding.message.includes('the slug adds theme-')));

  const missing = await checkPreset(await makeTempDir(themeJson({ extends: 'default' })));
  assert.ok(missing.some((finding) => finding.message === 'theme.json needs a name'));
});

test('checkPreset on a full theme reads its own tokens.css for contrast', async () => {
  const dir = await makeTempDir({
    ...themeJson({ name: 'mine' }),
    'tokens.css': ':root{--bg:#ffffff;--fg:#161616;--muted:#bbbbbb;--accent:#0f62fe;--layer-01:#f4f4f4}',
  });

  const findings = await checkPreset(dir);
  assert.ok(findings.some((finding) => finding.message.startsWith('light: --muted on --bg')));
  assert.equal(findings.filter((finding) => /unknown token/.test(finding.message)).length, 0);
});

test('theme new writes a preset folder with the base values and refuses to overwrite', async () => {
  const parent = await makeTempDir({});

  const first = await runCli(['theme', 'new', 'demo', '--dir', parent], { HOME: parent });
  assert.equal(first.stderr, '');
  assert.equal(first.code, 0);
  const dir = path.join(parent, 'demo');
  assert.equal(first.stdout, `${dir}\nnext: rshow theme check ${dir}\n`);

  const json = JSON.parse(await readFile(path.join(dir, 'theme.json'), 'utf8'));
  assert.equal(json.name, 'demo');
  assert.equal(json.extends, 'default');
  assert.deepEqual(json.tokens, {});
  assert.deepEqual(Object.keys(json.modeTokens.light).sort(), [
    '--accent',
    '--bg',
    '--fg',
    '--layer-01',
    '--muted',
  ]);
  assert.equal(json.modeTokens.light['--bg'], '#ffffff');
  assert.equal(json.modeTokens.dark['--bg'], '#161616');

  const again = await runCli(['theme', 'new', 'demo', '--dir', parent], { HOME: parent });
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists/);

  const bad = await runCli(['theme', 'new', 'theme-demo', '--dir', parent], { HOME: parent });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /the slug adds theme-/);
});

test('theme check passes a fresh preset and fails it with exit 6 at a bad contrast', async () => {
  const parent = await makeTempDir({});
  const env = { HOME: parent };
  await runCli(['theme', 'new', 'demo', '--dir', parent], env);
  const dir = path.join(parent, 'demo');

  const ok = await runCli(['theme', 'check', dir], env);
  assert.equal(ok.code, 0);
  assert.equal(ok.stderr, '');
  assert.match(ok.stdout, /^check: ok \(1 file, [0-9.]+ B\)$/m);

  const file = path.join(dir, 'theme.json');
  const json = JSON.parse(await readFile(file, 'utf8'));
  json.modeTokens.light['--muted'] = '#bbbbbb';
  await writeFile(file, `${JSON.stringify(json, null, 2)}\n`);

  const bad = await runCli(['theme', 'check', dir], env);
  assert.equal(bad.code, 6);
  assert.match(bad.stdout, /^theme\.json:[0-9]+: error: light: --muted on --bg is [0-9.]+:1, needs 4\.5:1$/m);
  assert.equal(bad.stderr, '');
});

test('theme preview builds the preset, serves the base preview page and stops clean', async (t) => {
  const parent = await makeTempDir({});
  const env = { HOME: parent, RSHOW_ART: 'http://127.0.0.1:1' };
  await runCli(['theme', 'new', 'demo', '--dir', parent], env);

  const running = startCli(['theme', 'preview', path.join(parent, 'demo'), '--port', '0'], env);
  t.after(() => running.stop());
  const url = await running.waitFor(URL_PATTERN);

  const reply = await fetch(url);
  assert.equal(reply.status, 200);
  const html = await reply.text();
  assert.match(html, /deck\.css/);

  assert.equal(running.stderr(), '');
});

test('theme publish builds a preset on top of its base and uploads the result', async (t) => {
  const dir = await makeTempDir(
    themeJson({
      name: 'acme',
      extends: 'default',
      modeTokens: { light: { '--accent': '#0055ff' }, dark: { '--bg': '#101010' } },
    }),
  );
  const api = await startFakeApi(themeRouter('theme-acme', 2));
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^\/_themes\/acme@2\/$/m);

  const version = api.requests.find((req) => req.path === '/api/artifacts/theme-acme/versions');
  const files = jsonBody(version as RecordedRequest).files;
  for (const rel of ['theme.json', 'tokens.css', 'fonts.css', 'deck.css', 'index.html']) {
    assert.ok(files[rel] !== undefined, `expected ${rel} in the upload`);
  }
  assert.ok(files['fonts/IBMPlexSans-Regular-Latin1.woff2'] !== undefined);
});

test('theme publish checks a preset first: an error stops it with exit 6', async (t) => {
  const dir = await makeTempDir(
    themeJson({ name: 'acme', extends: 'default', modeTokens: { light: { '--muted': '#bbbbbb' } } }),
  );
  const api = await startFakeApi(themeRouter('theme-acme', 1));
  t.after(() => api.close());

  const failed = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(failed.code, 6);
  assert.match(failed.stdout, /^theme\.json:[0-9]+: error: light: --muted on --bg/m);
  assert.match(failed.stderr, /^rshow: check failed:/m);
  assert.equal(api.requests.length, 0);

  const skipped = await runCli(['theme', 'publish', dir, '--no-check'], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(skipped.code, 0);
  assert.ok(api.requests.some((req) => req.path === '/api/artifacts/theme-acme/versions'));
});
