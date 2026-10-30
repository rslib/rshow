import assert from 'node:assert/strict';
import test from 'node:test';
import { artifact, jsonBody, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

function shareRouter(slug: string) {
  return (req: RecordedRequest): RouteReply | undefined => {
    const shares = `/api/artifacts/${slug}/shares/`;
    if (req.method === 'PATCH' && req.path === `/api/artifacts/${slug}`) {
      return { status: 200, body: artifact(slug, jsonBody(req)) };
    }
    if (req.method === 'PUT' && req.path.startsWith(shares)) {
      const email = decodeURIComponent(req.path.slice(shares.length));
      return { status: 200, body: { email, role: jsonBody(req).role } };
    }
    if (req.method === 'DELETE' && req.path.startsWith(shares)) {
      return { status: 204 };
    }
    return undefined;
  };
}

test('share maps flags to requests', async (t) => {
  const api = await startFakeApi(shareRouter('site'));
  t.after(() => api.close());

  const result = await runCli(
    [
      'share',
      'site',
      '--mode',
      'public',
      '--add',
      'a@example.com',
      '--editor',
      'b@example.com',
      '--remove',
      'c@example.com',
    ],
    { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    [
      'PATCH /api/artifacts/site',
      'PUT /api/artifacts/site/shares/a%40example.com',
      'PUT /api/artifacts/site/shares/b%40example.com',
      'DELETE /api/artifacts/site/shares/c%40example.com',
    ],
  );
  assert.deepEqual(jsonBody(api.requests[0] as RecordedRequest), { mode: 'public' });
  assert.deepEqual(jsonBody(api.requests[1] as RecordedRequest), { role: 'viewer' });
  assert.deepEqual(jsonBody(api.requests[2] as RecordedRequest), { role: 'editor' });

  assert.match(result.stdout, /^mode: public$/m);
  assert.match(result.stdout, /^share a@example\.com viewer$/m);
  assert.match(result.stdout, /^share b@example\.com editor$/m);
  assert.match(result.stdout, /^removed c@example\.com$/m);
});

test('share accepts several emails after one flag', async (t) => {
  const api = await startFakeApi(shareRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['share', 'site', '--add', 'a@example.com', 'b@example.com'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    ['PUT /api/artifacts/site/shares/a%40example.com', 'PUT /api/artifacts/site/shares/b%40example.com'],
  );
});

test('share rejects an unknown mode without calling the API', async (t) => {
  const api = await startFakeApi(shareRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['share', 'site', '--mode', 'friends'], {
    RSHOW_URL: api.url,
    RSHOW_TOKEN: 'rsh_secret',
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^rshow: unknown mode: friends/);
  assert.equal(api.requests.length, 0);
});

test('share with no change is a usage error', async (t) => {
  const api = await startFakeApi(shareRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['share', 'site'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 2);
  assert.equal(api.requests.length, 0);
});
