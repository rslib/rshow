import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  COMPLETE_MARKER,
  binaryCacheDir,
  binarySkillBases,
  binaryThemeBases,
  cacheRoot,
  extractAssets,
  isBinary,
} from '../src/binary.ts';
import { VERSION } from '../src/version.ts';
import { tempDir } from './helpers.ts';

// A stand-in for the assets a single executable carries.
function bundleOf(files: Record<string, string>): { keys: string[]; read: (key: string) => Uint8Array } {
  const keys = Object.keys(files).sort();
  return {
    keys,
    read: (key: string) => {
      const text = files[key];
      assert.notEqual(text, undefined, `the bundle holds ${key}`);
      return new TextEncoder().encode(text as string);
    },
  };
}

async function listTree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listTree(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

test('the tests do not run as a single executable', async () => {
  assert.equal(await isBinary(), false);
  assert.deepEqual(await binaryThemeBases(), []);
  assert.deepEqual(await binarySkillBases(), []);
});

test('the cache root follows XDG_CACHE_HOME, then HOME, then the home folder', () => {
  assert.equal(cacheRoot({ XDG_CACHE_HOME: '/tmp/xdg', HOME: '/tmp/home' }), path.resolve('/tmp/xdg'));
  assert.equal(cacheRoot({ HOME: '/tmp/home' }), path.join('/tmp/home', '.cache'));
  assert.equal(cacheRoot({ XDG_CACHE_HOME: '' }), path.join(homedir(), '.cache'));
});

test('a version gets a folder of its own in the cache', () => {
  assert.equal(binaryCacheDir({ XDG_CACHE_HOME: '/tmp/xdg' }), path.join('/tmp/xdg', 'rshow', VERSION));
  assert.equal(
    binaryCacheDir({ XDG_CACHE_HOME: '/tmp/xdg' }, '9.9.9'),
    path.join('/tmp/xdg', 'rshow', '9.9.9'),
  );
});

test('extractAssets writes every file, the marker, and then stops', async () => {
  const root = await tempDir('rshow-binary-');
  const dir = path.join(root, 'cache', 'rshow', VERSION);
  const files = {
    'themes/default/theme.json': '{"name":"default"}\n',
    'themes/default/example/index.html': '<!doctype html>\n',
    'skills/rshow/SKILL.md': '# rshow\n',
    'worker/index.js': 'export default {}\n',
    'LICENSE': 'MIT\n',
  };
  await extractAssets(bundleOf(files), dir);

  assert.deepEqual(await listTree(dir), [...Object.keys(files), COMPLETE_MARKER].sort());
  for (const [key, text] of Object.entries(files)) {
    assert.equal(await readFile(path.join(dir, ...key.split('/')), 'utf8'), text, `${key} is written as is`);
  }
  assert.equal(await readFile(path.join(dir, COMPLETE_MARKER), 'utf8'), `${VERSION}\n`);
  // Nothing of the temporary folder is left beside the cache.
  assert.deepEqual(await readdir(path.dirname(dir)), [VERSION]);

  // The marker means "done": a second run does not write over the folder.
  await writeFile(path.join(dir, 'LICENSE'), 'changed\n');
  await extractAssets(bundleOf(files), dir);
  assert.equal(await readFile(path.join(dir, 'LICENSE'), 'utf8'), 'changed\n');
});

test('extractAssets replaces a partial folder of the same version', async () => {
  const root = await tempDir('rshow-binary-');
  const dir = path.join(root, 'rshow', VERSION);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'leftover'), 'from a run that stopped\n');

  await extractAssets(bundleOf({ 'LICENSE': 'MIT\n', 'worker/index.js': 'export default {}\n' }), dir);

  assert.deepEqual(await listTree(dir), [COMPLETE_MARKER, 'LICENSE', 'worker/index.js'].sort());
  assert.equal((await stat(path.join(dir, 'LICENSE'))).isFile(), true);
});
