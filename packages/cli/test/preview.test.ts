import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { makeTempDir, runCli, startCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply, RunningCli } from './helpers.ts';

const URL_PATTERN = /http:\/\/127\.0\.0\.1:[0-9]+/;
const RELOAD_TAG = '<script src="/_rshow/reload.js"></script>';

async function preview(
  files: Record<string, string>,
  env: Record<string, string> = {},
  flags: string[] = [],
): Promise<{ url: string; dir: string; running: RunningCli }> {
  const dir = await makeTempDir(files);
  const home = await makeTempDir({});
  const running = startCli(['preview', dir, '--port', '0', ...flags], { HOME: home, ...env });
  const url = await running.waitFor(URL_PATTERN);
  return { url, dir, running };
}

type RawReply = { status: number; headers: NodeJS.Dict<string | string[]>; body: string };

function rawRequest(
  base: string,
  pathname: string,
  opts: { method: string; headers?: Record<string, string>; body?: string } = { method: 'GET' },
): Promise<RawReply> {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: pathname,
        method: opts.method,
        headers: opts.headers ?? {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

function rawGet(base: string, pathname: string): Promise<{ status: number; body: string }> {
  return rawRequest(base, pathname, { method: 'GET' });
}

function putJson(base: string, pathname: string, body: string): Promise<RawReply> {
  return rawRequest(base, pathname, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

test('preview serves a folder with index.html and content types', async (t) => {
  const { url, running } = await preview({
    'index.html': '<h1>hi</h1>',
    'sub/index.html': '<h1>sub</h1>',
    'assets/site.css': 'body{}',
    'assets/data.bin': 'raw',
  });
  t.after(() => running.stop());

  const index = await fetch(`${url}/`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await index.text(), /^<h1>hi<\/h1>/);

  const nested = await fetch(`${url}/sub/`);
  assert.equal(nested.status, 200);
  assert.match(await nested.text(), /^<h1>sub<\/h1>/);

  const noSlash = await fetch(`${url}/sub`);
  assert.equal(noSlash.status, 200);
  assert.match(await noSlash.text(), /^<h1>sub<\/h1>/);

  const css = await fetch(`${url}/assets/site.css`);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(await css.text(), 'body{}');

  const bin = await fetch(`${url}/assets/data.bin`);
  assert.equal(bin.headers.get('content-type'), 'application/octet-stream');

  const missing = await fetch(`${url}/nope.txt`);
  assert.equal(missing.status, 404);

  const escape = await rawGet(url, '/%2e%2e/%2e%2e/package.json');
  assert.equal(escape.status, 404);

  const post = await fetch(`${url}/`, { method: 'POST' });
  assert.equal(post.status, 405);
});

test('preview prints the local url on its own line', async (t) => {
  const { url, running } = await preview(
    { 'index.html': '<h1>hi</h1>' },
    { RSHOW_ART: 'https://art.example.com' },
  );
  t.after(() => running.stop());
  assert.match(running.stdout(), /^http:\/\/127\.0\.0\.1:[0-9]+\n$/);
  assert.equal(running.stderr(), '');
  assert.match(url, URL_PATTERN);
});

test('preview serves a built-in theme from disk with no art host, and redirects to the slash form', async (t) => {
  const { url, running } = await preview({ 'index.html': '<h1>hi</h1>' });
  t.after(() => running.stop());

  const tokens = await fetch(`${url}/_themes/default@3/tokens.css`);
  assert.equal(tokens.status, 200);
  assert.equal(tokens.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(tokens.headers.get('x-rshow-source'), 'local');
  assert.match(await tokens.text(), /--bg/);

  const html = await fetch(`${url}/_themes/default@9/index.html`);
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('x-rshow-source'), 'local');

  const bare = await fetch(`${url}/_themes/default@3`, { redirect: 'manual' });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get('location'), '/_themes/default@3/');

  const missingFile = await fetch(`${url}/_themes/default@3/nope.css`);
  assert.equal(missingFile.status, 404);
});

test('preview serves the --theme folder, and a preset wins over the built-in theme', async (t) => {
  const theme = await makeTempDir({
    'theme.json': JSON.stringify({
      name: 'default',
      extends: 'default',
      tokens: { '--accent': '#0055ff' },
    }),
  });
  const { url, running } = await preview({ 'index.html': '<h1>hi</h1>' }, {}, ['--theme', theme, '--offline']);
  t.after(() => running.stop());
  assert.equal(running.stderr(), '');

  const tokens = await fetch(`${url}/_themes/default@7/tokens.css`);
  assert.equal(tokens.status, 200);
  assert.equal(tokens.headers.get('x-rshow-source'), 'preset');
  const css = await tokens.text();
  assert.match(css, /--accent: #0055ff/);
  assert.match(css, /--bg:/);

  const json = await fetch(`${url}/_themes/default@1/theme.json`);
  assert.equal(json.status, 200);
  assert.match(await json.text(), /"extends"/);
});

test('preview serves a full --theme folder as it is', async (t) => {
  const theme = await makeTempDir({
    'theme.json': JSON.stringify({ name: 'acme' }),
    'tokens.css': ':root { --accent: #ff0000; }',
  });
  const { url, running } = await preview({ 'index.html': '<h1>hi</h1>' }, {}, ['--theme', theme]);
  t.after(() => running.stop());

  const tokens = await fetch(`${url}/_themes/acme@2/tokens.css`);
  assert.equal(tokens.status, 200);
  assert.equal(tokens.headers.get('x-rshow-source'), 'local');
  assert.match(await tokens.text(), /#ff0000/);
});

test('preview says a theme is not on disk when there is no art host', async (t) => {
  const { url, running } = await preview({ 'index.html': '<h1>hi</h1>' }, {}, ['--offline']);
  t.after(() => running.stop());

  const reply = await fetch(`${url}/_themes/nope@1/tokens.css`);
  assert.equal(reply.status, 404);
  assert.equal(await reply.text(), 'theme nope is not on disk and no art host is set\n');
});

test('preview proxies an unknown theme to the art url from config', async (t) => {
  const art = await startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/_themes/nope@3/deck.css') {
      return { status: 200, text: '.deck{}' };
    }
    return undefined;
  });
  t.after(() => art.close());

  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ art: art.url }),
  });
  const { url, running } = await preview({ 'index.html': '<h1>hi</h1>' }, { HOME: home });
  t.after(() => running.stop());

  const reply = await fetch(`${url}/_themes/nope@3/deck.css`);
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get('x-rshow-source'), 'proxy');
  assert.equal(await reply.text(), '.deck{}');
  assert.deepEqual(
    art.requests.map((req) => `${req.method} ${req.path}`),
    ['GET /_themes/nope@3/deck.css'],
  );

  const remoteMissing = await fetch(`${url}/_themes/nope@3/nope.css`);
  assert.equal(remoteMissing.status, 404);

  // A built-in theme stays local even with an art host set.
  const builtin = await fetch(`${url}/_themes/default@3/tokens.css`);
  assert.equal(builtin.headers.get('x-rshow-source'), 'local');
  assert.equal(art.requests.length, 2);
});

