import assert from 'node:assert/strict';
import { mkdir, truncate, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { formatBytes, pathProblem } from '../src/check.ts';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

async function sparse(dir: string, rel: string, size: number): Promise<void> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, '');
  await truncate(abs, size);
}

test('check passes a folder that meets the contract', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<meta charset="utf-8">',
      VIEWPORT,
      '<title>Fine</title>',
      '<link rel="stylesheet" href="site.css">',
      '<link rel="stylesheet" href="/_themes/default@1/page.css">',
      '</head>',
      '<body>',
      '<img src="img/logo.png" alt="logo">',
      '<a href="notes/page.html">notes</a>',
      '<a href="./notes/">notes</a>',
      '</body>',
      '</html>',
    ].join('\n'),
    'site.css': 'body{background:url(img/logo.png)}',
    'img/logo.png': 'png',
    'notes/index.html': '<p>notes</p>',
    'notes/page.html': '<p>page</p>',
  });

  const result = await runCli(['check', dir, '--offline'], {});
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok \(5 files, [0-9.]+ [KMG]?i?B\)$/m);
});

test('check reports a missing index.html', async () => {
  const dir = await makeTempDir({ 'page.html': '<p>no index</p>' });
  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^index\.html:1: error: no index\.html at the root$/m);
  assert.match(result.stdout, /^check: 1 error, 0 warnings/m);
});

test('check skips the index rule for a theme folder', async () => {
  const dir = await makeTempDir({
    'theme.json': JSON.stringify({ name: 'mono' }),
    'tokens.css': ':root{--accent:#fff}',
    'fonts.css': '@font-face{src:url("fonts/a.woff2")}',
    'fonts/a.woff2': 'font',
  });
  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok /m);
});

test('check reports every local reference with no file behind it', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      VIEWPORT,
      '<title>Refs</title>',
      '<link rel="stylesheet" href="site.css">',
      '<style>h1{background:url(bg.png)}</style>',
      '<style>@import "fonts.css";</style>',
      '</head>',
      '<body>',
      '<a href="missing.html">x</a>',
      '<img src="img/none.png" alt="none">',
      '<img srcset="a.png 1x, b.png 2x" alt="set">',
      '<video poster="p.jpg"></video>',
      '</body>',
      '</html>',
    ].join('\n'),
    'site.css': '@import "other.css";\nbody{background:url(fonts/none.woff2)}',
    'a.png': 'png',
  });

  const result = await runCli(['check', dir, '--offline'], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^index\.html:7: error: missing file: bg\.png$/m);
  assert.match(result.stdout, /^index\.html:8: error: missing file: fonts\.css$/m);
  assert.match(result.stdout, /^index\.html:11: error: missing file: missing\.html$/m);
  assert.match(result.stdout, /^index\.html:12: error: missing file: img\/none\.png$/m);
  assert.match(result.stdout, /^index\.html:13: error: missing file: b\.png$/m);
  assert.match(result.stdout, /^index\.html:14: error: missing file: p\.jpg$/m);
  assert.match(result.stdout, /^site\.css:1: error: missing file: other\.css$/m);
  assert.match(result.stdout, /^site\.css:2: error: missing file: fonts\/none\.woff2$/m);
  assert.match(result.stdout, /^check: 8 errors, 0 warnings/m);
});

test('check ignores fragments, data, blob, mailto, tel, javascript and queries', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Ignored</title>',
      '<link rel="stylesheet" href="page.html?v=1#x">',
      '</head>',
      '<body>',
      '<a href="#top">t</a>',
      '<a href="data:text/plain,hi">d</a>',
      '<img src="data:image/png;base64,AAAA" alt="d">',
      '<img src="blob:https://example.test/x" alt="b">',
      '<a href="mailto:a@b.test">m</a>',
      '<a href="tel:+1555">t</a>',
      '<a href="javascript:void(0)">j</a>',
      '<script src="app.js?v=2"></script>',
      '</body>',
      '</html>',
    ].join('\n'),
    'page.html': '<p>page</p>',
    'app.js': 'console.log(1)',
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok /m);
});

test('check reports a root-relative reference outside /_themes', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Rooted</title>',
      '</head>',
      '<body><a href="/other/page.html">x</a></body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(
    result.stdout,
    /^index\.html:6: error: root-relative reference \/other\/page\.html \(only \/_themes\/<name>@<n>\/ paths may start with a slash\)$/m,
  );
});

