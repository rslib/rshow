import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parsePullTarget } from '../src/commands/pull.ts';
import { artifact, runCli, startFakeApi } from './helpers.ts';
import type { RecordedRequest, RouteReply } from './helpers.ts';

const FILES: Record<string, string> = {
  'index.html': '<!doctype html><title>t</title>',
  'assets/a b.css': 'body { color: red; }',
  '..notes.txt': 'a name that only starts with two dots',
};

function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function manifest(files: Record<string, string>): Record<string, { hash: string; size: number; type: string }> {
  const out: Record<string, { hash: string; size: number; type: string }> = {};
  for (const [name, body] of Object.entries(files)) {
    out[name] = { hash: hashOf(body), size: Buffer.byteLength(body), type: 'text/plain' };
  }
  return out;
}

function pullRouter(slug: string, served: number, files: Record<string, string>, bodies = files) {
  return (req: RecordedRequest): RouteReply | undefined => {
    if (req.path === `/api/artifacts/${slug}`) return { status: 200, body: artifact(slug, { served }) };
    const versions = `/api/artifacts/${slug}/versions/`;
    if (!req.path.startsWith(versions)) return undefined;
    const rest = req.path.slice(versions.length);
    const match = /^([0-9]+)(?:\/files\/(.+))?$/.exec(rest);
    if (match === null) return undefined;
    if (match[2] === undefined) return { status: 200, body: { n: Number(match[1]), files: manifest(files) } };
    const name = match[2].split('/').map(decodeURIComponent).join('/');
    const body = bodies[name];
    return body === undefined ? undefined : { status: 200, text: body };
  };
}

async function emptyDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), 'rshow-pull-'));
}

test('parsePullTarget reads a slug and an optional version', () => {
  assert.deepEqual(parsePullTarget('site'), { slug: 'site', version: null });
  assert.deepEqual(parsePullTarget('site@v12'), { slug: 'site', version: 12 });
  assert.throws(() => parsePullTarget('site@v0'), /invalid version/);
  assert.throws(() => parsePullTarget('Bad Slug'), /invalid slug/);
});

test('pull writes the served version into a folder', async (t) => {
  const api = await startFakeApi(pullRouter('site', 3, FILES));
  t.after(() => api.close());
  const dir = path.join(await emptyDir(), 'out');

  const result = await runCli(['pull', 'site', dir], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });

  assert.equal(result.stderr, '');
  assert.equal(result.code, 0);
  assert.equal(await readFile(path.join(dir, 'index.html'), 'utf8'), FILES['index.html']);
  assert.equal(await readFile(path.join(dir, 'assets', 'a b.css'), 'utf8'), FILES['assets/a b.css']);
  assert.match(result.stdout, /^version: 3$/m);
  assert.match(result.stdout, /^files: 3$/m);
  assert.equal(await readFile(path.join(dir, '..notes.txt'), "utf8"), FILES['..notes.txt']);
  assert.match(result.stdout, /publish back: rshow publish .* --slug site/);
  assert.ok(api.requests.some((req) => req.path === '/api/artifacts/site/versions/3/files/assets/a%20b.css'));
  assert.ok(api.requests.every((req) => req.headers.authorization === 'Bearer rsh_secret'));
});

test('pull takes an explicit version and skips the artifact lookup', async (t) => {
  const api = await startFakeApi(pullRouter('site', 3, FILES));
  t.after(() => api.close());
  const dir = path.join(await emptyDir(), 'out');

  const result = await runCli(['pull', 'site@v2', dir], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^version: 2$/m);
  assert.ok(!api.requests.some((req) => req.path === '/api/artifacts/site'));
});

test('pull refuses a folder that is not empty unless forced', async (t) => {
  const api = await startFakeApi(pullRouter('site', 1, FILES));
  t.after(() => api.close());
  const dir = await emptyDir();
  await writeFile(path.join(dir, 'keep.txt'), 'mine');
  const env = { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' };

  const refused = await runCli(['pull', 'site', dir], env);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /is not empty/);
  assert.equal(api.requests.length, 0);

  const forced = await runCli(['pull', 'site', dir, '--force'], env);
  assert.equal(forced.code, 0, forced.stderr);
  assert.equal(await readFile(path.join(dir, 'keep.txt'), 'utf8'), 'mine');
  assert.equal(await readFile(path.join(dir, 'index.html'), 'utf8'), FILES['index.html']);
});

test('pull fails when the bytes do not match the hash', async (t) => {
  const api = await startFakeApi(pullRouter('site', 1, FILES, { ...FILES, 'index.html': 'tampered' }));
  t.after(() => api.close());
  const dir = path.join(await emptyDir(), 'out');

  const result = await runCli(['pull', 'site', dir], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /index\.html: the bytes do not match the manifest hash/);
});

test('pull refuses a manifest path that leaves the folder', async (t) => {
  const api = await startFakeApi(pullRouter('site', 1, { '../evil.txt': 'x' }));
  t.after(() => api.close());
  const root = await emptyDir();
  const dir = path.join(root, 'out');

  const result = await runCli(['pull', 'site', dir], { RSHOW_URL: api.url, RSHOW_TOKEN: 'rsh_secret' });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsafe path/);
  await assert.rejects(readFile(path.join(root, 'evil.txt')));
});
