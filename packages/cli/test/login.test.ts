import assert from 'node:assert/strict';
import { chmod, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { EXIT } from '../src/exit.ts';
import { makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const TOKEN = 'rsh_savedtoken';
const ENV_TOKEN = 'rsh_envtoken';

// A stand in for the macOS `security` tool: it keeps items in a JSON file next
// to itself and records the argv of every call, so a test can prove that the
// token only ever travels on stdin.
const FAKE_SECURITY = String.raw`#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const itemsFile = path.join(here, 'items.json');
const logFile = path.join(here, 'argv.log');
const argv = process.argv.slice(2);
appendFileSync(logFile, JSON.stringify(argv) + '\n');

function items() {
  try {
    return JSON.parse(readFileSync(itemsFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveItems(value) {
  writeFileSync(itemsFile, JSON.stringify(value));
}

function words(text) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) => word.replace(/^["']|["']$/g, ''));
}

function option(args, name) {
  const index = args.indexOf('-' + name);
  return index === -1 ? undefined : args[index + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function missing(account) {
  if (items()[account] !== undefined) return false;
  process.stderr.write('security: the specified item could not be found\n');
  return true;
}

const [command, ...rest] = argv;
if (command === '-i') {
  if (process.env.FAKE_SECURITY_IGNORE_ADD === '1') process.exit(0);
  for (const line of (await readStdin()).split('\n')) {
    const text = line.trim();
    if (text === '') continue;
    const [sub, ...tail] = words(text);
    if (sub !== 'add-generic-password') {
      process.stderr.write('security: unsupported: ' + sub + '\n');
      process.exit(2);
    }
    const store = items();
    store[option(tail, 'a')] = option(tail, 'w');
    saveItems(store);
  }
  process.exit(0);
}

const account = option(rest, 'a');
if (command === 'find-generic-password') {
  if (missing(account)) process.exit(44);
  process.stdout.write(items()[account] + '\n');
  process.exit(0);
}
if (command === 'delete-generic-password') {
  if (missing(account)) process.exit(44);
  const store = items();
  delete store[account];
  saveItems(store);
  process.exit(0);
}
process.stderr.write('security: unsupported: ' + command + '\n');
process.exit(2);
`;

type FakeKeychain = { bin: string; items: () => Promise<Record<string, string>>; argv: () => Promise<string[][]> };

async function fakeKeychain(dir: string): Promise<FakeKeychain> {
  const bin = path.join(dir, 'security.mjs');
  const items = async (): Promise<Record<string, string>> => {
    const text = await readFile(path.join(dir, 'items.json'), 'utf8').catch(() => '{}');
    return JSON.parse(text);
  };
  const argv = async (): Promise<string[][]> => {
    const text = await readFile(path.join(dir, 'argv.log'), 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as string[]);
  };
  return { bin, items, argv };
}

async function setup(): Promise<{ dir: string; keychain: FakeKeychain; home: string }> {
  const dir = await makeTempDir({ 'security.mjs': FAKE_SECURITY });
  await chmod(path.join(dir, 'security.mjs'), 0o755);
  return { dir, keychain: await fakeKeychain(dir), home: await makeTempDir({}) };
}

function bearer(req: RecordedRequest): string | undefined {
  const value = req.headers.authorization;
  return typeof value === 'string' ? value.replace(/^Bearer /, '') : undefined;
}

test('login reads the token from stdin and saves it in the keychain', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      if (bearer(req) !== TOKEN) return { status: 401, body: { error: 'bad token' } };
      return { status: 200, body: { email: 'me@example.com', scope: 'full' } };
    }
    return undefined;
  });
  t.after(() => api.close());
  const { keychain, home } = await setup();

  const result = await runCli(
    ['login'],
    { HOME: home, RSHOW_URL: api.url, RSHOW_SECURITY_BIN: keychain.bin },
    { input: `${TOKEN}\n` },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, `logged in as me@example.com (scope full) for ${api.url}\n`);
  assert.deepEqual(await keychain.items(), { [api.url]: TOKEN });
  for (const argv of await keychain.argv()) {
    assert.doesNotMatch(argv.join(' '), new RegExp(TOKEN));
  }
});

test('login fails when the keychain exits 0 but stores nothing', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      return { status: 200, body: { email: 'me@example.com', scope: 'full' } };
    }
    return undefined;
  });
  t.after(() => api.close());
  const { keychain, home } = await setup();

  const result = await runCli(
    ['login'],
    { HOME: home, RSHOW_URL: api.url, RSHOW_SECURITY_BIN: keychain.bin, FAKE_SECURITY_IGNORE_ADD: '1' },
    { input: `${TOKEN}\n` },
  );

  assert.notEqual(result.code, EXIT.ok);
  assert.doesNotMatch(result.stdout, /logged in/);
  assert.match(result.stderr, /cannot save the token in the keychain/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(TOKEN));
  assert.deepEqual(await keychain.items(), {});
});

test('login --json prints the account and keeps the keychain url as the account', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      return { status: 200, body: { email: 'me@example.com', scope: 'publish' } };
    }
    return undefined;
  });
  t.after(() => api.close());
  const { keychain, home } = await setup();

  const result = await runCli(
    ['--json', 'login', '--url', `${api.url}/`],
    { HOME: home, RSHOW_SECURITY_BIN: keychain.bin },
    { input: TOKEN },
  );

  assert.equal(result.code, EXIT.ok);
  assert.deepEqual(JSON.parse(result.stdout), { email: 'me@example.com', scope: 'publish', url: api.url });
  assert.deepEqual(await keychain.items(), { [api.url]: TOKEN });
});

