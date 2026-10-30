import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const HTML = '<h1>hi</h1>';
const JS = 'console.log(1)';

function publishRouter(slug: string, known: Set<string>, versionUrl: () => string, liveUrl?: () => string) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}`) {
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      const url = liveUrl === undefined ? undefined : liveUrl();
      return { status: 201, body: url === undefined ? artifact(slug) : artifact(slug, { url }) };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      const { hashes } = jsonBody(req);
      return { status: 200, body: { missing: hashes.filter((hash: string) => !known.has(hash)) } };
    }
    if (req.method === 'PUT' && req.path.startsWith('/api/blobs/')) {
      return { status: 204 };
    }
    if (req.method === 'POST' && req.path === `/api/artifacts/${slug}/versions`) {
      return {
        status: 201,
        body: {
          n: 2,
          label: 'first',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 2,
          bytes: 24,
          url: versionUrl(),
        },
      };
    }
    return undefined;
  };
}

test('publish uploads only the blobs the server says are missing', async (t) => {
  const dir = await makeTempDir({ 'index.html': HTML, 'app.js': JS });
  const api = await startFakeApi(
    publishRouter(
      'site',
      new Set([sha256(HTML)]),
      () => `${api.url}/site/v2/`,
      () => `${api.url}/site/`,
    ),
  );
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--label', 'first'], {
    RSHOW_URL: api.url,
    RSHOW_ART: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);

  const blobPuts = api.requests.filter((req) => req.method === 'PUT' && req.path.startsWith('/api/blobs/'));
  assert.deepEqual(
    blobPuts.map((req) => req.path),
    [`/api/blobs/${sha256(JS)}`],
  );
  assert.equal(blobPuts[0]?.body.toString('utf8'), JS);
  assert.equal(blobPuts[0]?.headers.authorization, 'Bearer rsh_secret');

  const missing = api.requests.find((req) => req.path === '/api/blobs/missing');
  assert.deepEqual(jsonBody(missing as RecordedRequest).hashes.sort(), [sha256(HTML), sha256(JS)].sort());

  const version = api.requests.find((req) => req.path === '/api/artifacts/site/versions');
  const body = jsonBody(version as RecordedRequest);
  assert.equal(body.label, 'first');
  assert.deepEqual(Object.keys(body.files).sort(), ['app.js', 'index.html']);
  assert.deepEqual(body.files['app.js'], { hash: sha256(JS), size: JS.length, type: 'text/javascript; charset=utf-8' });
  assert.deepEqual(body.files['index.html'], {
    hash: sha256(HTML),
    size: HTML.length,
    type: 'text/html; charset=utf-8',
  });
  assert.equal((version as RecordedRequest).headers['content-type'], 'application/json');

  assert.match(result.stdout, new RegExp(`version-url: ${api.url}/site/v2/`));
  assert.match(result.stdout, new RegExp(`live-url: ${api.url}/site/`));
  assert.match(result.stdout, /uploaded: 1/);
  assert.match(result.stdout, /skipped: 1/);
});

test('publish --json prints the reply as json', async (t) => {
  const dir = await makeTempDir({ 'index.html': HTML });
  const api = await startFakeApi(publishRouter('site', new Set(), () => `${api.url}/site/v1/`));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--json'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.artifact.slug, 'site');
  assert.equal(parsed.version.n, 2);
  assert.equal(parsed.blobs.uploaded, 1);
  assert.equal(parsed.blobs.skipped, 0);
});

test('publish sends a single file as index.html', async (t) => {
  const dir = await makeTempDir({ 'page.html': HTML });
  const api = await startFakeApi(publishRouter('page-html', new Set(), () => `${api.url}/page-html/v1/`));
  t.after(() => api.close());

  const result = await runCli(['publish', `${dir}/page.html`], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 0);

  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'page-html' });

  const version = api.requests.find((req) => req.path === '/api/artifacts/page-html/versions');
  const body = jsonBody(version as RecordedRequest);
  assert.deepEqual(Object.keys(body.files), ['index.html']);
  assert.equal(body.files['index.html'].hash, sha256(HTML));
  assert.equal(body.files['index.html'].type, 'text/html; charset=utf-8');
});

test('publish derives the slug from the folder name', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'rshow-'));
  const dir = path.join(root, 'My Site');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), HTML);

  const api = await startFakeApi(publishRouter('my-site', new Set(), () => `${api.url}/my-site/v1/`));
  t.after(() => api.close());

  const result = await runCli(['publish', dir], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.equal(jsonBody(create as RecordedRequest).slug, 'my-site');
});

test('publish uploads blobs with concurrency 6', async (t) => {
  const files: Record<string, string> = { 'index.html': HTML };
  for (let i = 0; i < 8; i += 1) files[`f${i}.txt`] = `file ${i}`;
  const dir = await makeTempDir(files);

  let inFlight = 0;
  let peak = 0;
  const base = publishRouter('site', new Set(), () => 'http://example.test/site/v1/');
  const api = await startFakeApi((req) => {
    if (req.method === 'PUT' && req.path.startsWith('/api/blobs/')) {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight -= 1;
      }, 30);
      return { status: 204, delayMs: 60 };
    }
    return base(req);
  });
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.equal(api.requests.filter((req) => req.method === 'PUT' && req.path.startsWith('/api/blobs/')).length, 9);
  assert.equal(peak, 6);
});

test('publish refuses a folder without index.html', async () => {
  const dir = await makeTempDir({ 'other.html': HTML });
  const result = await runCli(['publish', dir], { RSHOW_URL: 'http://127.0.0.1:1', RSHOW_TOKEN: 'x' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^rshow: /);
  assert.match(result.stderr, /has no index\.html/);
});

const PAGE = '<!doctype html><meta name="viewport" content="width=device-width"><title>site</title><p>hi</p>';

type Files = Record<string, { hash: string; size: number; type: string }>;

function filesOf(files: Record<string, string>): Files {
  const out: Files = {};
  for (const [name, body] of Object.entries(files)) {
    out[name] = { hash: sha256(body), size: body.length, type: 'text/html; charset=utf-8' };
  }
  return out;
}

function storedRouter(slug: string, latest: number, files: Record<string, {
  hash: string;
  size: number;
  type: string;
}>) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}`) {
      return { status: 200, body: artifact(slug, { latest }) };
    }
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}/versions/${latest}`) {
      return {
        status: 200,
        body: {
          n: latest,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          bytes: 24,
          url: `https://art.example.com/${slug}/v${latest}/`,
          files,
        },
      };
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
          n: latest + 1,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 1,
          bytes: 12,
          url: `https://art.example.com/${slug}/v${latest + 1}/`,
        },
      };
    }
    return undefined;
  };
}

