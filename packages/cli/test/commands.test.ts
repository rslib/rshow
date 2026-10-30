import assert from 'node:assert/strict';
import test from 'node:test';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

test('pin sends a version number, or null for live', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'PATCH' && req.path === '/api/artifacts/site') {
      return { status: 200, body: artifact('site', jsonBody(req)) };
    }
    return undefined;
  });
  t.after(() => api.close());

  const pinned = await runCli(['pin', 'site', '3'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(pinned.code, 0);
  assert.deepEqual(jsonBody(api.requests[0] as RecordedRequest), { pinned: 3 });

  const live = await runCli(['pin', 'site', 'live'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(live.code, 0);
  assert.deepEqual(jsonBody(api.requests[1] as RecordedRequest), { pinned: null });
  assert.match(live.stdout, /^pinned: live$/m);

  const bad = await runCli(['pin', 'site', 'v3'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(bad.code, 2);
  assert.equal(api.requests.length, 2);
});

test('delete needs --yes', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'DELETE' && req.path === '/api/artifacts/site') return { status: 204 };
    return undefined;
  });
  t.after(() => api.close());

  const refused = await runCli(['delete', 'site'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(refused.code, 2);
  assert.equal(api.requests.length, 0);

  const done = await runCli(['delete', 'site', '--yes'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(done.code, 0);
  assert.equal(done.stdout.trim(), 'deleted: site');
  assert.equal(api.requests.length, 1);
});

test('list prints one artifact per line', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts') {
      return { status: 200, body: { artifacts: [artifact('one'), artifact('two', { served: null })] } };
    }
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'one private v1 one\ntwo private - two\n');
});

test('show prints artifact, versions and shares', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts/site') {
      return {
        status: 200,
        body: {
          ...artifact('site'),
          versions: [
            {
              n: 1,
              label: 'first',
              created_by: 'owner@example.com',
              created_at: '2026-01-01T00:00:00.000Z',
              files: 2,
              bytes: 24,
              url: 'https://art.example.com/site/v1/',
            },
          ],
          shares: [{ email: 'a@example.com', role: 'viewer' }],
        },
      };
    }
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['show', 'site'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^slug: site$/m);
  assert.match(result.stdout, /^versions: 1$/m);
  assert.match(result.stdout, /^v1 first owner@example\.com /m);
  assert.match(result.stdout, /^share a@example\.com viewer$/m);
});

test('compare --publish uploads the report folder as <slug>-compare', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts/gallery-compare') {
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact('gallery-compare') };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: jsonBody(req).hashes } };
    }
    if (req.method === 'PATCH' && req.path === '/api/artifacts/gallery-compare') {
      return { status: 200, body: artifact('gallery-compare', jsonBody(req)) };
    }
    if (req.method === 'PUT' && req.path.startsWith('/api/blobs/')) return { status: 204 };
    if (req.method === 'POST' && req.path === '/api/artifacts/gallery-compare/versions') {
      return {
        status: 201,
        body: {
          n: 1,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 3,
          bytes: 400,
          url: 'https://art.example.com/gallery-compare/v1/',
        },
      };
    }
    return undefined;
  });
  t.after(() => api.close());

  const dir = await makeTempDir({
    'spec.json': JSON.stringify({
      schema: 1,
      generator: 'rshow handoff',
      createdAt: '2026-01-01T00:00:00.000Z',
      source: {
        slug: 'gallery',
        version: 3,
        url: 'https://art.example.com/gallery/v3/',
        kind: 'mockup',
        skin: 'wire',
      },
      widths: [1440],
      modes: ['light'],
      primaryWidth: 1440,
      screens: [],
      baselines: [],
    }),
    'tokens.json': '{"base":{"accent":{"$value":"#0f62fe","$type":"color"}}}',
  });

  const result = await runCli(['compare', '--against', dir, '--publish'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^compare: ok \(0 checked, 0 without a url\)$/m);
  assert.match(result.stdout, /^published: https:\/\/art\.example\.com\/gallery-compare\/v1\/$/m);
  assert.match(result.stdout, /^live: https:\/\/art\.example\.com\/gallery-compare\/$/m);

  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.equal(jsonBody(create as RecordedRequest).slug, 'gallery-compare');
  const version = api.requests.find((req) => req.path === '/api/artifacts/gallery-compare/versions');
  const files = Object.keys(jsonBody(version as RecordedRequest).files);
  assert.deepEqual(files.sort(), ['index.html', 'report.json']);
});