test('login refuses a rejected token and saves nothing', async (t) => {
  const api = await startFakeApi(() => ({ status: 401, body: { error: 'bad token' } }));
  t.after(() => api.close());
  const { keychain, home } = await setup();

  const result = await runCli(
    ['login'],
    { HOME: home, RSHOW_URL: api.url, RSHOW_SECURITY_BIN: keychain.bin },
    { input: `${TOKEN}\n` },
  );

  assert.equal(result.code, EXIT.auth);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'rshow: bad token\n');
  assert.deepEqual(await keychain.items(), {});
  assert.doesNotMatch(result.stderr, new RegExp(TOKEN));
});

test('login rejects an empty or foreign token before it calls the API', async (t) => {
  const api = await startFakeApi(() => ({ status: 200, body: { email: 'me@example.com', scope: 'full' } }));
  t.after(() => api.close());
  const { keychain, home } = await setup();
  const env = { HOME: home, RSHOW_URL: api.url, RSHOW_SECURITY_BIN: keychain.bin };

  const empty = await runCli(['login'], env, { input: '  \n' });
  assert.equal(empty.code, EXIT.usage);
  assert.match(empty.stderr, /^rshow: expected a token on stdin$/m);

  const foreign = await runCli(['login'], env, { input: 'ghp_nope\n' });
  assert.equal(foreign.code, EXIT.usage);
  assert.match(foreign.stderr, /must start with rsh_/);

  assert.equal(api.requests.length, 0);
  assert.deepEqual(await keychain.items(), {});
});

test('a saved token is used when RSHOW_TOKEN is unset, and RSHOW_TOKEN wins', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      return { status: 200, body: { email: 'me@example.com', scope: 'full' } };
    }
    if (req.method === 'GET' && req.path === '/api/artifacts') return { status: 200, body: { artifacts: [] } };
    return undefined;
  });
  t.after(() => api.close());
  const { keychain, home } = await setup();
  const env = { HOME: home, RSHOW_URL: api.url, RSHOW_SECURITY_BIN: keychain.bin };

  const login = await runCli(['login'], env, { input: `${TOKEN}\n` });
  assert.equal(login.code, EXIT.ok);

  const saved = await runCli(['list'], env);
  assert.equal(saved.code, EXIT.ok);
  assert.equal(saved.stdout, 'no artifacts\n');
  assert.equal(bearer(api.requests.at(-1) as RecordedRequest), TOKEN);

  const override = await runCli(['list'], { ...env, RSHOW_TOKEN: ENV_TOKEN });
  assert.equal(override.code, EXIT.ok);
  assert.equal(bearer(api.requests.at(-1) as RecordedRequest), ENV_TOKEN);

  for (const argv of await keychain.argv()) {
    assert.doesNotMatch(argv.join(' '), new RegExp(`${TOKEN}|${ENV_TOKEN}`));
  }
});

test('with no RSHOW_TOKEN and no saved token the message says to log in', async (t) => {
  const { keychain, home } = await setup();
  const result = await runCli(['list'], {
    HOME: home,
    RSHOW_URL: 'http://127.0.0.1:1',
    RSHOW_SECURITY_BIN: keychain.bin,
  });
  assert.equal(result.code, EXIT.usage);
  assert.equal(result.stderr, 'rshow: no token: run rshow login, or set RSHOW_TOKEN\n');
  assert.equal(result.stdout, '');
});

test('logout removes the saved token, and a second logout has nothing to remove', async (t) => {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      return { status: 200, body: { email: 'me@example.com', scope: 'full' } };
    }
    return undefined;
  });
  t.after(() => api.close());
  const { keychain, home } = await setup();
  const env = { HOME: home, RSHOW_URL: api.url, RSHOW_SECURITY_BIN: keychain.bin };

  await runCli(['login'], env, { input: `${TOKEN}\n` });

  const first = await runCli(['logout'], env);
  assert.equal(first.code, EXIT.ok);
  assert.equal(first.stdout, `logged out of ${api.url}\n`);
  assert.deepEqual(await keychain.items(), {});

  const second = await runCli(['logout'], env);
  assert.equal(second.code, EXIT.ok);
  assert.equal(second.stdout, `no saved token for ${api.url}\n`);

  for (const argv of await keychain.argv()) {
    assert.doesNotMatch(argv.join(' '), new RegExp(TOKEN));
  }
});

test('login and logout take the url from --url over the config', async (t) => {
  const other = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      return { status: 200, body: { email: 'me@example.com', scope: 'full' } };
    }
    return undefined;
  });
  t.after(() => other.close());
  const { keychain, home } = await setup();
  const env = { HOME: home, RSHOW_URL: 'http://127.0.0.1:1', RSHOW_SECURITY_BIN: keychain.bin };

  const login = await runCli(['login', '--url', other.url], env, { input: `${TOKEN}\n` });
  assert.equal(login.code, EXIT.ok);
  assert.equal(login.stdout, `logged in as me@example.com (scope full) for ${other.url}\n`);
  assert.deepEqual(await keychain.items(), { [other.url]: TOKEN });

  const logout = await runCli(['logout', '--url', other.url], env);
  assert.equal(logout.stdout, `logged out of ${other.url}\n`);
  assert.deepEqual(await keychain.items(), {});
});