test('publish leaves an unchanged folder alone', async (t) => {
  const dir = await makeTempDir({ 'index.html': PAGE });
  const api = await startFakeApi(storedRouter('site', 1, filesOf({ 'index.html': PAGE })));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'unchanged: site is already v1\n');
  assert.equal(api.requests.some((req) => req.path === '/api/blobs/missing'), false);
  assert.equal(api.requests.some((req) => req.method === 'PUT'), false);
  assert.equal(api.requests.some((req) => req.method === 'POST' && req.path === '/api/artifacts/site/versions'), false);
});

test('publish --json prints unchanged as data', async (t) => {
  const dir = await makeTempDir({ 'index.html': PAGE });
  const api = await startFakeApi(storedRouter('site', 4, filesOf({ 'index.html': PAGE })));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--json'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { unchanged: true, slug: 'site', version: 4 });
});

test('publish uploads a folder with one changed file', async (t) => {
  const dir = await makeTempDir({ 'index.html': `${PAGE}<!-- moved -->` });
  const api = await startFakeApi(storedRouter('site', 1, filesOf({ 'index.html': PAGE })));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^version: 2$/m);
  assert.equal(api.requests.some((req) => req.method === 'POST' && req.path === '/api/artifacts/site/versions'), true);
});

test('publish --force adds a version for an unchanged folder', async (t) => {
  const dir = await makeTempDir({ 'index.html': PAGE });
  const api = await startFakeApi(storedRouter('site', 1, filesOf({ 'index.html': PAGE })));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--force'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /^version: 2$/m);
  assert.equal(api.requests.some((req) => req.path === '/api/artifacts/site/versions/1'), false);
});

test('publish goes ahead when the artifact has no version yet', async (t) => {
  const dir = await makeTempDir({ 'index.html': PAGE });
  const api = await startFakeApi((req) => {
    if (req.method === 'GET' && req.path === '/api/artifacts/first') {
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact('first', { latest: null, served: null }) };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: jsonBody(req).hashes } };
    }
    if (req.method === 'PUT' && req.path.startsWith('/api/blobs/')) return { status: 204 };
    if (req.method === 'POST' && req.path === '/api/artifacts/first/versions') {
      return { status: 201, body: { ...artifact('first'), n: 1, label: '', url: 'https://art.example.com/first/v1/' } };
    }
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'first'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^version: 1$/m);
  assert.equal(api.requests.some((req) => req.path.startsWith('/api/artifacts/first/versions/')), false);
});
