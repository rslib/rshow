import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const THEME_FILES = {
  'theme.json': JSON.stringify({ name: 'default', description: 'the default theme', tokens: { '--accent': '#fff' } }),
  'tokens.css': ':root{--accent:#fff}',
  'deck.css': '.deck{}',
  'page.css': 'body{}',
  'fonts/inter.woff2': 'font-bytes',
};

function themeRouter(
  slug: string,
  versionN: number,
  options: { patchStatus?: number; existing?: Record<string, unknown> } = {},
) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}`) {
      if (options.existing !== undefined) return { status: 200, body: artifact(slug, options.existing) };
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact(slug) };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: jsonBody(req).hashes } };
    }
    if (req.method === 'PUT' && req.path.startsWith('/api/blobs/')) {
      return { status: 204 };
    }
    if (req.method === 'POST' && req.path === `/api/artifacts/${slug}/versions`) {
      return {
        status: 201,
        body: {
          n: versionN,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 5,
          bytes: 40,
          url: `https://art.example.com/${slug}/v${versionN}/`,
        },
      };
    }
    if (req.method === 'PATCH' && req.path === `/api/artifacts/${slug}`) {
      const patch = jsonBody(req);
      if (options.patchStatus === 403 && patch.mode === 'public') {
        return { status: 403, body: { error: 'scope publish cannot change mode' } };
      }
      return { status: 200, body: artifact(slug, { ...patch }) };
    }
    return undefined;
  };
}

test('theme publish uploads the folder as theme-<name> and goes public', async (t) => {
  const dir = await makeTempDir(THEME_FILES);
  const api = await startFakeApi(themeRouter('theme-default', 3));
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);

  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'theme-default', title: 'default' });

  const version = api.requests.find((req) => req.path === '/api/artifacts/theme-default/versions');
  const body = jsonBody(version as RecordedRequest);
  assert.deepEqual(Object.keys(body.files).sort(), [
    'deck.css',
    'fonts/inter.woff2',
    'page.css',
    'theme.json',
    'tokens.css',
  ]);
  assert.equal(body.files['deck.css'].hash, sha256('.deck{}'));
  assert.equal(body.files['deck.css'].type, 'text/css; charset=utf-8');
  assert.equal(body.files['fonts/inter.woff2'].type, 'font/woff2');

  const last = api.requests[api.requests.length - 1] as RecordedRequest;
  assert.equal(last.method, 'PATCH');
  assert.equal(last.path, '/api/artifacts/theme-default');
  assert.deepEqual(jsonBody(last), { mode: 'public' });

  assert.match(result.stdout, /^slug: theme-default$/m);
  assert.match(result.stdout, /^version: 3$/m);
  assert.match(result.stdout, /^\/_themes\/default@3\/$/m);
});

test('theme publish needs theme.json with a name', async (t) => {
  const api = await startFakeApi(themeRouter('theme-default', 1));
  t.after(() => api.close());
  const env = { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' };

  const noMeta = await runCli(['theme', 'publish', await makeTempDir({ 'deck.css': '.deck{}' })], env);
  assert.equal(noMeta.code, 2);
  assert.match(noMeta.stderr, /has no theme\.json/);

  const noName = await runCli(
    ['theme', 'publish', await makeTempDir({ 'theme.json': JSON.stringify({ description: 'x' }) })],
    env,
  );
  assert.equal(noName.code, 2);
  assert.match(noName.stderr, /theme\.json needs a name/);

  const badName = await runCli(
    ['theme', 'publish', await makeTempDir({ 'theme.json': JSON.stringify({ name: 'Not A Name' }) })],
    env,
  );
  assert.equal(badName.code, 2);
  assert.match(badName.stderr, /invalid theme name: Not A Name/);

  const brokenJson = await runCli(
    ['theme', 'publish', await makeTempDir({ 'theme.json': '{ nope' })],
    env,
  );
  assert.equal(brokenJson.code, 2);
  assert.match(brokenJson.stderr, /invalid JSON in /);

  assert.equal(api.requests.length, 0);
});

test('theme publish says a full token is needed when mode public is refused', async (t) => {
  const dir = await makeTempDir(THEME_FILES);
  const api = await startFakeApi(themeRouter('theme-default', 2, { patchStatus: 403 }));
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_publish_only',
  });
  assert.equal(result.code, 4);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^rshow: a full-scope token is needed to set theme-default public \(v2 is published but stays private\)$/m);
  assert.ok(api.requests.some((req) => req.path === '/api/artifacts/theme-default/versions'));
});

