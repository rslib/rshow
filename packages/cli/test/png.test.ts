import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { blankImage, decodePng, encodePng } from '../src/png.ts';
import type { Image } from '../src/png.ts';

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function filtered(rows: Uint8Array[], channels: number, filter: number): Buffer {
  const stride = (rows[0] as Uint8Array).length;
  const out = Buffer.alloc((stride + 1) * rows.length);
  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y] as Uint8Array;
    const previous = y > 0 ? (rows[y - 1] as Uint8Array) : new Uint8Array(stride);
    const at = y * (stride + 1);
    out[at] = filter;
    for (let i = 0; i < stride; i += 1) {
      const value = row[i] as number;
      const left = i >= channels ? (row[i - channels] as number) : 0;
      const up = previous[i] as number;
      const upLeft = i >= channels ? (previous[i - channels] as number) : 0;
      let encoded = value;
      if (filter === 1) encoded = value - left;
      else if (filter === 2) encoded = value - up;
      else if (filter === 3) encoded = value - ((left + up) >> 1);
      else if (filter === 4) encoded = value - paeth(left, up, upLeft);
      out[at + 1 + i] = encoded & 0xff;
    }
  }
  return out;
}

function buildPng(width: number, height: number, colorType: number, filter: number, rows: Uint8Array[]): Uint8Array {
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Uint8Array(
    Buffer.concat([
      signature,
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(filtered(rows, channels, filter))),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

test('png round trip keeps every pixel', () => {
  const image: Image = { width: 3, height: 2, data: new Uint8Array(3 * 2 * 4) };
  for (let index = 0; index < 6; index += 1) {
    image.data[index * 4] = index * 20;
    image.data[index * 4 + 1] = 255 - index * 20;
    image.data[index * 4 + 2] = index * 7;
    image.data[index * 4 + 3] = index === 5 ? 128 : 255;
  }
  const decoded = decodePng(encodePng(image));
  assert.equal(decoded.width, 3);
  assert.equal(decoded.height, 2);
  assert.deepEqual([...decoded.data], [...image.data]);
});

test('png decodes every filter type', () => {
  const rows = [
    Uint8Array.from([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]),
    Uint8Array.from([11, 21, 31, 255, 41, 51, 61, 255, 71, 81, 91, 255]),
    Uint8Array.from([12, 22, 32, 255, 42, 52, 62, 255, 72, 82, 92, 255]),
  ];
  for (const filter of [0, 1, 2, 3, 4]) {
    const decoded = decodePng(buildPng(3, 3, 6, filter, rows));
    assert.equal(decoded.width, 3);
    assert.deepEqual(
      [...decoded.data],
      [...(rows[0] as Uint8Array), ...(rows[1] as Uint8Array), ...(rows[2] as Uint8Array)],
      `filter ${filter}`,
    );
  }
});

test('png decodes rgb and grey and adds opaque alpha', () => {
  const rgb = decodePng(buildPng(2, 1, 2, 0, [Uint8Array.from([1, 2, 3, 4, 5, 6])]));
  assert.deepEqual([...rgb.data], [1, 2, 3, 255, 4, 5, 6, 255]);

  const grey = decodePng(buildPng(2, 1, 0, 0, [Uint8Array.from([9, 200])]));
  assert.deepEqual([...grey.data], [9, 9, 9, 255, 200, 200, 200, 255]);
});

test('png decode rejects a file that is not a png', () => {
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /not a PNG/);
});

test('blank image fills one colour', () => {
  const image = blankImage(2, 2, [1, 2, 3, 4]);
  assert.equal(image.data.length, 16);
  assert.deepEqual([...image.data.subarray(0, 4)], [1, 2, 3, 4]);
  assert.deepEqual([...image.data.subarray(12)], [1, 2, 3, 4]);
});
