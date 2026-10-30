import { spawn } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { formatColor, parseColor } from './color.ts';
import type { Rgba } from './color.ts';
import { UsageError } from './exit.ts';
import type { Image } from './png.ts';
import type { ScreenSpec } from './spec.ts';
import { matchTokenColor, tokenIndex, tokenValueOf } from './tokens.ts';
import type { TokenSets } from './tokens.ts';

export type CaptureSource =
  | { kind: 'url'; url: string }
  | { kind: 'tmux'; target: string }
  | { kind: 'file'; file: string }
  | { kind: 'window'; title: string };

export type NativeSource = Extract<CaptureSource, { kind: 'file' } | { kind: 'window' }>;

const FILE_PREFIX = 'file:';
const WINDOW_PREFIX = 'window:';
const TMUX_PREFIX = 'tmux:';
export const NATIVE_HINT = 'take a screenshot and use file:<path.png> in map.screens instead';

export function parseCaptureSource(raw: string): CaptureSource {
  const value = raw.trim();
  if (value.startsWith(TMUX_PREFIX)) {
    const target = value.slice(TMUX_PREFIX.length).trim();
    if (target === '') throw new UsageError(`${TMUX_PREFIX} needs a target, got: ${raw}`);
    return { kind: 'tmux', target };
  }
  if (value.startsWith(FILE_PREFIX)) {
    const file = value.slice(FILE_PREFIX.length).trim();
    if (file === '') throw new UsageError(`${FILE_PREFIX} needs a screenshot path, got: ${raw}`);
    return { kind: 'file', file };
  }
  if (value.startsWith(WINDOW_PREFIX)) {
    const title = value.slice(WINDOW_PREFIX.length).trim();
    if (title === '') throw new UsageError(`${WINDOW_PREFIX} needs an owner name or a window title, got: ${raw}`);
    return { kind: 'window', title };
  }
  return { kind: 'url', url: value };
}

export function isNative(source: CaptureSource): source is NativeSource {
  return source.kind === 'file' || source.kind === 'window';
}

export async function captureNative(source: NativeSource, mapDir: string, deps: CaptureDeps = {}): Promise<Uint8Array> {
  if (source.kind === 'file') {
    const file = path.resolve(mapDir, source.file);
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      throw new UsageError(`no screenshot at ${source.file}, which is relative to rshow.map.json`);
    }
  }
  return captureWindow(source.title, deps);
}

export type NativeRunner = { run: (bin: string, args: readonly string[]) => Promise<string> };
export type CaptureDeps = { platform?: string; runner?: NativeRunner };

export const WINDOW_LIST_SCRIPT = `ObjC.import('CoreGraphics');
function run() {
  const windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID)) || [];
  const lines = [];
  for (const item of windows) {
    const id = item['kCGWindowNumber'];
    if (typeof id !== 'number') continue;
    const owner = String(item['kCGWindowOwnerName'] || '');
    const title = String(item['kCGWindowName'] || '');
    lines.push([id, owner, title.replace(/[\\t\\n]/g, ' ')].join('\\t'));
  }
  return lines.join('\\n');
}`;

export type WindowInfo = { id: number; owner: string; title: string };

export function parseWindowList(text: string): WindowInfo[] {
  const out: WindowInfo[] = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split('\t');
    const id = Number(parts[0]);
    if (parts[0] === undefined || !Number.isInteger(id) || id <= 0) continue;
    out.push({ id, owner: parts[1] ?? '', title: parts[2] ?? '' });
  }
  return out;
}

export function pickWindowId(list: readonly WindowInfo[], wanted: string): number | undefined {
  const want = wanted.trim().toLowerCase();
  if (want === '') return undefined;
  const exactOwner = list.find((item) => item.owner.toLowerCase() === want);
  if (exactOwner !== undefined) return exactOwner.id;
  const exactTitle = list.find((item) => item.title.toLowerCase() === want);
  if (exactTitle !== undefined) return exactTitle.id;
  const title = list.find((item) => item.title.toLowerCase().includes(want));
  if (title !== undefined) return title.id;
  const owner = list.find((item) => item.owner.toLowerCase().includes(want));
  return owner?.id;
}

function noWindow(title: string, seen: readonly WindowInfo[]): UsageError {
  const names = [...new Set(seen.map((item) => item.owner).filter((name) => name !== ''))].slice(0, 8);
  const list = names.length === 0 ? 'no window was listed' : `on screen: ${names.join(', ')}`;
  return new UsageError(`no window matches ${JSON.stringify(title)} (${list}); use ${WINDOW_PREFIX} with an owner name or a title, or ${NATIVE_HINT}`);
}

const systemRunner: NativeRunner = {
  run: (bin, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', (err) => reject(new UsageError(`cannot run ${bin}: ${err.message}`)));
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new UsageError(stderr.trim() === '' ? `${bin} exited ${code}` : `${bin}: ${stderr.trim()}`));
          return;
        }
        resolve(stdout);
      });
    }),
};

