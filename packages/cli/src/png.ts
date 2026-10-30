import { deflateSync, inflateSync } from 'node:zlib';

export type Image = { width: number; height: number; data: Uint8Array };

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const BIT_DEPTH = 8;

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let c = 0xffffffff;
  for (let i = from; i < to; i += 1) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

type Header = { width: number; height: number; colorType: number; channels: number };

function paeth(left: number, up: number, upLeft: number): number {
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) return left;
  if (pb <= pc) return up;
  return upLeft;
}

function unfilter(raw: Uint8Array, header: Header): Uint8Array {
  const { width, height, channels } = header;
  const stride = width * channels;
  if (raw.byteLength < (stride + 1) * height) throw new Error('truncated PNG data');
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos] as number;
    pos += 1;
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i += 1) {
      const value = raw[pos + i] as number;
      const left = i >= channels ? (out[row + i - channels] as number) : 0;
      const up = y > 0 ? (out[prev + i] as number) : 0;
      const upLeft = y > 0 && i >= channels ? (out[prev + i - channels] as number) : 0;
      let result: number;
      if (filter === 0) result = value;
      else if (filter === 1) result = value + left;
      else if (filter === 2) result = value + up;
      else if (filter === 3) result = value + ((left + up) >> 1);
      else if (filter === 4) result = value + paeth(left, up, upLeft);
      else throw new Error(`unknown PNG filter: ${filter}`);
      out[row + i] = result & 0xff;
    }
    pos += stride;
  }
  return out;
}

function toRgba(pixels: Uint8Array, header: Header, palette: Uint8Array | undefined): Uint8Array {
  const { width, height, channels, colorType } = header;
  const count = width * height;
  const out = new Uint8Array(count * 4);
  if (colorType === 6) return pixels.slice();
  if (colorType === 2) {
    for (let i = 0; i < count; i += 1) {
      out[i * 4] = pixels[i * 3] as number;
      out[i * 4 + 1] = pixels[i * 3 + 1] as number;
      out[i * 4 + 2] = pixels[i * 3 + 2] as number;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (colorType === 0) {
    for (let i = 0; i < count; i += 1) {
      const value = pixels[i] as number;
      out[i * 4] = value;
      out[i * 4 + 1] = value;
      out[i * 4 + 2] = value;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (colorType === 4) {
    for (let i = 0; i < count; i += 1) {
      const value = pixels[i * 2] as number;
      out[i * 4] = value;
      out[i * 4 + 1] = value;
      out[i * 4 + 2] = value;
      out[i * 4 + 3] = pixels[i * 2 + 1] as number;
    }
    return out;
  }
  if (palette === undefined) throw new Error('indexed PNG without a palette');
  for (let i = 0; i < count; i += 1) {
    const index = (pixels[i] as number) * 3;
    out[i * 4] = palette[index] ?? 0;
    out[i * 4 + 1] = palette[index + 1] ?? 0;
    out[i * 4 + 2] = palette[index + 2] ?? 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function decodePng(bytes: Uint8Array): Image {
  if (bytes.byteLength < SIGNATURE.length + 8) throw new Error('not a PNG: too short');
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('not a PNG: bad signature');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = SIGNATURE.length;
  let header: Header | undefined;
  let palette: Uint8Array | undefined;
  const data: Uint8Array[] = [];

  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] as number,
      bytes[offset + 5] as number,
      bytes[offset + 6] as number,
      bytes[offset + 7] as number,
    );
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.byteLength) throw new Error(`truncated PNG chunk: ${type}`);
    if (type === 'IHDR') {
      const width = view.getUint32(start);
      const height = view.getUint32(start + 4);
      const depth = bytes[start + 8] as number;
      const colorType = bytes[start + 9] as number;
      const interlace = bytes[start + 12] as number;
      const channels = CHANNELS[colorType];
      if (depth !== BIT_DEPTH) throw new Error(`unsupported PNG bit depth: ${depth}`);
      if (channels === undefined) throw new Error(`unsupported PNG color type: ${colorType}`);
      if (interlace !== 0) throw new Error('unsupported PNG: interlaced');
      header = { width, height, colorType, channels };
    } else if (type === 'PLTE') {
      palette = bytes.subarray(start, end);
    } else if (type === 'IDAT') {
      data.push(bytes.subarray(start, end));
    } else if (type === 'IEND') {
      break;
    }
    offset = end + 4;
  }

  if (header === undefined) throw new Error('PNG without IHDR');
  if (data.length === 0) throw new Error('PNG without IDAT');
  const raw = new Uint8Array(inflateSync(Buffer.concat(data.map((part) => Buffer.from(part)))));
  return { width: header.width, height: header.height, data: toRgba(unfilter(raw, header), header, palette) };
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.byteLength);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.byteLength, crc32(out, 4, 8 + body.byteLength));
  return out;
}

