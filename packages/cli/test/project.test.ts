import assert from 'node:assert/strict';
import test from 'node:test';
import { artifact, jsonBody, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

function project(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: slug,
    description: '',
    owner: 'owner@example.com',
    role: 'owner',
    artifacts: 0,
    updated_at: '2026-01-01T00:00:00.000Z',
    url: `https://art.example.com/_p/${slug}/`,
    ...overrides,
  };
}

function projectRouter(options: { createStatus?: number } = {}) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.method === 'POST' && req.path === '/api/projects') {
      if (options.createStatus !== undefined) {
        return { status: options.createStatus, body: { error: 'slug is taken' } };
      }
      return { status: 201, body: project(jsonBody(req).slug, jsonBody(req)) };
    }
    if (req.method === 'GET' && req.path === '/api/projects') {
      return {
        status: 200,
        body: {
          projects: [project('deck'), project('talks', { role: 'viewer', artifacts: 2, title: 'Talks' })],
        },
      };
    }
    if (req.method === 'GET' && req.path === '/api/projects/deck') {
      return {
        status: 200,
        body: {
          ...project('deck', { description: 'the deck' }),
          members: [
            { email: 'a@example.com', role: 'viewer' },
            { email: 'b@example.com', role: 'editor' },
          ],
          artifacts: [artifact('one'), artifact('two', { served: null, mode: 'public' })],
        },
      };
    }
    if (req.method === 'PUT' && req.path.startsWith('/api/projects/deck/members/')) {
      const email = decodeURIComponent(req.path.slice('/api/projects/deck/members/'.length));
      return { status: 200, body: { email, role: jsonBody(req).role } };
    }
    if (req.method === 'DELETE' && req.path.startsWith('/api/projects/deck/members/')) {
      return { status: 204 };
    }
    if (req.method === 'DELETE' && req.path === '/api/projects/deck') {
      return { status: 204 };
    }
    return undefined;
  };
}

const ENV = { RSHOW_TOKEN: 'rsh_secret' };

test('project create sends slug, title and description', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const result = await runCli(
    ['project', 'create', 'deck', '--title', 'The deck', '--description', 'slides of the deck'],
    { ...ENV, RSHOW_URL: api.url },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    ['POST /api/projects'],
  );
  assert.deepEqual(jsonBody(api.requests[0] as RecordedRequest), {
    slug: 'deck',
    title: 'The deck',
    description: 'slides of the deck',
  });
  assert.match(result.stdout, /^slug: deck$/m);
  assert.match(result.stdout, /^title: The deck$/m);
  assert.match(result.stdout, /^description: slides of the deck$/m);
  assert.match(result.stdout, /^url: https:\/\/art\.example\.com\/_p\/deck\/$/m);
});

test('project create sends only the slug when no title or description is given', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const result = await runCli(['project', 'create', 'deck'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 0);
  assert.deepEqual(jsonBody(api.requests[0] as RecordedRequest), { slug: 'deck' });
  assert.doesNotMatch(result.stdout, /^description:/m);
});

test('project create rejects a long description or a bad slug without calling the API', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const long = await runCli(['project', 'create', 'deck', '--description', 'x'.repeat(501)], {
    ...ENV,
    RSHOW_URL: api.url,
  });
  assert.equal(long.code, 2);
  assert.match(long.stderr, /^rshow: description too long: 501 \(at most 500\)$/m);

  const bad = await runCli(['project', 'create', 'Deck!'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^rshow: invalid slug: Deck!$/m);
  assert.equal(api.requests.length, 0);
});

test('project create reports a taken slug as an API error', async (t) => {
  const api = await startFakeApi(projectRouter({ createStatus: 409 }));
  t.after(() => api.close());

  const result = await runCli(['project', 'create', 'deck'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 5);
  assert.match(result.stderr, /^rshow: slug is taken$/m);
});

test('project list prints one project per line', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const result = await runCli(['project', 'list'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'deck owner 0 deck\ntalks viewer 2 Talks\n');
});

test('project list says so when there is no project', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/projects') return { status: 200, body: { projects: [] } };
    return undefined;
  });
  t.after(() => api.close());

  const result = await runCli(['project', 'list'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'no projects\n');
});