export async function captureWindow(title: string, deps: CaptureDeps = {}): Promise<Uint8Array> {
  const platform = deps.platform ?? process.platform;
  const runner = deps.runner ?? systemRunner;
  const scratch = path.join(tmpdir(), `rshow-window-${process.pid}-${Date.now()}.png`);
  const wrap = (err: unknown): UsageError =>
    err instanceof UsageError
      ? err
      : new UsageError(`window: ${title}: ${err instanceof Error ? err.message : String(err)}; ${NATIVE_HINT}`);
  try {
    if (platform === 'darwin') {
      const list = parseWindowList(await runner.run('osascript', ['-l', 'JavaScript', '-e', WINDOW_LIST_SCRIPT]));
      const id = pickWindowId(list, title);
      if (id === undefined) throw noWindow(title, list);
      await runner.run('screencapture', ['-x', '-o', '-l', String(id), '-t', 'png', scratch]);
    } else if (platform === 'linux') {
      const ids = (await runner.run('xdotool', ['search', '--name', title]))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
      const id = ids[ids.length - 1];
      if (id === undefined) throw noWindow(title, []);
      await runner.run('import', ['-window', id, `png:${scratch}`]);
    } else {
      throw new UsageError(`window: capture is not supported on ${platform}; ${NATIVE_HINT}`);
    }
    return new Uint8Array(await readFile(scratch));
  } catch (err) {
    throw wrap(err);
  } finally {
    await unlink(scratch).catch(() => {});
  }
}

export type Swatch = { color: Rgba; area: number };

const BITS = 5;
const BIN_SHIFT = 8 - BITS;
const SAMPLE_TARGET = 240000;
const ROUNDS = 8;

type Bin = { count: number; r: number; g: number; b: number };
type Center = { r: number; g: number; b: number };

function squared(left: Center, right: Center): number {
  return (left.r - right.r) ** 2 + (left.g - right.g) ** 2 + (left.b - right.b) ** 2;
}

function nearestCenter(centers: readonly Center[], color: Center): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centers.length; index += 1) {
    const value = squared(centers[index] as Center, color);
    if (value < distance) {
      best = index;
      distance = value;
    }
  }
  return best;
}

export function extractPalette(image: Image, k = 8): Swatch[] {
  const total = image.width * image.height;
  if (total === 0 || k < 1) return [];
  const stride = Math.max(1, Math.ceil(Math.sqrt(total / SAMPLE_TARGET)));
  const bins = new Map<number, Bin>();
  let used = 0;
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const pos = (y * image.width + x) * 4;
      if ((image.data[pos + 3] as number) < 8) continue;
      const r = image.data[pos] as number;
      const g = image.data[pos + 1] as number;
      const b = image.data[pos + 2] as number;
      const key = ((r >> BIN_SHIFT) << (BITS * 2)) | ((g >> BIN_SHIFT) << BITS) | (b >> BIN_SHIFT);
      const bin = bins.get(key);
      if (bin === undefined) bins.set(key, { count: 1, r, g, b });
      else {
        bin.count += 1;
        bin.r += r;
        bin.g += g;
        bin.b += b;
      }
      used += 1;
    }
  }
  if (used === 0) return [];
  const seeds = [...bins.values()].sort((left, right) => right.count - left.count).slice(0, k);
  let centers: Center[] = seeds.map((bin) => ({ r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count }));
  const points = [...bins.values()].map((bin) => ({
    color: { r: bin.r / bin.count, g: bin.g / bin.count, b: bin.b / bin.count },
    weight: bin.count,
  }));

  for (let round = 0; round < ROUNDS && centers.length > 1; round += 1) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, weight: 0 }));
    for (const point of points) {
      const sum = sums[nearestCenter(centers, point.color)] as { r: number; g: number; b: number; weight: number };
      sum.r += point.color.r * point.weight;
      sum.g += point.color.g * point.weight;
      sum.b += point.color.b * point.weight;
      sum.weight += point.weight;
    }
    const next = sums
      .filter((sum) => sum.weight > 0)
      .map((sum) => ({ r: sum.r / sum.weight, g: sum.g / sum.weight, b: sum.b / sum.weight }));
    if (next.length === 0) break;
    const settled =
      next.length === centers.length &&
      next.every((center, index) => Math.abs(center.r - (centers[index] as Center).r) < 0.5 && Math.abs(center.g - (centers[index] as Center).g) < 0.5 && Math.abs(center.b - (centers[index] as Center).b) < 0.5);
    centers = next;
    if (settled) break;
  }

  const areas = centers.map(() => 0);
  for (const point of points) {
    const index = nearestCenter(centers, point.color);
    areas[index] = (areas[index] as number) + point.weight;
  }
  const swatches: Swatch[] = centers.map((center, index) => ({
    color: { r: Math.round(center.r), g: Math.round(center.g), b: Math.round(center.b), a: 255 },
    area: (areas[index] as number) / used,
  }));
  return swatches
    .filter((swatch) => swatch.area > 0)
    .sort((left, right) => {
      if (right.area !== left.area) return right.area - left.area;
      return left.color.r * 65536 + left.color.g * 256 + left.color.b - (right.color.r * 65536 + right.color.g * 256 + right.color.b);
    });
}

