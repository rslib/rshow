import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { FakeApi, RecordedRequest, RouteReply } from './helpers.ts';

test('config prints no default hosts', async () => {
  const home = await makeTempDir({});
  const result = await runCli(['config', await makeTempDir({}), '--offline'], { HOME: home });
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), { out: 'dist' });
});

test('config skips the theme lookup with no art host and warns', async () => {
  const result = await runCli(['config', await makeTempDir({})], { HOME: await makeTempDir({}) });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /^rshow: warning: no art host configured; skipping theme version lookup$/m);
});

test('a command that needs the server says how to configure it', async () => {
  const result = await runCli(['list'], { HOME: await makeTempDir({}) });
  assert.equal(result.code, 2);
  assert.equal(
    result.stderr,
    'rshow: no server configured: run rshow init --url <admin-url> --art <viewer-url>\n',
  );
});

test('RSHOW_ART overrides the art from config', async () => {
  const home = await makeTempDir({ '.config/rshow/config.json': JSON.stringify({ art: 'https://art.test' }) });
  const result = await runCli(['config', await makeTempDir({}), '--offline'], {
    HOME: home,
    RSHOW_ART: 'https://env-art.test/',
  });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).art, 'https://env-art.test');
});

test('config merges the global file and rshow.json, later wins', async () => {
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({
      url: 'https://api.test',
      art: 'https://art.test',
      theme: 'default@3',
      tokens: { '--accent': '#6EA8FF', '--ink': '#111111' },
      title: 'global',
    }),
  });
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({
      slug: 'deck',
      title: 'local',
      theme: 'mono@1',
      tokens: { '--accent': '#F2B33D' },
      build: 'npm run build',
      out: 'build',
    }),
  });

  const result = await runCli(['config', dir], { HOME: home });
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    url: 'https://api.test',
    art: 'https://art.test',
    theme: 'mono@1',
    tokens: { '--accent': '#F2B33D', '--ink': '#111111' },
    slug: 'deck',
    title: 'local',
    build: 'npm run build',
    out: 'build',
  });
});

test('config reads XDG_CONFIG_HOME before ~/.config', async () => {
  const xdg = await makeTempDir({ 'rshow/config.json': JSON.stringify({ url: 'https://xdg.test' }) });
  const home = await makeTempDir({ '.config/rshow/config.json': JSON.stringify({ url: 'https://home.test' }) });

  const result = await runCli(['config', await makeTempDir({}), '--offline'], { HOME: home, XDG_CONFIG_HOME: xdg });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).url, 'https://xdg.test');
});

test('RSHOW_URL overrides the url from config', async () => {
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ url: 'https://api.test' }),
  });
  const result = await runCli(['config', await makeTempDir({}), '--offline'], {
    HOME: home,
    RSHOW_URL: 'https://env.test/',
  });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).url, 'https://env.test');
});

test('config prints the same json for --json and needs no token', async () => {
  const home = await makeTempDir({});
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ slug: 'deck' }) });
  const plain = await runCli(['config', dir, '--offline'], { HOME: home });
  const json = await runCli(['--json', 'config', dir, '--offline'], { HOME: home });
  assert.equal(plain.code, 0);
  assert.equal(json.code, 0);
  assert.equal(plain.stdout, json.stdout);
  assert.equal(JSON.parse(plain.stdout).slug, 'deck');
});

test('a token in a config file is never read', async () => {
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ url: 'https://api.test', token: 'rsh_file_token' }),
  });
  const printed = await runCli(['config', await makeTempDir({}), '--offline'], { HOME: home });
  assert.equal(printed.code, 0);
  assert.equal(JSON.parse(printed.stdout).token, undefined);
  assert.doesNotMatch(printed.stdout, /rsh_file_token/);

  const listed = await runCli(['list'], { HOME: home, RSHOW_URL: 'http://127.0.0.1:1' });
  assert.equal(listed.code, 2);
  assert.match(listed.stderr, /^rshow: no token: run rshow login, or set RSHOW_TOKEN$/m);
  assert.doesNotMatch(listed.stderr, /rsh_file_token/);
});

test('a broken config file is a usage error', async () => {
  const home = await makeTempDir({ '.config/rshow/config.json': '{ nope' });
  const result = await runCli(['config', await makeTempDir({})], { HOME: home });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /^rshow: invalid JSON in /);

  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ out: 4 }) });
  const wrongType = await runCli(['config', dir], { HOME: await makeTempDir({}) });
  assert.equal(wrongType.code, 2);
  assert.match(wrongType.stderr, /out must be a string/);
});

test('publish takes the url from the config file', async () => {
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ url: 'http://127.0.0.1:1', art: 'http://127.0.0.1:1' }),
  });
  const dir = await makeTempDir({ 'index.html': '<h1>hi</h1>' });
  const result = await runCli(['publish', dir], { HOME: home, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 5);
  assert.match(result.stderr, /^rshow: network error: /);
});

test('config prints project and tags from rshow.json', async () => {
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ project: 'global', tags: ['old'] }),
  });
  const dir = await makeTempDir({
    'rshow.json': JSON.stringify({ slug: 'deck', project: 'deck', tags: ['Release', 'release', 'docs'] }),
  });

  const result = await runCli(['config', dir, '--offline'], { HOME: home });
  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    out: 'dist',
    slug: 'deck',
    project: 'deck',
    tags: ['release', 'docs'],
  });
});