test('preview keeps a local data store for the session', async (t) => {
  const { url, running } = await preview({ 'index.html': '<h1>hi</h1>' }, {}, ['--offline']);
  t.after(() => running.stop());

  const missing = await fetch(`${url}/_data/notes`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not found' });

  const created = await putJson(url, '/example/_data/notes', JSON.stringify({ value: { a: 1 } }));
  assert.equal(created.status, 200);
  const etag = created.headers['etag'] as string;
  assert.match(etag, /^"[0-9a-f]{64}"$/);
  const reply = JSON.parse(created.body);
  assert.equal(reply.ok, true);
  assert.equal(reply.key, 'notes');
  assert.equal(typeof reply.updated_at, 'string');

  const read = await rawRequest(url, '/_data/notes', { method: 'GET' });
  assert.equal(read.status, 200);
  assert.equal(read.headers['etag'], etag);
  assert.deepEqual(JSON.parse(read.body), {
    value: { a: 1 },
    updated_at: reply.updated_at,
    updated_by: 'preview',
  });

  const stale = await rawRequest(url, '/_data/notes', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': '"nope"' },
    body: JSON.stringify({ value: { a: 2 } }),
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(JSON.parse(stale.body), { error: 'etag mismatch' });

  const fresh = await rawRequest(url, '/_data/notes', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag },
    body: JSON.stringify({ value: { a: 2 } }),
  });
  assert.equal(fresh.status, 200);
  assert.notEqual(fresh.headers['etag'], etag);

  const unmatched = await rawRequest(url, '/_data/ghost', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag },
    body: JSON.stringify({ value: 1 }),
  });
  assert.equal(unmatched.status, 409);

  const wrongType = await rawRequest(url, '/_data/notes', {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: 'nope',
  });
  assert.equal(wrongType.status, 415);

  const noValue = await putJson(url, '/_data/notes', JSON.stringify({ nope: 1 }));
  assert.equal(noValue.status, 400);

  const big = await putJson(url, '/_data/notes', JSON.stringify({ value: 'x'.repeat(65 * 1024) }));
  assert.equal(big.status, 413);

  // A sketch- key takes up to 5 MiB, so 100 KiB is fine under that key.
  const sketch = await putJson(url, '/_data/sketch-main', JSON.stringify({ value: 'x'.repeat(100 * 1024) }));
  assert.equal(sketch.status, 200);

  // No content-length, so the server reads the body before it answers.
  const tooBig = await putJson(url, '/_data/sketch-big', JSON.stringify({ value: 'x'.repeat(5 * 1024 * 1024) }));
  assert.equal(tooBig.status, 413);
  assert.deepEqual(JSON.parse(tooBig.body), { error: 'value too large' });
});

