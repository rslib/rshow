import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.ts';
import { runCli, startFakeApi } from './helpers.ts';

const CLI_DIR = fileURLToPath(new URL('..', import.meta.url));
const ROOT = path.resolve(CLI_DIR, '..', '..');

const WORKSPACES = [
  path.join(ROOT, 'package.json'),
  path.join(CLI_DIR, 'package.json'),
  path.join(ROOT, 'packages', 'shared', 'package.json'),
  path.join(ROOT, 'packages', 'worker', 'package.json'),
];

async function versionOf(file: string): Promise<string> {
  const body = JSON.parse(await readFile(file, 'utf8')) as { version?: unknown };
  assert.equal(typeof body.version, 'string', `${file} has a version`);
  return body.version as string;
}

test('every workspace package shares the version of packages/cli', async () => {
  const expected = await versionOf(path.join(CLI_DIR, 'package.json'));
  for (const file of WORKSPACES) {
    assert.equal(await versionOf(file), expected, `${path.relative(ROOT, file)} matches packages/cli`);
  }
});

test('running from src reads that same version', async () => {
  assert.equal(VERSION, await versionOf(path.join(CLI_DIR, 'package.json')));
});

test('--version and -v print rshow and the version', async () => {
  for (const flag of ['--version', '-v']) {
    const result = await runCli([flag]);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, `rshow ${VERSION}\n`);
  }
});

test('requests name the CLI in their user agent', async (t) => {
  const api = await startFakeApi((req) => (req.path === '/api/artifacts' ? { status: 200, body: { artifacts: [] } } : undefined));
  t.after(() => api.close());

  const result = await runCli(['list'], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });
  assert.equal(result.code, 0);
  assert.equal(api.requests[0]?.headers['user-agent'], `rshow/${VERSION}`);
});
