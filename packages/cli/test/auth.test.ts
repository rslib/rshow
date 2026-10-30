import assert from 'node:assert/strict';
import test from 'node:test';
import { EXIT } from '../src/exit.ts';
import { runCli, startFakeApi } from './helpers.ts';
import type { RouteReply } from './helpers.ts';

test('exit code for 401 is EXIT.auth', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.headers.authorization !== 'Bearer good') {
      return { status: 401, body: { error: 'bad token' } };
    }
    if (req.method === 'GET' && req.path === '/api/artifacts') return { status: 200, body: { artifacts: [] } };
    return undefined;
  });
  t.after(() => api.close());

  const denied = await runCli(['list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'bad' });
  assert.equal(denied.code, EXIT.auth);
  assert.equal(denied.stderr, 'rshow: bad token\n');
  assert.equal(denied.stdout, '');

  const forbidden = await runCli(['show', 'site'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'bad' });
  assert.equal(forbidden.code, EXIT.auth);

  const allowed = await runCli(['list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'good' });
  assert.equal(allowed.code, EXIT.ok);
  assert.equal(allowed.stdout, 'no artifacts\n');
});

test('a missing token is a usage error', async () => {
  const result = await runCli(['list'], { RSHOW_URL: 'http://127.0.0.1:1' });
  assert.equal(result.code, EXIT.usage);
  assert.match(result.stderr, /^rshow: no token: run rshow login, or set RSHOW_TOKEN$/m);
});

test('the token is never accepted as a flag', async () => {
  const result = await runCli(['list', '--token', 'rsh_secret'], { RSHOW_URL: 'http://127.0.0.1:1' });
  assert.equal(result.code, EXIT.usage);
  assert.match(result.stderr, /^rshow: /);
  assert.doesNotMatch(result.stderr, /rsh_secret/);
});

test('network failures are api errors', async () => {
  const result = await runCli(['list'], { RSHOW_URL: 'http://127.0.0.1:1', RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, EXIT.api);
  assert.match(result.stderr, /^rshow: network error: /);
});

test('server errors are api errors', async (t) => {
  const api = await startFakeApi(() => ({ status: 500, body: { error: 'boom' } }));
  t.after(() => api.close());

  const result = await runCli(['list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, EXIT.api);
  assert.match(result.stderr, /^rshow: boom$/m);
});

test('help exits zero without a token', async () => {
  const general = await runCli(['--help'], {});
  assert.equal(general.code, EXIT.ok);
  assert.match(general.stdout, /^usage: rshow <command>/);

  const publish = await runCli(['publish', '--help'], {});
  assert.equal(publish.code, EXIT.ok);
  assert.match(publish.stdout, /^usage: rshow publish/);

  const json = await runCli(['--json', '--help'], {});
  assert.equal(json.code, EXIT.ok);
});

test('unknown commands and missing arguments are usage errors', async () => {
  const unknown = await runCli(['nope'], { RSHOW_URL: 'http://127.0.0.1:1', RSHOW_TOKEN: 'x' });
  assert.equal(unknown.code, EXIT.usage);
  assert.match(unknown.stderr, /^rshow: unknown command: nope/);

  const bare = await runCli([], {});
  assert.equal(bare.code, EXIT.usage);
  assert.match(bare.stderr, /^usage: rshow/);
});