test('preview injects the reload script into html from disk only', async (t) => {
  const { url, running } = await preview({
    'index.html': '<html><body><h1>hi</h1></body></html>',
    'assets/site.css': 'body{}',
  });
  t.after(() => running.stop());

  const index = await fetch(`${url}/`);
  const html = await index.text();
  assert.match(html, /^<html><body><h1>hi<\/h1><script src="\/_rshow\/reload\.js"><\/script>\n<\/body><\/html>$/);

  const css = await fetch(`${url}/assets/site.css`);
  assert.equal(await css.text(), 'body{}');

  const themeHtml = await fetch(`${url}/_themes/default@3/example/page.html`);
  assert.equal(themeHtml.status, 200);
  assert.match(await themeHtml.text(), /_rshow\/reload\.js/);

  const script = await fetch(`${url}/_rshow/reload.js`);
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(await script.text(), /new EventSource\('\/_rshow\/events'\)/);
  assert.match(await (await fetch(`${url}/_rshow/reload.js`)).text(), /location\.reload\(\)/);
});

test('preview --no-reload injects nothing', async (t) => {
  const { url, running } = await preview({ 'index.html': '<html><body>hi</body></html>' }, {}, ['--no-reload']);
  t.after(() => running.stop());

  const index = await fetch(`${url}/`);
  assert.equal(await index.text(), '<html><body>hi</body></html>');
});

test('preview emits an sse event after a file write', async (t) => {
  const { url, dir, running } = await preview({ 'index.html': '<h1>hi</h1>' });
  t.after(() => running.stop());

  const target = new URL(url);
  const events = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no sse event')), 5000);
    const req = request(
      { hostname: target.hostname, port: target.port, path: '/_rshow/events', method: 'GET' },
      (res) => {
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.includes('data:')) {
            clearTimeout(timer);
            resolve(body);
          }
        });
        void writeFile(path.join(dir, 'index.html'), '<h1>changed</h1>');
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.match(events, /data: /);
});

test('preview rejects a bad folder or port', async () => {
  const home = await makeTempDir({});
  const missing = await runCli(['preview', '/nope/nope'], { HOME: home });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^rshow: no such folder: /);

  const dir = await makeTempDir({ 'index.html': 'x' });
  const badPort = await runCli(['preview', dir, '--port', 'eighty'], { HOME: home });
  assert.equal(badPort.code, 2);
  assert.match(badPort.stderr, /^rshow: invalid port: eighty/);

  const badTheme = await runCli(['preview', dir, '--theme', '/nope/theme'], { HOME: home });
  assert.equal(badTheme.code, 2);
  assert.match(badTheme.stderr, /^rshow: no such theme folder: /);
});