test('config takes the global project and tags when rshow.json has none', async () => {
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ project: 'global', tags: ['old'] }),
  });
  const result = await runCli(['config', await makeTempDir({}), '--offline'], { HOME: home });
  assert.equal(result.code, 0);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.project, 'global');
  assert.deepEqual(printed.tags, ['old']);
});

test('config rejects bad tags', async () => {
  const home = await makeTempDir({});
  const notList = await runCli(['config', await makeTempDir({ 'rshow.json': JSON.stringify({ tags: 'x' }) })], {
    HOME: home,
  });
  assert.equal(notList.code, 2);
  assert.match(notList.stderr, /tags must be an array/);

  const notString = await runCli(['config', await makeTempDir({ 'rshow.json': JSON.stringify({ tags: [1] }) })], {
    HOME: home,
  });
  assert.equal(notString.code, 2);
  assert.match(notString.stderr, /tags must hold strings/);

  const badTag = await runCli(['config', await makeTempDir({ 'rshow.json': JSON.stringify({ tags: ['bad_tag'] }) })], {
    HOME: home,
  });
  assert.equal(badTag.code, 2);
  assert.match(badTag.stderr, /invalid tag: bad_tag/);
});

async function startFakeArt(themes: Record<string, number>): Promise<FakeApi> {
  return startFakeApi((req: RecordedRequest): RouteReply | undefined => {
    const name = req.path.match(/^\/_themes\/([a-z0-9-]+)\.json$/)?.[1];
    if (name === undefined || themes[name] === undefined) return undefined;
    return { status: 200, body: { name, version: themes[name], url: `/_themes/${name}@${themes[name]}/` } };
  });
}

test('config resolves a missing theme to default@latest', async (t) => {
  const api = await startFakeArt({ default: 3 });
  t.after(() => api.close());
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ slug: 'deck', art: api.url }) });

  const result = await runCli(['config', dir], { HOME: await makeTempDir({}) });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(api.requests.length, 1);
  assert.equal(api.requests[0]?.path, '/_themes/default.json');
  assert.deepEqual(JSON.parse(result.stdout), {
    art: api.url,
    out: 'dist',
    slug: 'deck',
    theme: 'default@latest',
    theme_resolved: 'default@3',
  });
});

test('config resolves name@latest to the served version', async (t) => {
  const api = await startFakeArt({ mono: 7 });
  t.after(() => api.close());
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url, theme: 'mono@latest' }) });

  const result = await runCli(['config', dir], { HOME: await makeTempDir({}) });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.theme, 'mono@latest');
  assert.equal(printed.theme_resolved, 'mono@7');
});

test('config leaves name@n alone and makes no request', async (t) => {
  const api = await startFakeArt({ mono: 7 });
  t.after(() => api.close());
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url, theme: 'mono@2' }) });

  const result = await runCli(['config', dir], { HOME: await makeTempDir({}) });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).theme, 'mono@2');
  assert.equal(api.requests.length, 0);
});

test('an unknown theme keeps the value and warns', async (t) => {
  const api = await startFakeArt({});
  t.after(() => api.close());
  const home = await makeTempDir({});
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url }) });

  const result = await runCli(['config', dir], { HOME: home });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).theme, undefined);
  assert.match(result.stderr, /^rshow: warning: cannot resolve theme default: /);

  const named = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url, theme: 'mono@latest' }) });
  const kept = await runCli(['config', named], { HOME: home });
  assert.equal(kept.code, 0);
  assert.equal(JSON.parse(kept.stdout).theme, 'mono@latest');
  assert.equal(JSON.parse(kept.stdout).theme_resolved, undefined);
  assert.match(kept.stderr, /^rshow: warning: cannot resolve theme mono: /);
});

test('config rejects a theme name it cannot ask for', async (t) => {
  const api = await startFakeArt({ mono: 7 });
  t.after(() => api.close());
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url, theme: 'Mon_o' }) });

  const result = await runCli(['config', dir], { HOME: await makeTempDir({}) });
  assert.equal(result.code, 0);
  assert.equal(JSON.parse(result.stdout).theme, 'Mon_o@latest');
  assert.equal(JSON.parse(result.stdout).theme_resolved, undefined);
  assert.equal(api.requests.length, 0);
  assert.match(result.stderr, /^rshow: warning: cannot resolve theme Mon_o: theme name is not valid$/m);
});

test('config --offline skips the theme lookup', async (t) => {
  const api = await startFakeArt({ default: 3, mono: 7 });
  t.after(() => api.close());
  const home = await makeTempDir({});
  const dir = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url, theme: 'mono@latest' }) });

  const result = await runCli(['config', dir, '--offline'], { HOME: home });
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).theme, 'mono@latest');

  const bare = await makeTempDir({ 'rshow.json': JSON.stringify({ art: api.url }) });
  const online = await runCli(['config', bare], { HOME: home });
  assert.equal(JSON.parse(online.stdout).theme, 'default@latest');
  assert.equal(JSON.parse(online.stdout).theme_resolved, 'default@3');
  assert.equal(api.requests.length, 1);

  const offline = await runCli(['config', bare, '--offline'], { HOME: home });
  assert.equal(offline.code, 0);
  assert.equal(offline.stderr, '');
  assert.equal(JSON.parse(offline.stdout).theme, undefined);
  assert.equal(api.requests.length, 1);
});