test('theme publish skips the patch when the artifact is already public', async (t) => {
  const dir = await makeTempDir(THEME_FILES);
  const api = await startFakeApi(
    themeRouter('theme-default', 4, { patchStatus: 403, existing: { title: 'default', mode: 'public' } }),
  );
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_publish_only',
  });
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^\/_themes\/default@4\/$/m);
  assert.equal(api.requests.filter((req) => req.method === 'PATCH').length, 0);
});

test('theme publish runs the build command in the folder first', async (t) => {
  const dir = await makeTempDir({
    'theme.json': JSON.stringify({ name: 'mono' }),
    'rshow.json': JSON.stringify({ build: "printf '.mono{}' > deck.css" }),
  });
  const api = await startFakeApi(themeRouter('theme-mono', 1));
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
    SHELL: '/bin/sh',
  });
  assert.equal(result.code, 0);

  const version = api.requests.find((req) => req.path === '/api/artifacts/theme-mono/versions');
  const body = jsonBody(version as RecordedRequest);
  assert.deepEqual(Object.keys(body.files).sort(), ['deck.css', 'rshow.json', 'theme.json']);
  assert.equal(body.files['deck.css'].hash, sha256('.mono{}'));
});

test('theme publish fails with exit 5 when the build fails', async (t) => {
  const dir = await makeTempDir({
    'theme.json': JSON.stringify({ name: 'mono' }),
    'rshow.json': JSON.stringify({ build: 'exit 4' }),
  });
  const api = await startFakeApi(themeRouter('theme-mono', 1));
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
    SHELL: '/bin/sh',
  });
  assert.equal(result.code, 5);
  assert.match(result.stderr, /^rshow: build failed: exit 4$/m);
  assert.equal(api.requests.length, 0);
});

test('theme list prints the theme artifacts with their served version', async (t) => {
  const api = await startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts') {
      return {
        status: 200,
        body: {
          artifacts: [
            artifact('site'),
            artifact('theme-mono', { served: 2, mode: 'public' }),
            artifact('theme-default', { served: null, mode: 'public' }),
          ],
        },
      };
    }
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['theme', 'list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'theme-default -\ntheme-mono v2 /_themes/mono@2/\n');
});

test('theme list says so when there are no themes', async (t) => {
  const api = await startFakeApi(() => ({ status: 200, body: { artifacts: [artifact('site')] } }));
  t.after(() => api.close());

  const result = await runCli(['theme', 'list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'no themes\n');
});

test('an unknown theme subcommand is a usage error', async () => {
  const result = await runCli(['theme', 'nope'], { RSHOW_URL: 'http://127.0.0.1:1', RSHOW_TOKEN: 'x' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^rshow: unknown theme command: nope/);
});

test('theme publish leaves an unchanged theme alone', async (t) => {
  const dir = await makeTempDir(THEME_FILES);
  const files: Record<string, { hash: string; size: number; type: string }> = {};
  for (const [name, body] of Object.entries(THEME_FILES)) {
    files[name] = { hash: sha256(body), size: body.length, type: 'text/plain' };
  }
  const base = themeRouter('theme-default', 4, { existing: { title: 'default', latest: 3, mode: 'public' } });
  const api = await startFakeApi((req) => {
    if (req.method === 'GET' && req.path === '/api/artifacts/theme-default/versions/3') {
      return {
        status: 200,
        body: {
          n: 3,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          bytes: 40,
          url: 'https://art.example.com/theme-default/v3/',
          files,
        },
      };
    }
    return base(req);
  });
  t.after(() => api.close());

  const result = await runCli(['theme', 'publish', dir], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'unchanged: theme-default is already v3\n');
  assert.equal(api.requests.some((req) => req.method === 'POST' && req.path === '/api/artifacts/theme-default/versions'), false);
  assert.equal(api.requests.some((req) => req.method === 'PATCH'), false);
});
