import assert from 'node:assert/strict';
import test from 'node:test';
import { diffImages, padImage } from '../src/diff.ts';
import { blankImage } from '../src/png.ts';

test('identical images have no differing pixel', () => {
  const left = blankImage(8, 8, [255, 255, 255, 255]);
  const result = diffImages(left, blankImage(8, 8, [255, 255, 255, 255]));
  assert.equal(result.diff, 0);
  assert.equal(result.ratio, 0);
  assert.equal(result.image.width, 8);
});

test('a changed block is counted and painted red', () => {
  const left = blankImage(10, 10, [255, 255, 255, 255]);
  const right = blankImage(10, 10, [255, 255, 255, 255]);
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      const pos = (y * 10 + x) * 4;
      right.data[pos] = 0;
      right.data[pos + 1] = 0;
      right.data[pos + 2] = 0;
    }
  }
  const result = diffImages(left, right);
  assert.equal(result.total, 100);
  assert.ok(result.diff >= 4, `diff was ${result.diff}`);
  assert.ok(result.ratio > 0.03 && result.ratio <= 0.06, `ratio was ${result.ratio}`);
  assert.deepEqual([...result.image.data.subarray(0, 3)], [255, 0, 0]);
});

test('a small colour step under the threshold is ignored', () => {
  const left = blankImage(4, 4, [100, 100, 100, 255]);
  const right = blankImage(4, 4, [102, 102, 102, 255]);
  const result = diffImages(left, right, { threshold: 0.1 });
  assert.equal(result.diff, 0);
  const strict = diffImages(left, right, { threshold: 0 });
  assert.ok(strict.diff > 0);
});

test('images of different sizes are padded to the bigger canvas', () => {
  const left = blankImage(4, 3, [255, 255, 255, 255]);
  const right = blankImage(4, 5, [255, 255, 255, 255]);
  const result = diffImages(left, right);
  assert.equal(result.image.width, 4);
  assert.equal(result.image.height, 5);
  assert.equal(result.total, 20);
  assert.ok(result.diff >= 8, `diff was ${result.diff}`);

  const padded = padImage(left, 4, 5);
  assert.equal(padded.height, 5);
  assert.deepEqual([...padded.data.subarray(0, 4)], [255, 255, 255, 255]);
  assert.deepEqual([...padded.data.subarray(4 * 3 * 4, 4 * 3 * 4 + 4)], [255, 0, 255, 255]);
});

test('a two pixel line is not swallowed by the antialiasing rule', () => {
  const left = blankImage(20, 20, [255, 255, 255, 255]);
  const right = blankImage(20, 20, [255, 255, 255, 255]);
  for (let x = 5; x < 15; x += 1) {
    const pos = (10 * 20 + x) * 4;
    right.data[pos] = 0;
    right.data[pos + 1] = 0;
    right.data[pos + 2] = 0;
  }
  const result = diffImages(left, right);
  assert.ok(result.diff >= 8, `diff was ${result.diff}`);
});
