import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { artifact, jsonBody, makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';
import { MAX_TAGS, normalizeTags, sameTags, tagsOf, validateTag, withTags } from '../src/tags.ts';

const ENV = { RSHOW_TOKEN: 'rsh_secret' };
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

test('validateTag lowercases, trims and rejects a bad tag', () => {
  assert.equal(validateTag(' Release '), 'release');
  assert.equal(validateTag('a'), 'a');
  assert.equal(validateTag('a'.repeat(32)), 'a'.repeat(32));
  assert.throws(() => validateTag('a'.repeat(33)), /invalid tag/);
  assert.throws(() => validateTag('bad_tag'), /invalid tag/);
  assert.throws(() => validateTag('-lead'), /invalid tag/);
  assert.throws(() => validateTag(''), /invalid tag/);
});

test('normalizeTags drops repeats, lowercases and caps the count', () => {
  assert.deepEqual(normalizeTags(['B', 'a', 'b']), ['b', 'a']);
  assert.deepEqual(normalizeTags([]), []);
  const many = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
  assert.deepEqual(normalizeTags(many), many);
  assert.throws(() => normalizeTags([...many, 'one-more']), /too many tags: 11 \(at most 10\)/);
});

test('tagsOf and sameTags take any shape of tags', () => {
  assert.deepEqual(tagsOf(undefined), []);
  assert.deepEqual(tagsOf('release'), []);
  assert.deepEqual(tagsOf(['A', 3, 'b']), ['a', 'b']);
  assert.equal(sameTags(['a', 'b'], ['B', 'a']), true);
  assert.equal(sameTags(['a'], ['a', 'b']), false);
  assert.equal(sameTags(undefined, []), true);
});

test('withTags adds, removes and confirms an existing tag', () => {
  assert.deepEqual(withTags(['a', 'b'], ['c'], ['a']), ['b', 'c']);
  assert.deepEqual(withTags(['a'], ['a'], []), ['a']);
  assert.deepEqual(withTags([], [], ['a']), []);
  assert.deepEqual(withTags(tagsOf(['X']), ['y'], []), ['x', 'y']);
  const many = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
  assert.throws(() => withTags(many, ['one-more'], []), /too many tags/);
});

function tagRouter(slug: string) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === `/api/artifacts/${slug}`) {
      return { status: 200, body: { ...artifact(slug, { tags: ['old'] }), versions: [], shares: [] } };
    }
    if (req.method === 'PATCH' && req.path === `/api/artifacts/${slug}`) {
      return { status: 200, body: artifact(slug, jsonBody(req)) };
    }
    return undefined;
  };
}

test('tag adds and removes tags in one patch', async (t) => {
  const api = await startFakeApi(tagRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['tag', 'site', '--add', 'new', '--remove', 'old'], {
    ...ENV,
    RSHOW_URL: api.url,
  });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    ['GET /api/artifacts/site', 'PATCH /api/artifacts/site'],
  );
  assert.deepEqual(jsonBody(api.requests[1] as RecordedRequest), { tags: ['new'] });
  assert.equal(result.stdout, 'slug: site\ntags: new\n');
});

