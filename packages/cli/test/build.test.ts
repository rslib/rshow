import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const HTML = '<h1>hi</h1>';

function publishRouter(slug: string) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}`) {
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact(slug) };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: [] } };
    }
    if (req.method === 'POST' && req.path === `/api/artifacts/${slug}/versions`) {
      return {
        status: 201,
        body: {
          n: 1,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 1,
          bytes: 12,
          url: `https://art.example.com/${slug}/v1/`,
        },
      };
    }
    if (req.method === 'PATCH' && req.path === `/api/artifacts/${slug}`) {
      return { status: 200, body: artifact(slug, jsonBody(req)) };
    }
    return undefined;
  };
}

test('publish reads slug, title and out from rshow.json', async (t) => {
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ slug: 'conf', title: 'From config', out: 'build' }),
    'build/index.html': HTML,
    'index.html': 'not published',
  });
  const api = await startFakeApi(publishRouter('conf'));
  t.after(() => api.close());

  const result = await runCli(['publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);

  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'conf', title: 'From config' });

  const version = api.requests.find((req) => req.path === '/api/artifacts/conf/versions');
  const body = jsonBody(version as RecordedRequest);
  assert.deepEqual(Object.keys(body.files), ['index.html']);
  assert.equal(body.files['index.html'].hash, sha256(HTML));
});

test('publish flags win over rshow.json', async (t) => {
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ slug: 'conf', title: 'From config' }),
    'index.html': HTML,
  });
  const api = await startFakeApi(publishRouter('flag'));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'flag', '--title', 'Flag'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 0);
  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'flag', title: 'Flag' });
});

test('publish runs the build command in the folder, then publishes out', async (t) => {
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({
      slug: 'site',
      build: "mkdir -p dist && printf '<h1>built</h1>' > dist/index.html && echo built",
    }),
  });
  const api = await startFakeApi(publishRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
    SHELL: '/bin/sh',
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^built$/m);

  assert.equal(await readFile(path.join(dir, 'dist', 'index.html'), 'utf8'), '<h1>built</h1>');

  const version = api.requests.find((req) => req.path === '/api/artifacts/site/versions');
  const body = jsonBody(version as RecordedRequest);
  assert.deepEqual(Object.keys(body.files), ['index.html']);
  assert.equal(body.files['index.html'].hash, sha256('<h1>built</h1>'));
  assert.equal(body.files['index.html'].size, '<h1>built</h1>'.length);
});

test('--build overrides the build command from rshow.json', async (t) => {
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ slug: 'site', build: 'exit 7', out: 'public' }),
  });
  const api = await startFakeApi(publishRouter('site'));
  t.after(() => api.close());

  const result = await runCli(
    ['publish', dir, '--build', "mkdir -p public && printf ok > public/index.html"],
    { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret', SHELL: '/bin/sh' },
  );
  assert.equal(result.code, 0);
  assert.equal(await readFile(path.join(dir, 'public', 'index.html'), 'utf8'), 'ok');
});

test('a failing build exits 5 and publishes nothing', async (t) => {
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ slug: 'site', build: 'exit 3' }),
    'index.html': HTML,
  });
  const api = await startFakeApi(publishRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
    SHELL: '/bin/sh',
  });
  assert.equal(result.code, 5);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^rshow: build failed: exit 3$/m);
  assert.equal(api.requests.length, 0);
});

test('--build on a single file is a usage error', async () => {
  const dir = await makeTempDir({ 'page.html': HTML });
  const result = await runCli(['publish', `${dir}/page.html`, '--build', 'exit 0'], {
    RSHOW_URL: 'http://127.0.0.1:1',
    RSHOW_TOKEN: 'x',
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^rshow: build needs a folder/);
});
