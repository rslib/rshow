import assert from 'node:assert/strict';
import { chmod, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { run as login } from '../src/commands/login.ts';
import type { Ctx } from '../src/context.ts';
import { EXIT } from '../src/exit.ts';
import { choose } from '../src/tokenstore.ts';
import { makeTempDir, runCli, startFakeApi } from './helpers.ts';
import type { FakeApi, RecordedRequest, RouteReply } from './helpers.ts';

const TOKEN = 'rsh_filetoken';
const OTHER = 'rsh_othertoken';
const NO_SECURITY = '/nonexistent/security';

// A stand in for `secret-tool`: the probe, store, lookup and clear of the real
// tool, with the secrets in a JSON file next to the script and the argv of every
// call recorded, so a test can prove the token only ever travels on stdin.
const FAKE_SECRET_TOOL = String.raw`#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const itemsFile = path.join(here, 'items.json');
const logFile = path.join(here, 'argv.log');
const argv = process.argv.slice(2);
appendFileSync(logFile, JSON.stringify(argv) + '\n');

if (process.env.FAKE_SECRET_TOOL_DOWN === '1') {
  process.stderr.write('secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n');
  process.exit(2);
}

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

function after(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const [command, ...rest] = argv;
const service = after(rest, 'service');
const account = after(rest, 'account');

if (command === 'lookup') {
  const token = service === 'rshow-probe' ? undefined : items()[account];
  if (token === undefined) {
    process.stderr.write('secret-tool: no such secret\n');
    process.exit(1);
  }
  process.stdout.write(token + '\n');
  process.exit(0);
}
if (command === 'store') {
  const token = (await readStdin()).trim();
  if (process.env.FAKE_SECRET_TOOL_IGNORE_STORE === '1') process.exit(0);
  const store = items();
  store[account] = token;
  saveItems(store);
  process.exit(0);
}
if (command === 'clear') {
  const store = items();
  if (store[account] === undefined) process.exit(1);
  delete store[account];
  saveItems(store);
  process.exit(0);
}
process.stderr.write('secret-tool: unsupported: ' + command + '\n');
process.exit(2);
`;

async function apiFor(t: TestContext, token: string): Promise<FakeApi> {
  const api = await startFakeApi((req): RouteReply | undefined => {
    if (req.method === 'GET' && req.path === '/api/me') {
      if (bearer(req) !== token) return { status: 401, body: { error: 'bad token' } };
      return { status: 200, body: { email: 'me@example.com', scope: 'full' } };
    }
    if (req.method === 'GET' && req.path === '/api/artifacts') return { status: 200, body: { artifacts: [] } };
    return undefined;
  });
  t.after(() => api.close());
  return api;
}

function bearer(req: RecordedRequest): string | undefined {
  const value = req.headers.authorization;
  return typeof value === 'string' ? value.replace(/^Bearer /, '') : undefined;
}

// A temp folder holding the fake secret-tool, executable.
async function secretTool(): Promise<string> {
  const dir = await makeTempDir({ 'secret-tool.mjs': FAKE_SECRET_TOOL });
  const file = path.join(dir, 'secret-tool.mjs');
  await chmod(file, 0o755);
  return file;
}

async function itemsOf(bin: string): Promise<Record<string, string>> {
  const text = await readFile(path.join(path.dirname(bin), 'items.json'), 'utf8').catch(() => '{}');
  return JSON.parse(text);
}

async function callsOf(bin: string): Promise<string[][]> {
  const text = await readFile(path.join(path.dirname(bin), 'argv.log'), 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as string[]);
}

function credentialsIn(xdg: string): string {
  return path.join(xdg, 'rshow', 'credentials');
}

function modeOf(file: string): Promise<number> {
  return stat(file).then((info) => info.mode & 0o777);
}

test('the file store keeps a token in a 0600 file inside a 0700 folder', async (t) => {
  const api = await apiFor(t, TOKEN);
  const xdg = await makeTempDir({});

  const result = await runCli(
    ['login'],
    { XDG_CONFIG_HOME: xdg, RSHOW_URL: api.url, RSHOW_TOKEN_STORE: 'file' },
    { input: `${TOKEN}\n` },
  );

  assert.equal(result.stderr, '');
  assert.equal(result.code, EXIT.ok);
  const file = credentialsIn(xdg);
  assert.equal(result.stdout, `logged in as me@example.com (scope full) for ${api.url}, saved in ${file} (mode 600)\n`);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, tokens: { [api.url]: TOKEN } });
  assert.equal(await modeOf(file), 0o600);
  assert.equal(await modeOf(path.dirname(file)), 0o700);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(TOKEN));
});

