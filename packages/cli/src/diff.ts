import type { Image } from './png.ts';

export type DiffOptions = { threshold?: number; includeAA?: boolean };

export type DiffResult = { diff: number; total: number; ratio: number; image: Image };

const MAX_Y = 35215;
const DIFF_COLOR: [number, number, number] = [255, 0, 0];
const AA_COLOR: [number, number, number] = [255, 255, 0];

// The per-pixel comparison below follows pixelmatch (ISC license, mapbox/pixelmatch).
function blend(value: number, alpha: number): number {
  return 255 + (value - 255) * alpha;
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
}

function chromaI(red: number, green: number, blue: number): number {
  return red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
}

function chromaQ(red: number, green: number, blue: number): number {
  return red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
}

function deltaAt(left: Uint8Array, right: Uint8Array, a: number, b: number, yOnly: boolean): number {
  let r1 = left[a] as number;
  let g1 = left[a + 1] as number;
  let b1 = left[a + 2] as number;
  let a1 = left[a + 3] as number;
  const r2 = right[b] as number;
  const g2 = right[b + 1] as number;
  const b2 = right[b + 2] as number;
  const a2 = right[b + 3] as number;
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  if (a1 < 255) {
    const alpha = a1 / 255;
    r1 = blend(r1, alpha);
    g1 = blend(g1, alpha);
    b1 = blend(b1, alpha);
  }
  const r2b = a2 < 255 ? blend(r2, a2 / 255) : r2;
  const g2b = a2 < 255 ? blend(g2, a2 / 255) : g2;
  const b2b = a2 < 255 ? blend(b2, a2 / 255) : b2;
  const y1 = luma(r1, g1, b1);
  const y2 = luma(r2b, g2b, b2b);
  const y = y1 - y2;
  if (yOnly) return y;
  const i = chromaI(r1, g1, b1) - chromaI(r2b, g2b, b2b);
  const q = chromaQ(r1, g1, b1) - chromaQ(r2b, g2b, b2b);
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  return y1 > y2 ? -delta : delta;
}

function hasManySiblings(image: Image, x: number, y: number): boolean {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, image.width - 1);
  const y2 = Math.min(y + 1, image.height - 1);
  const pos = (y * image.width + x) * 4;
  let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
  for (let nx = x0; nx <= x2; nx += 1) {
    for (let ny = y0; ny <= y2; ny += 1) {
      if (nx === x && ny === y) continue;
      if (deltaAt(image.data, image.data, pos, (ny * image.width + nx) * 4, true) === 0) {
        zeroes += 1;
        if (zeroes > 2) return true;
      }
    }
  }
  return false;
}

function antialiased(image: Image, other: Image, x: number, y: number): boolean {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, image.width - 1);
  const y2 = Math.min(y + 1, image.height - 1);
  const pos = (y * image.width + x) * 4;
  let zeroes = x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0;
  let min = 0;
  let max = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (let nx = x0; nx <= x2; nx += 1) {
    for (let ny = y0; ny <= y2; ny += 1) {
      if (nx === x && ny === y) continue;
      const delta = deltaAt(image.data, image.data, pos, (ny * image.width + nx) * 4, true);
      if (delta === 0) {
        zeroes += 1;
        if (zeroes > 2) return false;
      } else if (delta < min) {
        min = delta;
        minX = nx;
        minY = ny;
      } else if (delta > max) {
        max = delta;
        maxX = nx;
        maxY = ny;
      }
    }
  }
  if (min === 0 || max === 0) return false;
  const minOk = hasManySiblings(image, minX, minY) && hasManySiblings(other, minX, minY);
  const maxOk = hasManySiblings(image, maxX, maxY) && hasManySiblings(other, maxX, maxY);
  return minOk || maxOk;
}

export function padImage(image: Image, width: number, height: number): Image {
  if (image.width === width && image.height === height) return image;
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  for (let y = 0; y < image.height; y += 1) {
    const from = y * image.width * 4;
    data.set(image.data.subarray(from, from + image.width * 4), y * width * 4);
  }
  return { width, height, data };
}

function paint(image: Image, pos: number, rgb: [number, number, number]): void {
  image.data[pos] = rgb[0];
  image.data[pos + 1] = rgb[1];
  image.data[pos + 2] = rgb[2];
  image.data[pos + 3] = 255;
}

function gray(image: Image, pos: number): void {
  const alpha = (image.data[pos + 3] as number) / 255;
  const value = Math.round(
    luma(
      blend(image.data[pos] as number, alpha),
      blend(image.data[pos + 1] as number, alpha),
      blend(image.data[pos + 2] as number, alpha),
    ) * 0.1,
  );
  paint(image, pos, [value, value, value]);
}

export function diffImages(before: Image, after: Image, opts: DiffOptions = {}): DiffResult {
  const threshold = opts.threshold ?? 0.1;
  const width = Math.max(before.width, after.width);
  const height = Math.max(before.height, after.height);
  const left = padImage(before, width, height);
  const right = padImage(after, width, height);
  const image: Image = { width, height, data: new Uint8Array(left.data) };

  const maxDelta = MAX_Y * threshold * threshold;
  let diff = 0;
  for (let y = 0; y < left.height; y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const pos = (y * left.width + x) * 4;
      const delta = deltaAt(left.data, right.data, pos, pos, false);
      if (Math.abs(delta) > maxDelta) {
        const soft =
          opts.includeAA === true
            ? false
            : antialiased(left, right, x, y) || antialiased(right, left, x, y);
        if (soft) paint(image, pos, AA_COLOR);
        else {
          paint(image, pos, DIFF_COLOR);
          diff += 1;
        }
      } else {
        gray(image, pos);
      }
    }
  }

  const total = left.width * left.height;
  return { diff, total, ratio: total === 0 ? 0 : diff / total, image };
}