test('tag takes several tags after one flag and stores them lowercase', async (t) => {
  const api = await startFakeApi(tagRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['tag', 'site', '--add', 'Release', 'docs', 'release'], {
    ...ENV,
    RSHOW_URL: api.url,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(jsonBody(api.requests[1] as RecordedRequest), { tags: ['old', 'release', 'docs'] });
  assert.match(result.stdout, /^tags: old release docs$/m);
});

test('tag removing the last tag prints a dash', async (t) => {
  const api = await startFakeApi(tagRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['tag', 'site', '--remove', 'old'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 0);
  assert.deepEqual(jsonBody(api.requests[1] as RecordedRequest), { tags: [] });
  assert.equal(result.stdout, 'slug: site\ntags: -\n');
});

test('tag with no change is a usage error', async (t) => {
  const api = await startFakeApi(tagRouter('site'));
  t.after(() => api.close());

  const result = await runCli(['tag', 'site'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^rshow: nothing to change \(try: usage: rshow tag/m);
  assert.equal(api.requests.length, 0);
});

test('tag rejects a bad tag and too many tags without calling the API', async (t) => {
  const api = await startFakeApi(tagRouter('site'));
  t.after(() => api.close());

  const bad = await runCli(['tag', 'site', '--add', 'bad_tag'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^rshow: invalid tag: bad_tag$/m);

  const many = Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`);
  const tooMany = await runCli(['tag', 'site', '--add', ...many], { ...ENV, RSHOW_URL: api.url });
  assert.equal(tooMany.code, 2);
  assert.match(tooMany.stderr, /^rshow: too many tags: 11 \(at most 10\)$/m);
  assert.equal(api.requests.length, 0);
});

test('tag --help prints the tag usage without a token', async () => {
  const result = await runCli(['tag', '--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^usage: rshow tag <slug> \[--add t \.\.\.\] \[--remove t \.\.\.\]$/m);
});

test('list sends the project, tag and text filters together', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path.startsWith('/api/artifacts')) {
      return { status: 200, body: { artifacts: [artifact('one', { project: 'deck', tags: ['release'] })] } };
    }
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['list', '--project', 'deck', '--tag', 'release', '--q', 'my deck'], {
    ...ENV,
    RSHOW_URL: api.url,
  });
  assert.equal(result.code, 0);
  assert.equal((api.requests[0] as RecordedRequest).path, '/api/artifacts?project=deck&tag=release&q=my+deck');
  assert.equal(result.stdout, 'one private v1 one\n');
});

test('list sends no query string without filters', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts') return { status: 200, body: { artifacts: [] } };
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['list'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 0);
  assert.equal((api.requests[0] as RecordedRequest).path, '/api/artifacts');
  assert.equal(result.stdout, 'no artifacts\n');
});

test('list rejects a bad tag, a bad project or empty text without calling the API', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET') return { status: 200, body: { artifacts: [] } };
    return undefined;
  });
  t.after(() => api.close());

  const badTag = await runCli(['list', '--tag', 'bad_tag'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(badTag.code, 2);
  assert.match(badTag.stderr, /^rshow: invalid tag: bad_tag$/m);

  const badProject = await runCli(['list', '--project', 'Deck!'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(badProject.code, 2);
  assert.match(badProject.stderr, /^rshow: invalid slug: Deck!$/m);

  const emptyText = await runCli(['list', '--q', '  '], { ...ENV, RSHOW_URL: api.url });
  assert.equal(emptyText.code, 2);
  assert.match(emptyText.stderr, /^rshow: --q needs text/m);
  assert.equal(api.requests.length, 0);
});

function publishRouter(existing?: Record<string, unknown>) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/artifacts/site') {
      if (existing === undefined) return { status: 404, body: { error: 'not found' } };
      return { status: 200, body: artifact('site', existing) };
    }
    if (req.method === 'POST' && req.path === '/api/artifacts') {
      return { status: 201, body: artifact('site', jsonBody(req)) };
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
          files: 1,
          bytes: 12,
          url: 'https://art.example.com/site/v1/',
        },
      };
    }
    if (req.method === 'PATCH' && req.path === '/api/artifacts/site') {
      return { status: 200, body: artifact('site', jsonBody(req)) };
    }
    return undefined;
  };
}

async function publishEnv(apiUrl: string, env: Record<string, string> = {}): Promise<Record<string, string>> {
  return { ...ENV, RSHOW_URL: apiUrl, RSHOW_ART: apiUrl, HOME: await makeTempDir({}), ...env };
}

test('publish sends project and tags when it creates the artifact', async (t) => {
  const dir = await makeTempDir({ 'index.html': '<h1>hi</h1>' });
  const api = await startFakeApi(publishRouter());
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--project', 'deck', '--tag', 'a', 'b'], await publishEnv(api.url));
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);

  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'site', project: 'deck', tags: ['a', 'b'] });
  assert.equal(api.requests.some((req) => req.method === 'PATCH'), false);
});

test('publish moves an existing artifact into a project and sets its tags', async (t) => {
  const dir = await makeTempDir({ 'index.html': '<h1>hi</h1>' });
  const api = await startFakeApi(publishRouter({ project: null, tags: [] }));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--project', 'deck', '--tag', 'release'], await publishEnv(api.url));
  assert.equal(result.code, 0);

  const patch = api.requests.find((req) => req.method === 'PATCH');
  assert.deepEqual(jsonBody(patch as RecordedRequest), { project: 'deck', tags: ['release'] });
  assert.equal(api.requests.some((req) => req.method === 'POST' && req.path === '/api/artifacts'), false);
});

test('publish leaves project and tags alone when they already match', async (t) => {
  const dir = await makeTempDir({ 'index.html': '<h1>hi</h1>' });
  const api = await startFakeApi(publishRouter({ project: 'deck', tags: ['release'] }));
  t.after(() => api.close());

  const result = await runCli(['publish', dir, '--slug', 'site', '--project', 'deck', '--tag', 'release'], await publishEnv(api.url));
  assert.equal(result.code, 0);
  assert.equal(api.requests.some((req) => req.method === 'PATCH'), false);
});

test('publish takes project and tags from rshow.json', async (t) => {
  const dir = await makeTempDir({
    'index.html': '<h1>hi</h1>',
    'rshow.json': JSON.stringify({ slug: 'site', project: 'deck', tags: ['Release', 'release'] }),
  });
  const api = await startFakeApi(publishRouter());
  t.after(() => api.close());

  const result = await runCli(['publish', dir], await publishEnv(api.url));
  assert.equal(result.code, 0);

  const create = api.requests.find((req) => req.method === 'POST' && req.path === '/api/artifacts');
  assert.deepEqual(jsonBody(create as RecordedRequest), { slug: 'site', project: 'deck', tags: ['release'] });
  const missing = api.requests.find((req) => req.path === '/api/blobs/missing');
  assert.ok(jsonBody(missing as RecordedRequest).hashes.includes(sha256('<h1>hi</h1>')));
});

test('publish rejects a bad project or tag without calling the API', async (t) => {
  const dir = await makeTempDir({ 'index.html': '<h1>hi</h1>' });
  const api = await startFakeApi(publishRouter());
  t.after(() => api.close());

  const badProject = await runCli(['publish', dir, '--slug', 'site', '--project', 'Deck!'], await publishEnv(api.url));
  assert.equal(badProject.code, 2);
  assert.match(badProject.stderr, /^rshow: invalid slug: Deck!$/m);

  const badTag = await runCli(['publish', dir, '--slug', 'site', '--tag', 'bad_tag'], await publishEnv(api.url));
  assert.equal(badTag.code, 2);
  assert.match(badTag.stderr, /^rshow: invalid tag: bad_tag$/m);
  assert.equal(api.requests.length, 0);
});