test('a second login keeps the token of the first server', async (t) => {
  const one = await apiFor(t, TOKEN);
  const two = await apiFor(t, OTHER);
  const xdg = await makeTempDir({});
  const env = { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN_STORE: 'file' };

  const first = await runCli(['login', '--url', one.url], env, { input: `${TOKEN}\n` });
  assert.equal(first.code, EXIT.ok);
  const second = await runCli(['login', '--url', two.url], env, { input: `${OTHER}\n` });
  assert.equal(second.code, EXIT.ok);

  const file = credentialsIn(xdg);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
    version: 1,
    tokens: { [one.url]: TOKEN, [two.url]: OTHER },
  });

  const saved = await runCli(['list'], { ...env, RSHOW_URL: one.url });
  assert.equal(saved.code, EXIT.ok);
  assert.equal(bearer(one.requests.at(-1) as RecordedRequest), TOKEN);
});

test('a credentials file group or other can read is tightened, with one warning', async (t) => {
  const api = await apiFor(t, TOKEN);
  const xdg = await makeTempDir({
    'rshow/credentials': JSON.stringify({ version: 1, tokens: { [api.url]: TOKEN } }),
  });
  const file = credentialsIn(xdg);
  await chmod(file, 0o644);

  const result = await runCli(['list'], {
    XDG_CONFIG_HOME: xdg,
    RSHOW_URL: api.url,
    RSHOW_TOKEN_STORE: 'file',
  });

  assert.equal(result.code, EXIT.ok);
  assert.equal(result.stdout, 'no artifacts\n');
  assert.deepEqual(
    result.stderr.split('\n').filter((line) => line !== ''),
    [`rshow: warning: ${file} was readable by group or other; its mode is now 600`],
  );
  assert.equal(await modeOf(file), 0o600);
});

test('logout drops one url from the file and the file when it is empty', async (t) => {
  const one = await apiFor(t, TOKEN);
  const two = await apiFor(t, OTHER);
  const xdg = await makeTempDir({});
  const env = {
    XDG_CONFIG_HOME: xdg,
    RSHOW_TOKEN_STORE: 'file',
    RSHOW_SECURITY_BIN: NO_SECURITY,
  };
  await runCli(['login', '--url', one.url], env, { input: `${TOKEN}\n` });
  await runCli(['login', '--url', two.url], env, { input: `${OTHER}\n` });
  const file = credentialsIn(xdg);

  const first = await runCli(['logout', '--url', two.url], env);
  assert.equal(first.code, EXIT.ok);
  assert.equal(first.stdout, `logged out of ${two.url}, removed from ${file} (mode 600)\n`);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).tokens, { [one.url]: TOKEN });

  const second = await runCli(['logout', '--url', one.url], env);
  assert.equal(second.stdout, `logged out of ${one.url}, removed from ${file} (mode 600)\n`);
  await assert.rejects(stat(file), { code: 'ENOENT' });

  const third = await runCli(['logout', '--url', one.url], env);
  assert.equal(third.stdout, `no saved token for ${one.url}\n`);
});

test('the keyring store saves the token on stdin and never in argv', async (t) => {
  const api = await apiFor(t, TOKEN);
  const bin = await secretTool();
  const xdg = await makeTempDir({});
  const env = {
    XDG_CONFIG_HOME: xdg,
    RSHOW_URL: api.url,
    RSHOW_TOKEN_STORE: 'keyring',
    RSHOW_SECRET_TOOL_BIN: bin,
    RSHOW_SECURITY_BIN: NO_SECURITY,
  };

  const result = await runCli(['login'], env, { input: `${TOKEN}\n` });
  assert.equal(result.stderr, '');
  assert.equal(result.code, EXIT.ok);
  assert.equal(
    result.stdout,
    `logged in as me@example.com (scope full) for ${api.url}, saved in the Linux keyring\n`,
  );
  assert.deepEqual(await itemsOf(bin), { [api.url]: TOKEN });
  const calls = await callsOf(bin);
  for (const argv of calls) assert.doesNotMatch(argv.join(' '), new RegExp(TOKEN));
  assert.ok(
    calls.some((argv) => argv.join(' ') === `store --label rshow ${api.url} service rshow account ${api.url}`),
  );

  const doctor = await runCli(['doctor'], env);
  const line = doctor.stdout.split('\n').find((text) => text.startsWith('ok  token'));
  assert.equal(line, 'ok  token  source: keyring');

  const logout = await runCli(['logout'], env);
  assert.equal(logout.stdout, `logged out of ${api.url}, removed from the Linux keyring\n`);
  assert.deepEqual(await itemsOf(bin), {});
});

test('a keyring save that stores nothing is caught by the read-back', async (t) => {
  const api = await apiFor(t, TOKEN);
  const bin = await secretTool();
  const xdg = await makeTempDir({});

  const result = await runCli(
    ['login'],
    {
      XDG_CONFIG_HOME: xdg,
      RSHOW_URL: api.url,
      RSHOW_TOKEN_STORE: 'keyring',
      RSHOW_SECRET_TOOL_BIN: bin,
      FAKE_SECRET_TOOL_IGNORE_STORE: '1',
    },
    { input: `${TOKEN}\n` },
  );

  assert.notEqual(result.code, EXIT.ok);
  assert.doesNotMatch(result.stdout, /logged in/);
  assert.match(result.stderr, /cannot save the token in the keyring/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(TOKEN));
  assert.deepEqual(await itemsOf(bin), {});
});