test('check leaves the theme lookup alone with --offline', async (t) => {
  const api = await startFakeApi(() => ({ status: 404, body: { error: 'not found' } }));
  t.after(() => api.close());

  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ art: api.url }),
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Theme</title>',
      '<link rel="stylesheet" href="/_themes/default@1/page.css">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n'),
  });

  const offline = await runCli(['check', dir, '--offline'], {});
  assert.equal(offline.code, 0);
  assert.equal(api.requests.length, 0);

  const asked = await runCli(['check', dir], {});
  assert.equal(asked.code, 6);
  assert.match(
    asked.stdout,
    /^index\.html:5: error: theme default@1 is not published \(http:\/\/127\.0\.0\.1:[0-9]+\/_themes\/default@1\/tokens\.css\)$/m,
  );
  const head = api.requests[0] as RecordedRequest;
  assert.equal(head.method, 'HEAD');
  assert.equal(head.path, '/_themes/default@1/tokens.css');
});

test('check accepts a theme version the art host has', async (t) => {
  const api = await startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'HEAD' && req.path === '/_themes/default@3/tokens.css') return { status: 200 };
    if (req.method === 'HEAD' && req.path === '/_themes/default@3/page.css') return { status: 200 };
    return undefined;
  });
  t.after(() => api.close());

  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ art: api.url }),
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Theme</title>',
      '<link rel="stylesheet" href="/_themes/default@3/page.css">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok /m);
  assert.equal(api.requests.length, 2);
});

test('check reports a theme file the published version lacks', async (t) => {
  const api = await startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'HEAD' && req.path === '/_themes/default@1/tokens.css') return { status: 200 };
    return undefined;
  });
  t.after(() => api.close());

  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ art: api.url }),
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Theme</title>',
      '<link rel="stylesheet" href="/_themes/default@1/tokens.css">',
      '<link rel="stylesheet" href="/_themes/default@1/dashboard.css">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(
    result.stdout,
    /^index\.html:6: error: theme default@1 has no dashboard\.css \(http:\/\/127\.0\.0\.1:[0-9]+\/_themes\/default@1\/dashboard\.css\)$/m,
  );
});

test('check stops at tokens.css when the theme version is missing', async (t) => {
  const api = await startFakeApi(() => ({ status: 404, body: { error: 'not found' } }));
  t.after(() => api.close());

  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ art: api.url }),
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Theme</title>',
      '<link rel="stylesheet" href="/_themes/default@1/tokens.css">',
      '<link rel="stylesheet" href="/_themes/default@1/dashboard.css">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(
    result.stdout,
    /^index\.html:5: error: theme default@1 is not published \(http:\/\/127\.0\.0\.1:[0-9]+\/_themes\/default@1\/tokens\.css\)$/m,
  );
  assert.equal(api.requests.length, 1);
});

test('check warns when the art host cannot be reached', async () => {
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ art: 'http://127.0.0.1:1' }),
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Theme</title>',
      '<link rel="stylesheet" href="/_themes/default@1/page.css">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:5: warning: cannot check theme default@1: /m);
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('check pins scripts and keeps them on the three allowed hosts', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Scripts</title>',
      '</head>',
      '<body>',
      '<script src="https://example.test/x.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
      '<script src="https://unpkg.com/htmx.org"></script>',
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/htmx/htmx.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>',
      '<script src="https://unpkg.com/htmx.org@1.9.10"></script>',
      '<script src="https://cdnjs.cloudflare.com/ajax/libs/htmx/1.9.10/htmx.min.js"></script>',
      '</body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(
    result.stdout,
    /^index\.html:7: error: script host not allowed: https:\/\/example\.test\/x\.js \(allowed: cdnjs\.cloudflare\.com, cdn\.jsdelivr\.net, unpkg\.com\)$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:8: error: script needs an exact version: https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js \(@1\.2\.3 in the path\)$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:9: error: script needs an exact version: https:\/\/unpkg\.com\/htmx\.org \(@1\.2\.3 in the path\)$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:10: error: script needs an exact version: https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/htmx\/htmx\.min\.js \(\/1\.2\.3\/ in the path\)$/m,
  );
  assert.match(result.stdout, /^check: 4 errors, 0 warnings/m);
});