test('project show prints the project, its members and its artifacts', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const result = await runCli(['project', 'show', 'deck'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^slug: deck$/m);
  assert.match(result.stdout, /^description: the deck$/m);
  assert.match(result.stdout, /^owner: owner@example\.com$/m);
  assert.match(result.stdout, /^role: owner$/m);
  assert.match(result.stdout, /^members: 2$/m);
  assert.match(result.stdout, /^member a@example\.com viewer$/m);
  assert.match(result.stdout, /^member b@example\.com editor$/m);
  assert.match(result.stdout, /^artifacts: 2$/m);
  assert.match(result.stdout, /^artifact one private v1 one$/m);
  assert.match(result.stdout, /^artifact two public - two$/m);
});

test('project share maps flags to members', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const result = await runCli(
    [
      'project',
      'share',
      'deck',
      '--add',
      'a@example.com',
      '--editor',
      'b@example.com',
      '--remove',
      'c@example.com',
    ],
    { ...ENV, RSHOW_URL: api.url },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    [
      'PUT /api/projects/deck/members/a%40example.com',
      'PUT /api/projects/deck/members/b%40example.com',
      'DELETE /api/projects/deck/members/c%40example.com',
    ],
  );
  assert.deepEqual(jsonBody(api.requests[0] as RecordedRequest), { role: 'viewer' });
  assert.deepEqual(jsonBody(api.requests[1] as RecordedRequest), { role: 'editor' });
  assert.match(result.stdout, /^member a@example\.com viewer$/m);
  assert.match(result.stdout, /^member b@example\.com editor$/m);
  assert.match(result.stdout, /^removed c@example\.com$/m);
});

test('project share accepts several emails after one flag', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const result = await runCli(['project', 'share', 'deck', '--add', 'a@example.com', 'b@example.com'], {
    ...ENV,
    RSHOW_URL: api.url,
  });
  assert.equal(result.code, 0);
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    ['PUT /api/projects/deck/members/a%40example.com', 'PUT /api/projects/deck/members/b%40example.com'],
  );
});

test('project share rejects bad input without calling the API', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const nothing = await runCli(['project', 'share', 'deck'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(nothing.code, 2);
  assert.match(nothing.stderr, /^rshow: nothing to change \(try: usage: rshow project share/m);

  const bad = await runCli(['project', 'share', 'deck', '--add', 'nope'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^rshow: --add needs an email, got: nope$/m);
  assert.equal(api.requests.length, 0);
});

test('project delete needs --yes', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const refused = await runCli(['project', 'delete', 'deck'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /project delete needs --yes/);
  assert.equal(api.requests.length, 0);

  const done = await runCli(['project', 'delete', 'deck', '--yes'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(done.code, 0);
  assert.equal(done.stdout.trim(), 'deleted: deck');
  assert.deepEqual(
    api.requests.map((req) => `${req.method} ${req.path}`),
    ['DELETE /api/projects/deck'],
  );
});

test('project takes no or an unknown subcommand as a usage error', async (t) => {
  const api = await startFakeApi(projectRouter());
  t.after(() => api.close());

  const missing = await runCli(['project'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^rshow: expected a project command \(try: usage: rshow project/m);

  const unknown = await runCli(['project', 'rename', 'deck'], { ...ENV, RSHOW_URL: api.url });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^rshow: unknown project command: rename/m);
  assert.equal(api.requests.length, 0);
});

test('project --help prints the project usage without a token', async () => {
  const result = await runCli(['project', '--help']);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^usage: rshow project <create\|list\|show\|share\|delete> \[options\]$/m);
  assert.match(result.stdout, /project share <slug> \[--add email \.\.\.\]/);
});