export type Lab = { l: number; a: number; b: number };

const WHITE: [number, number, number] = [0.95047, 1, 1.08883];

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function labCurve(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

export function labOf(color: Rgba): Lab {
  const red = srgbToLinear(color.r);
  const green = srgbToLinear(color.g);
  const blue = srgbToLinear(color.b);
  const x = labCurve((0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / (WHITE[0] as number));
  const y = labCurve((0.2126729 * red + 0.7151522 * green + 0.072175 * blue) / (WHITE[1] as number));
  const z = labCurve((0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / (WHITE[2] as number));
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

export function deltaE76(left: Rgba, right: Rgba): number {
  const first = labOf(left);
  const second = labOf(right);
  return Math.sqrt((first.l - second.l) ** 2 + (first.a - second.a) ** 2 + (first.b - second.b) ** 2);
}

export type TokenColor = { name: string; color: Rgba };

export type PaletteFinding = {
  kind: 'missing' | 'drift';
  token: string;
  expected: string;
  actual: string;
  distance: number;
  area: number;
};

export type PaletteReport = { missing: PaletteFinding[]; drift: PaletteFinding[]; swatches: Swatch[] };

export const NATIVE_MISSING_DELTA_E = 10;
export const NATIVE_DRIFT_DELTA_E = 2;
export const NATIVE_MIN_AREA = 0.002;
export const NATIVE_DRIFT_AREA = 0.01;

export type PaletteOptions = {
  missingDelta?: number;
  driftDelta?: number;
  minArea?: number;
  driftArea?: number;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function checkPalette(
  swatches: readonly Swatch[],
  tokens: readonly TokenColor[],
  opts: PaletteOptions = {},
): PaletteReport {
  const missingDelta = opts.missingDelta ?? NATIVE_MISSING_DELTA_E;
  const driftDelta = opts.driftDelta ?? NATIVE_DRIFT_DELTA_E;
  const minArea = opts.minArea ?? NATIVE_MIN_AREA;
  const driftArea = opts.driftArea ?? NATIVE_DRIFT_AREA;
  const missing: PaletteFinding[] = [];
  const drift: PaletteFinding[] = [];
  for (const token of tokens) {
    let distance = Number.POSITIVE_INFINITY;
    let area = 0;
    let actual = 'nothing';
    for (const swatch of swatches) {
      if (swatch.area < minArea) continue;
      const value = deltaE76(swatch.color, token.color);
      if (value < distance) {
        distance = value;
        area = swatch.area;
        actual = formatColor(swatch.color);
      }
    }
    if (distance <= missingDelta) continue;
    missing.push({
      kind: 'missing',
      token: token.name,
      expected: formatColor(token.color),
      actual,
      distance: round(Number.isFinite(distance) ? distance : 100),
      area: round(area),
    });
  }
  for (const swatch of swatches) {
    if (swatch.area < driftArea) continue;
    let near: { name: string; distance: number; color: Rgba } | undefined;
    for (const token of tokens) {
      const distance = deltaE76(swatch.color, token.color);
      if (near === undefined || distance < near.distance) near = { name: token.name, distance, color: token.color };
    }
    if (near === undefined || near.distance <= driftDelta || near.distance > missingDelta) continue;
    drift.push({
      kind: 'drift',
      token: near.name,
      expected: formatColor(near.color),
      actual: formatColor(swatch.color),
      distance: round(near.distance),
      area: round(swatch.area),
    });
  }
  return { missing, drift, swatches: [...swatches] };
}

export function normativeColors(screen: ScreenSpec, tokens: TokenSets, state: string, mode: string): TokenColor[] {
  const exact = screen.variants.filter((variant) => variant.state === state && variant.mode === mode);
  const variants = exact.length > 0 ? exact : screen.variants;
  const index = tokenIndex(tokens);
  const found = new Map<string, Rgba>();
  for (const variant of variants) {
    for (const component of variant.components) {
      if (!component.normative) continue;
      for (const key of ['color', 'background'] as const) {
        const token = component.tokens?.[key];
        const raw = token === undefined ? component[key] : tokenValueOf(tokens, token, variant.mode) ?? component[key];
        const color = parseColor(raw);
        if (color === undefined || color.a === 0) continue;
        const name = token ?? matchTokenColor(index, color, 0);
        if (name === undefined || found.has(name)) continue;
        found.set(name, color);
      }
    }
  }
  return [...found].map(([name, color]) => ({ name, color }));
}
