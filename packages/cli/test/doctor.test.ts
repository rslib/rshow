import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

function healthy(req: RecordedRequest): RouteReply | undefined {
  if (req.method === 'GET' && req.path === '/api/me') {
    return { status: 200, body: { email: 'owner@example.com', scope: 'full' } };
  }
  if (req.method === 'GET' && req.path === '/_themes/default.json') {
    return { status: 200, body: { name: 'default', version: 3 } };
  }
  return undefined;
}

test('doctor reports every check as ok', async (t) => {
  const api = await startFakeApi(healthy);
  t.after(() => api.close());
  const xdg = await makeTempDir({
    'rshow/config.json': JSON.stringify({ url: api.url, art: api.url, theme: 'default' }),
  });

  const result = await runCli(['doctor'], { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^ok {2}rshow {2}\d+\.\d+\.\d+$/m);
  assert.match(result.stdout, /^ok {2}node {2}v[0-9.]+ \(needs >=26\)$/m);
  assert.match(result.stdout, /^ok {2}config {2}.*rshow\/config\.json$/m);
  assert.match(result.stdout, /^ok {2}token {2}source: env$/m);
  assert.match(result.stdout, /^ok {2}api {2}owner@example\.com \(scope full\)$/m);
  assert.match(result.stdout, /^ok {2}art {2}version 3$/m);
  assert.match(result.stdout, /^ok {2}theme {2}default@3$/m);
  assert.doesNotMatch(result.stdout, /rsh_secret/);
  assert.doesNotMatch(result.stderr, /rsh_secret/);
});

test('doctor --json prints the checks', async (t) => {
  const api = await startFakeApi(healthy);
  t.after(() => api.close());
  const xdg = await makeTempDir({ 'rshow/config.json': JSON.stringify({ url: api.url, art: api.url }) });

  const result = await runCli(['--json', 'doctor'], { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  const checks = JSON.parse(result.stdout).checks as { name: string; status: string; detail: string }[];
  assert.deepEqual(
    checks.map((check) => `${check.name} ${check.status}`),
    ['rshow ok', 'node ok', 'config ok', 'token ok', 'api ok', 'art ok'],
  );
  assert.equal(checks.find((check) => check.name === 'api')?.detail, 'owner@example.com (scope full)');
});

test('doctor fails with no config file', async () => {
  const xdg = await makeTempDir({});
  const result = await runCli(['doctor'], {
    XDG_CONFIG_HOME: xdg,
    RSHOW_SECURITY_BIN: '/nonexistent/security',
  });
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^fail {2}config {2}no config file \(missing url and art\)$/m);
  assert.match(result.stdout, /^fail {2}token {2}none/m);
  assert.match(result.stdout, /^fail {2}api {2}no url configured$/m);
  assert.match(result.stdout, /^warn {2}art {2}no art host configured$/m);
});

test('doctor fails when no token is saved', async (t) => {
  const api = await startFakeApi(healthy);
  t.after(() => api.close());
  const xdg = await makeTempDir({ 'rshow/config.json': JSON.stringify({ url: api.url, art: api.url }) });

  const result = await runCli(['doctor'], { XDG_CONFIG_HOME: xdg, RSHOW_SECURITY_BIN: '/nonexistent/security' });
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^fail {2}token {2}none/m);
  assert.match(result.stdout, /^fail {2}api {2}no token$/m);
  assert.match(result.stdout, /^ok {2}art {2}version 3$/m);
  assert.deepEqual(
    api.requests.map((req) => req.path),
    ['/_themes/default.json'],
  );
});

test('doctor reports an api status when the token is rejected', async (t) => {
  const api = await startFakeApi((req) => {
    if (req.path === '/api/me') return { status: 401, body: { error: 'unauthorized' } };
    return healthy(req);
  });
  t.after(() => api.close());
  const xdg = await makeTempDir({ 'rshow/config.json': JSON.stringify({ url: api.url, art: api.url }) });

  const result = await runCli(['doctor'], { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN: 'rsh_bad' });
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^fail {2}api {2}HTTP 401$/m);
  assert.match(result.stdout, /^ok {2}token {2}source: env$/m);
  assert.equal(api.requests.find((req) => req.path === '/api/me')?.headers.authorization, 'Bearer rsh_bad');
});

test('doctor warns and continues when the art host is unreachable', async (t) => {
  const api = await startFakeApi(healthy);
  t.after(() => api.close());
  const xdg = await makeTempDir({
    'rshow/config.json': JSON.stringify({ url: api.url, art: 'http://127.0.0.1:1' }),
  });

  const result = await runCli(['doctor'], { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^ok {2}api {2}owner@example\.com \(scope full\)$/m);
  assert.match(result.stdout, /^warn {2}art {2}/m);
});
