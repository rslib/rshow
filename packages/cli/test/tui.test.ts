import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { mapPath } from '../src/map.ts';
import { compareGrid, stripAnsi, trimTrailing } from '../src/tui.ts';
import { makeTempDir, runCli } from './helpers.ts';

function findTmux(): string | undefined {
  for (const dir of String(process.env.PATH ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    const file = path.join(dir, 'tmux');
    if (existsSync(file)) return file;
  }
  return undefined;
}

test('ansi colour is stripped unless asked for', () => {
  const raw = '\u001b[31mred\u001b[0m and \u001b[1;32mbold green\u001b[0m';
  assert.equal(stripAnsi(raw), 'red and bold green');
  assert.equal(stripAnsi('\u001b]0;a title\u0007x'), 'x');
  assert.equal(stripAnsi('plain'), 'plain');
});

test('an identical grid passes', () => {
  const result = compareGrid('one\ntwo\n', 'one\ntwo\n');
  assert.equal(result.pass, true);
  assert.equal(result.rows, 2);
  assert.deepEqual(result.differing, []);
});

test('trailing spaces on a row are not a difference', () => {
  const result = compareGrid('one   \ntwo\n', 'one\ntwo\n');
  assert.equal(result.pass, true);
});

test('differing rows are reported with both sides', () => {
  const result = compareGrid('one\ntwo\nthree\n', 'one\nTWO\nthree\n');
  assert.equal(result.pass, false);
  assert.equal(result.rows, 3);
  assert.deepEqual(result.differing, [{ row: 2, expected: 'two', actual: 'TWO' }]);
});

test('a row that only the actual has is reported', () => {
  const result = compareGrid('one\n', 'one\ntwo\n');
  assert.equal(result.pass, false);
  assert.deepEqual(result.differing, [{ row: 2, expected: '', actual: 'two' }]);
  const shorter = compareGrid('one\ntwo\n', 'one\n');
  assert.deepEqual(shorter.differing, [{ row: 2, expected: 'two', actual: '' }]);
});

test('a cell inside a row is a difference', () => {
  const result = compareGrid('name  value\n', 'name   value\n');
  assert.equal(result.pass, false);
  assert.equal(result.differing.length, 1);
});

test('trimTrailing keeps inner spaces', () => {
  assert.equal(trimTrailing('a  b  \n c \n'), 'a  b\n c\n');
});

test(
  'a tmux screen that is gone fails the compare with a usage error',
  { skip: findTmux() === undefined ? 'tmux not found' : false },
  async () => {
    const work = await makeTempDir({});
    const out = path.join(work, 'handoff-tui');
    await mkdir(path.join(out, 'baseline'), { recursive: true });
    await writeFile(
      path.join(out, 'spec.json'),
      `${JSON.stringify({
        schema: 1,
        generator: 'rshow handoff',
        createdAt: '2026-01-01T00:00:00.000Z',
        source: { slug: 'tui', version: null, url: 'local:/tmp/tui', kind: 'page', skin: '' },
        widths: [1440],
        modes: ['light'],
        primaryWidth: 1440,
        screens: [],
        baselines: [],
      })}\n`,
    );
    await writeFile(
      path.join(out, 'baseline', 'cli.txt'),
      'one\ntwo\n',
    );
    await writeFile(
      mapPath(work),
      `${JSON.stringify({ components: {}, tokens: {}, screens: { cli: 'tmux:rshow-missing:0.1' } })}\n`,
    );
    const result = await runCli(['compare', '--against', out], {}, { cwd: work });
    assert.equal(result.code, 2);
    assert.match(result.stderr, /tmux capture failed for rshow-missing:0\.1/);
  },
);