export function encodePng(image: Image): Uint8Array {
  const stride = image.width * 4;
  const raw = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const from = y * stride;
    const to = y * (stride + 1);
    raw[to] = 0;
    raw.set(image.data.subarray(from, from + stride), to + 1);
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, image.width);
  header.setUint32(4, image.height);
  ihdr[8] = BIT_DEPTH;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(raw), { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export type ScaleFilter = 'nearest' | 'box';

export function cropImage(image: Image, width: number, height: number): Image {
  const outWidth = Math.max(1, Math.min(image.width, Math.round(width)));
  const outHeight = Math.max(1, Math.min(image.height, Math.round(height)));
  if (outWidth === image.width && outHeight === image.height) return image;
  const data = new Uint8Array(outWidth * outHeight * 4);
  for (let y = 0; y < outHeight; y += 1) {
    const from = y * image.width * 4;
    data.set(image.data.subarray(from, from + outWidth * 4), y * outWidth * 4);
  }
  return { width: outWidth, height: outHeight, data };
}

// A Retina capture is exactly twice the baseline side, so the box filter averages
// each 2x2 source block into one pixel.
export function scaleImage(image: Image, width: number, height: number, filter: ScaleFilter = 'box'): Image {
  const outWidth = Math.max(1, Math.round(width));
  const outHeight = Math.max(1, Math.round(height));
  if (outWidth === image.width && outHeight === image.height) return image;
  const data = new Uint8Array(outWidth * outHeight * 4);
  const stepX = image.width / outWidth;
  const stepY = image.height / outHeight;
  const nearestX = (x: number): number => Math.min(image.width - 1, Math.floor(x * stepX + stepX / 2));
  const nearestY = (y: number): number => Math.min(image.height - 1, Math.floor(y * stepY + stepY / 2));

  for (let y = 0; y < outHeight; y += 1) {
    const top = y * stepY;
    const bottom = top + stepY;
    for (let x = 0; x < outWidth; x += 1) {
      const pos = (y * outWidth + x) * 4;
      if (filter === 'nearest') {
        const from = (nearestY(y) * image.width + nearestX(x)) * 4;
        data[pos] = image.data[from] as number;
        data[pos + 1] = image.data[from + 1] as number;
        data[pos + 2] = image.data[from + 2] as number;
        data[pos + 3] = image.data[from + 3] as number;
        continue;
      }
      const left = x * stepX;
      const right = left + stepX;
      let weight = 0;
      let alphaSum = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = Math.max(0, Math.floor(top)); sy < Math.min(image.height, Math.ceil(bottom)); sy += 1) {
        const weightY = Math.min(bottom, sy + 1) - Math.max(top, sy);
        if (weightY <= 0) continue;
        for (let sx = Math.max(0, Math.floor(left)); sx < Math.min(image.width, Math.ceil(right)); sx += 1) {
          const weightX = Math.min(right, sx + 1) - Math.max(left, sx);
          if (weightX <= 0) continue;
          const area = weightX * weightY;
          const from = (sy * image.width + sx) * 4;
          const alpha = image.data[from + 3] as number;
          weight += area;
          alphaSum += alpha * area;
          red += (image.data[from] as number) * alpha * area;
          green += (image.data[from + 1] as number) * alpha * area;
          blue += (image.data[from + 2] as number) * alpha * area;
        }
      }
      if (weight === 0) {
        const from = (nearestY(y) * image.width + nearestX(x)) * 4;
        data[pos] = image.data[from] as number;
        data[pos + 1] = image.data[from + 1] as number;
        data[pos + 2] = image.data[from + 2] as number;
        data[pos + 3] = image.data[from + 3] as number;
        continue;
      }
      data[pos + 3] = Math.round(alphaSum / weight);
      if (alphaSum > 0) {
        data[pos] = Math.round(red / alphaSum);
        data[pos + 1] = Math.round(green / alphaSum);
        data[pos + 2] = Math.round(blue / alphaSum);
      }
    }
  }
  return { width: outWidth, height: outHeight, data };
}

export function scaleToWidth(image: Image, width: number, filter: ScaleFilter = 'box'): Image {
  const target = Math.max(1, Math.round(width));
  if (target === image.width) return image;
  const height = Math.max(1, Math.round((image.height * target) / image.width));
  return scaleImage(image, target, height, filter);
}

export function blankImage(width: number, height: number, rgba: [number, number, number, number]): Image {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return { width, height, data };
}
