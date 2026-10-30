export type Rgba = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = {
  transparent: 'rgba(0,0,0,0)',
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexOf(value: string): Rgba | undefined {
  const hex = value.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) return undefined;
  const digits =
    hex.length === 3 || hex.length === 4 ? hex.split('').map((char) => char + char).join('') : hex;
  if (digits.length !== 6 && digits.length !== 8) return undefined;
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
    a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) : 255,
  };
}

function channel(token: string): number {
  const value = token.trim();
  if (value.endsWith('%')) return (Number(value.slice(0, -1)) / 100) * 255;
  return Number(value);
}

function alphaOf(token: string | undefined): number {
  if (token === undefined || token === '') return 255;
  const value = token.trim();
  if (value.endsWith('%')) return (Number(value.slice(0, -1)) / 100) * 255;
  const number = Number(value);
  if (!Number.isFinite(number)) return 255;
  return number <= 1 ? number * 255 : number;
}

function parts(raw: string): string[] {
  return raw
    .replace(/^[a-z-]+\(/i, '')
    .replace(/\)\s*$/, '')
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part !== '');
}

function hslToRgba(h: number, s: number, l: number, a: number): Rgba {
  const hue = (((h % 360) + 360) % 360) / 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  if (sat === 0) {
    const value = Math.round(light * 255);
    return { r: value, g: value, b: value, a };
  }
  const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
  const p = 2 * light - q;
  const channelOf = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return {
    r: Math.round(channelOf(hue + 1 / 3) * 255),
    g: Math.round(channelOf(hue) * 255),
    b: Math.round(channelOf(hue - 1 / 3) * 255),
    a,
  };
}

export function parseColor(raw: string): Rgba | undefined {
  const text = raw.trim().toLowerCase();
  if (text === '') return undefined;
  const named = NAMED[text];
  if (named !== undefined) return parseColor(named);
  if (text.startsWith('#')) return hexOf(text);
  if (text.startsWith('rgb')) {
    const list = parts(text);
    if (list.length < 3) return undefined;
    const r = channel(list[0] as string);
    const g = channel(list[1] as string);
    const b = channel(list[2] as string);
    if (![r, g, b].every((value) => Number.isFinite(value))) return undefined;
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a: Math.round(alphaOf(list[3])) };
  }
  if (text.startsWith('hsl')) {
    const list = parts(text);
    if (list.length < 3) return undefined;
    const h = Number((list[0] as string).replace(/deg$/, ''));
    const s = Number((list[1] as string).replace(/%$/, ''));
    const l = Number((list[2] as string).replace(/%$/, ''));
    if (![h, s, l].every((value) => Number.isFinite(value))) return undefined;
    return hslToRgba(h, s, l, Math.round(alphaOf(list[3])));
  }
  return undefined;
}

export function formatColor(color: Rgba): string {
  if (color.a >= 255) return `rgb(${color.r}, ${color.g}, ${color.b})`;
  const alpha = Math.round((color.a / 255) * 1000) / 1000;
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

export function sameColor(left: Rgba, right: Rgba): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a;
}

export function colorDistance(left: Rgba, right: Rgba): number {
  const dr = (left.r - right.r) / 255;
  const dg = (left.g - right.g) / 255;
  const db = (left.b - right.b) / 255;
  const da = (left.a - right.a) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da);
}

const UNIT_PX: Record<string, number> = {
  px: 1,
  rem: 16,
  em: 16,
  pt: 1.3333,
};

export function parsePx(raw: string): number | undefined {
  const text = raw.trim().toLowerCase();
  if (text === '') return undefined;
  if (/^-?[0-9.]+$/.test(text)) return Number(text);
  const match = /^(-?[0-9.]+)(px|rem|em|pt)$/.exec(text);
  if (match === null) return undefined;
  const size = Number(match[1]);
  const scale = UNIT_PX[match[2] as string];
  if (scale === undefined || !Number.isFinite(size)) return undefined;
  return Math.round(size * scale * 1000) / 1000;
}
