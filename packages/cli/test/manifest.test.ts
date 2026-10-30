import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { buildManifest, contentTypeFor } from '../src/files.ts';
import { makeTempDir } from './helpers.ts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

test('buildManifest walks a folder, skips dotfiles and node_modules', async () => {
  const dir = await makeTempDir({
    'index.html': '<h1>hi</h1>',
    'assets/app.js': 'console.log(1)',
    'assets/site.css': 'body{}',
    'assets/data.bin': 'raw',
    '.hidden': 'nope',
    '.git/config': 'nope',
    'node_modules/pkg/index.js': 'nope',
    'nested/.env': 'nope',
  });

  const manifest = await buildManifest(dir);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.path),
    ['assets/app.js', 'assets/data.bin', 'assets/site.css', 'index.html'],
  );

  const html = manifest.files['index.html'];
  assert.equal(html?.hash, sha256('<h1>hi</h1>'));
  assert.match(html?.hash ?? '', /^[0-9a-f]{64}$/);
  assert.equal(html?.size, 11);
  assert.equal(html?.type, 'text/html; charset=utf-8');
  assert.equal(manifest.files['assets/app.js']?.type, 'text/javascript; charset=utf-8');
  assert.equal(manifest.files['assets/site.css']?.type, 'text/css; charset=utf-8');
  assert.equal(manifest.files['assets/data.bin']?.type, 'application/octet-stream');
});

test('buildManifest publishes a single file as index.html', async () => {
  const dir = await makeTempDir({ 'page.html': '<p>single</p>' });
  const manifest = await buildManifest(`${dir}/page.html`);
  assert.deepEqual(
    manifest.entries.map((entry) => entry.path),
    ['index.html'],
  );
  assert.equal(manifest.files['index.html']?.hash, sha256('<p>single</p>'));
  assert.equal(manifest.files['index.html']?.type, 'text/html; charset=utf-8');
});

test('buildManifest needs index.html in a folder', async () => {
  const dir = await makeTempDir({ 'other.html': '<p>no index</p>' });
  await assert.rejects(() => buildManifest(dir), /has no index.html/);
  await assert.rejects(() => buildManifest(`${dir}/missing.html`), /no such file or folder/);
});

test('contentTypeFor maps known extensions', () => {
  assert.equal(contentTypeFor('a.woff2'), 'font/woff2');
  assert.equal(contentTypeFor('a.WASM'), 'application/wasm');
  assert.equal(contentTypeFor('a.tar.gz'), 'application/octet-stream');
});