test('check keeps stylesheets on the allowed hosts', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Styles</title>',
      '<link rel="stylesheet" href="https://example.test/a.css">',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans">',
      '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/type@1.2.3/type.css">',
      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.css">',
      '<link rel="preconnect" href="https://example.test">',
      '</head>',
      '<body></body>',
      '</html>',
    ].join('\n'),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(
    result.stdout,
    /^index\.html:5: error: stylesheet host not allowed: https:\/\/example\.test\/a\.css \(allowed: fonts\.googleapis\.com, cdn\.jsdelivr\.net, cdnjs\.cloudflare\.com\)$/m,
  );
  assert.match(result.stdout, /^check: 1 error, 0 warnings/m);
});

test('check refuses third-party requests that connect-src blocks', async () => {
  const dir = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Connect</title>',
      '</head>',
      '<body>',
      '<script>',
      "fetch('https://api.example.test/data');",
      "fetch('/_data/key');",
      'fetch(url);',
      "new WebSocket('wss://socket.example.test');",
      "new WebSocket('https://socket.example.test');",
      "new EventSource('https://events.example.test/sse');",
      'const xhr = new XMLHttpRequest();',
      "xhr.open('POST', 'https://post.example.test/x');",
      '</script>',
      '</body>',
      '</html>',
    ].join('\n'),
    'app.js': "fetch('https://api.example.test/other');\n",
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(
    result.stdout,
    /^app\.js:1: error: fetch to https:\/\/api\.example\.test\/other is refused: connect-src is 'self' only$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:8: error: fetch to https:\/\/api\.example\.test\/data is refused: connect-src is 'self' only$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:12: error: new WebSocket to https:\/\/socket\.example\.test is refused: connect-src is 'self' only$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:13: error: new EventSource to https:\/\/events\.example\.test\/sse is refused: connect-src is 'self' only$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:15: error: XMLHttpRequest\.open to https:\/\/post\.example\.test\/x is refused: connect-src is 'self' only$/m,
  );
  assert.match(result.stdout, /^check: 5 errors, 0 warnings/m);
});

test('check reports paths a manifest may not carry', async () => {
  const dir = await makeTempDir({ 'index.html': '<p>hi</p>', 'a\\b.txt': 'x' });
  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^a\\b\.txt:1: error: path has a backslash$/m);
  assert.equal(formatBytes(26 * 1024 * 1024), '26.0 MiB');
  assert.equal(pathProblem('a/b.txt'), undefined);
  assert.equal(pathProblem('a/../b.txt'), 'path has a .. segment');
});

test('check reports a file over 25 MiB', async () => {
  const dir = await makeTempDir({ 'index.html': '<p>hi</p>' });
  await sparse(dir, 'big.bin', 26 * 1024 * 1024);

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^big\.bin:1: error: file too large: 26\.0 MiB \(at most 25\.0 MiB\)$/m);
});

test('check reports too many files', async () => {
  const dir = await makeTempDir({ 'index.html': '<p>hi</p>' });
  const names: string[] = [];
  for (let i = 0; i < 2001; i += 1) names.push(`f${i}.txt`);
  for (let i = 0; i < names.length; i += 200) {
    await Promise.all(names.slice(i, i + 200).map((name) => writeFile(path.join(dir, name), 'x')));
  }

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^\.:1: error: too many files: 2002 \(at most 2000\)$/m);
});

test('check reports a folder over 100 MiB', async () => {
  const dir = await makeTempDir({ 'index.html': '<p>hi</p>' });
  for (let i = 0; i < 5; i += 1) await sparse(dir, `blob${i}.bin`, 21 * 1024 * 1024);

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^\.:1: error: folder too large: 105\.0 MiB \(at most 100\.0 MiB\)$/m);
});

test('check warns on a bare index.html and on a deck without slides', async () => {
  const bare = await makeTempDir({
    'index.html': '<p>hi</p>\n<img src="a.png">\n<script src="deck.js"></script>\n',
    'a.png': 'png',
    'deck.js': 'console.log(1)',
  });
  const warned = await runCli(['check', bare], {});
  assert.equal(warned.code, 0);
  assert.match(warned.stdout, /^index\.html:1: warning: no <meta name="viewport">$/m);
  assert.match(warned.stdout, /^index\.html:1: warning: no <title>$/m);
  assert.match(warned.stdout, /^index\.html:2: warning: img without alt$/m);
  assert.match(warned.stdout, /^index\.html:1: warning: deck without <section class="slide">$/m);
  assert.match(warned.stdout, /^check: 0 errors, 4 warnings /m);

  const deck = await makeTempDir({
    'index.html': [
      '<!doctype html>',
      '<head>',
      VIEWPORT,
      '<title>Deck</title>',
      '</head>',
      '<body>',
      '<section class="slide title">',
      '<h1>One</h1>',
      '</section>',
      '<script src="deck.js"></script>',
      '</body>',
      '</html>',
    ].join('\n'),
    'deck.js': 'console.log(1)',
  });
  const quiet = await runCli(['check', deck], {});
  assert.equal(quiet.code, 0);
  assert.match(quiet.stdout, /^check: ok /m);
});