test('the probe decides whether Linux has a usable keyring', async () => {
  const bin = await secretTool();
  const xdg = await makeTempDir({});
  const base = { XDG_CONFIG_HOME: xdg };

  assert.equal((await choose({ ...base, RSHOW_SECRET_TOOL_BIN: bin }, 'linux')).backend, 'keyring');
  assert.equal(
    (await choose({ ...base, RSHOW_SECRET_TOOL_BIN: bin, FAKE_SECRET_TOOL_DOWN: '1' }, 'linux')).backend,
    'file',
  );
  assert.equal(
    (await choose({ ...base, RSHOW_SECRET_TOOL_BIN: path.join(xdg, 'no-secret-tool') }, 'linux')).backend,
    'file',
  );
});

test('the store is the keychain, then the keyring, then the file, and RSHOW_TOKEN_STORE forces one', async () => {
  const bin = await secretTool();
  const xdg = await makeTempDir({});
  const base = { XDG_CONFIG_HOME: xdg };

  assert.equal((await choose(base, 'darwin')).backend, 'keychain');
  assert.equal((await choose({ ...base, RSHOW_SECURITY_BIN: '/fake/security' }, 'linux')).backend, 'keychain');
  assert.equal((await choose({ ...base, RSHOW_SECRET_TOOL_BIN: bin }, 'linux')).backend, 'keyring');
  assert.equal((await choose({ ...base, RSHOW_SECRET_TOOL_BIN: bin }, 'darwin')).backend, 'keychain');
  assert.equal((await choose(base, 'linux')).backend, 'file');
  assert.equal((await choose({ ...base, RSHOW_TOKEN_STORE: 'file' }, 'darwin')).backend, 'file');
  assert.equal(
    (await choose({ ...base, RSHOW_TOKEN_STORE: 'keyring', RSHOW_SECRET_TOOL_BIN: '/nonexistent/tool' }, 'linux'))
      .backend,
    'keyring',
  );
  await assert.rejects(choose({ ...base, RSHOW_TOKEN_STORE: 'vault' }, 'linux'), {
    name: 'UsageError',
    message: 'RSHOW_TOKEN_STORE must be keychain, keyring or file, not vault',
  });
});

test('login on Linux with no keychain and no keyring keeps the token in a 0600 file', async (t) => {
  const api = await apiFor(t, TOKEN);
  const xdg = await makeTempDir({});
  const lines: string[] = [];
  const ctx = {
    config: async () => ({ url: api.url, out: 'dist' }),
    api: async () => {
      throw new Error('login called the api');
    },
    out: {
      data: () => {},
      line: (text: string) => lines.push(text),
      raw: () => {},
    },
  } as unknown as Ctx;

  const stdin = process.stdin;
  const saved = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    HOME: process.env.HOME,
    RSHOW_SECURITY_BIN: process.env.RSHOW_SECURITY_BIN,
    RSHOW_SECRET_TOOL_BIN: process.env.RSHOW_SECRET_TOOL_BIN,
    RSHOW_TOKEN_STORE: process.env.RSHOW_TOKEN_STORE,
  };
  Object.defineProperty(process, 'stdin', {
    value: Readable.from([Buffer.from(`${TOKEN}\n`)]),
    configurable: true,
    writable: true,
  });
  process.env.XDG_CONFIG_HOME = xdg;
  process.env.HOME = xdg;
  process.env.RSHOW_SECRET_TOOL_BIN = path.join(xdg, 'no-secret-tool');
  delete process.env.RSHOW_SECURITY_BIN;
  delete process.env.RSHOW_TOKEN_STORE;
  t.after(() => {
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true, writable: true });
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  await login([], ctx, 'linux');

  const file = credentialsIn(xdg);
  assert.deepEqual(lines, [`logged in as me@example.com (scope full) for ${api.url}, saved in ${file} (mode 600)`]);
  assert.equal(await modeOf(file), 0o600);
  assert.equal(await modeOf(path.dirname(file)), 0o700);
});

test('doctor names the file the token came from', async (t) => {
  const api = await apiFor(t, TOKEN);
  const xdg = await makeTempDir({});
  const env = { XDG_CONFIG_HOME: xdg, RSHOW_TOKEN_STORE: 'file' };
  await runCli(['login'], { ...env, RSHOW_URL: api.url }, { input: `${TOKEN}\n` });

  const result = await runCli(['doctor'], { ...env, RSHOW_URL: api.url });
  const line = result.stdout.split('\n').find((text) => text.startsWith('ok  token'));
  assert.equal(line, `ok  token  source: file ${credentialsIn(xdg)}`);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(TOKEN));
});
