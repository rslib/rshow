import assert from 'node:assert/strict';
import test from 'node:test';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

test('blobs/missing is asked for at most 1000 hashes per request', async (t) => {
  const files: Record<string, string> = { 'index.html': '<h1>hi</h1>' };
  for (let i = 0; i < 1200; i += 1) files[`f${i}.txt`] = `file ${i}`;
  const dir = await makeTempDir(files);

  const api = await startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts/site') {
      return { status: 404, body: { error: 'not found' } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact('site') };
    }
    if (req.method === 'POST' && req.path === '/api/blobs/missing') {
      return { status: 200, body: { missing: [] } };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts/site/versions') {
      return {
        status: 201,
        body: {
          n: 1,
          label: '',
          created_by: 'owner@example.com',
          created_at: '2026-01-01T00:00:00.000Z',
          files: 1201,
          bytes: 1,
          url: 'https://art.example.com/site/v1/',
        },
      };
    }
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 0);

  const calls = api.requests.filter((req) => req.path === '/api/blobs/missing');
  assert.deepEqual(
    calls.map((req) => jsonBody(req).hashes.length),
    [1000, 201],
  );
  const seen = new Set<string>();
  for (const call of calls) {
    const { hashes } = jsonBody(call);
    assert.equal(new Set(hashes).size, hashes.length);
    for (const hash of hashes) seen.add(hash);
  }
  assert.equal(seen.size, 1201);
  assert.equal(api.requests.filter((req) => req.method === 'PUT').length, 0);
  assert.match(result.stdout, /^files: 1201$/m);
});