test('check --json prints the findings', async () => {
  const dir = await makeTempDir({
    'index.html': '<head><meta name="viewport" content="width=device-width"><title>J</title></head>\n<a href="gone.html">x</a>\n',
  });

  const result = await runCli(['check', dir, '--json'], {});
  assert.equal(result.code, 6);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.errors, 1);
  assert.equal(parsed.warnings, 0);
  assert.equal(parsed.files, 1);
  assert.deepEqual(parsed.findings[0], {
    path: 'index.html',
    line: 2,
    severity: 'error',
    message: 'missing file: gone.html',
  });
});

test('check usage errors exit 2', async () => {
  const none = await runCli(['check'], {});
  assert.equal(none.code, 2);
  assert.match(none.stderr, /^rshow: expected 1 argument/);

  const dir = await makeTempDir({ 'index.html': '<p>hi</p>' });
  const unknown = await runCli(['check', dir, '--nope'], {});
  assert.equal(unknown.code, 2);

  const missing = await runCli(['check', `${dir}/gone`], {});
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^rshow: no such folder: /);
});

test('help lists the check command', async () => {
  const general = await runCli(['--help'], {});
  assert.equal(general.code, 0);
  assert.match(general.stdout, /^  check <dir> +check a folder against the page contract$/m);

  const check = await runCli(['check', '--help'], {});
  assert.equal(check.code, 0);
  assert.match(check.stdout, /^usage: rshow check <dir> \[--offline\] \[--json\]$/m);
  assert.match(check.stdout, /^warnings:$/m);
});

test('publish runs the check first and stops with exit 6', async (t) => {
  const dir = await makeTempDir({
    'index.html': `<head>${VIEWPORT}<title>Broken</title></head>\n<a href="gone.html">x</a>\n`,
  });
  const api = await startFakeApi(() => ({ status: 500, body: { error: 'boom' } }));
  t.after(() => api.close());
  const env = { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' };

  const stopped = await runCli(['publish', dir, '--slug', 'site'], env);
  assert.equal(stopped.code, 6);
  assert.match(stopped.stdout, /^index\.html:2: error: missing file: gone\.html$/m);
  assert.match(stopped.stderr, /^rshow: check failed: 1 error, 0 warnings$/m);
  assert.equal(api.requests.length, 0);

  const skipped = await runCli(['publish', dir, '--slug', 'site', '--no-check'], env);
  assert.equal(skipped.code, 5);
  assert.match(skipped.stderr, /^rshow: boom$/m);
  assert.ok(api.requests.length > 0);
});

test('theme publish runs the check too', async (t) => {
  const dir = await makeTempDir({
    'theme.json': JSON.stringify({ name: 'mono' }),
    'tokens.css': ':root{--accent:#fff}',
    'fonts.css': '@font-face{src:url("fonts/gone.woff2")}',
  });
  const api = await startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact('theme-mono') };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: [] } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts/theme-mono/versions') {
      return {
        status: 201,
        body: {
          n: 1,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 3,
          bytes: 40,
          url: 'https://art.example.com/theme-mono/v1/',
        },
      };
    }
    if (req.method === 'PATCH' && req.path === '/api/artifacts/theme-mono') {
      return { status: 200, body: artifact('theme-mono', jsonBody(req)) };
    }
    return undefined;
  });
  t.after(() => api.close());
  const env = { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' };

  const stopped = await runCli(['theme', 'publish', dir], env);
  assert.equal(stopped.code, 6);
  assert.match(stopped.stdout, /^fonts\.css:1: error: missing file: fonts\/gone\.woff2$/m);
  assert.equal(api.requests.length, 0);

  const skipped = await runCli(['theme', 'publish', dir, '--no-check'], env);
  assert.equal(skipped.code, 0);
  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'theme-mono', title: 'mono' });
});
