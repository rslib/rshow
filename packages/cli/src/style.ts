import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type StyleEntry = { rel: string; abs: string; size: number };
export type StyleWarning = { path: string; line: number; message: string };

const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const STYLE_EXTENSIONS = new Set(['.html', '.htm', '.css']);

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
  'none',
  '-apple-system',
  'blinkmacsystemfont',
]);

const TRENDY_FONTS = new Map([
  ['inter', 'Inter'],
  ['space grotesk', 'Space Grotesk'],
  ['geist', 'Geist'],
  ['fraunces', 'Fraunces'],
  ['instrument serif', 'Instrument Serif'],
  ['poppins', 'Poppins'],
  ['montserrat', 'Montserrat'],
]);

const THEME_FONTS = ['IBM Plex Sans', 'IBM Plex Mono', 'IBM Plex Serif'];

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const RULE = /([^{}]*)\{([^{}]*)\}/g;
const FONT_FACE = /@font-face\s*\{([^{}]*)\}/gi;
const STYLE_BLOCK = /<style\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/style\s*>/gi;
const SCRIPT_BLOCK = /<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi;
const ANY_TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const ELEMENT_TEXT = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>([^<]*)<\/\1\s*>/g;
const ZERO_PADDED = /^\s*0[0-9]+\s*$/;
const EMOJI = /\p{Emoji_Presentation}/gu;
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^()]*\)/gi;
const GOOGLE_URL = /fonts\.googleapis\.com\/[^"'\s)>]*/gi;
const GOOGLE_FAMILY = /[?&]family=([^&"'\s]+)/gi;
const THEME_LINK = /\/_themes\/[a-z0-9][a-z0-9-]*@(?:[0-9]+|latest)\//i;

type Hsl = { h: number; s: number; l: number };
type Decl = { prop: string; value: string; index: number };

type Ctx = {
  rel: string;
  starts: number[];
  out: StyleWarning[];
  used: { path: string; line: number; name: string }[];
  cream: { index: number; color: string }[];
  terracotta: { index: number; color: string }[];
};

export function stylePathSkipped(rel: string): boolean {
  const parts = rel.toLowerCase().split('/');
  const name = parts[parts.length - 1] ?? '';
  if (name.endsWith('.min.css') || name.endsWith('.min.js')) return true;
  return parts.slice(0, -1).includes('fonts');
}

function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0x0a) starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((starts[mid] as number) <= index) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function key(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === separator && depth === 0) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

function callArgs(text: string, head: string): { at: number; args: string }[] {
  const lower = text.toLowerCase();
  const needle = `${head}(`;
  const found: { at: number; args: string }[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf(needle, from);
    if (at === -1) break;
    let depth = 0;
    let close = text.length;
    for (let i = at + needle.length - 1; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    found.push({ at, args: text.slice(at + needle.length, close) });
    if (close + 1 <= at) break;
    from = close + 1;
  }
  return found;
}

function rgbToHsl(red: number, green: number, blue: number): Hsl {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const span = max - min;
  if (span === 0) return { h: 0, s: 0, l: l * 100 };
  const s = span / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / span) % 6;
  else if (max === g) h = (b - r) / span + 2;
  else h = (r - g) / span + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function argsOf(value: string): string[] {
  return splitOutside(value.replace(/^[a-z-]+\(/i, '').replace(/\)\s*$/, ''), ',')
    .join(' ')
    .split(/[\s/]+/)
    .filter((part) => part !== '');
}

function channelValue(token: string): number {
  if (token.endsWith('%')) return (Number(token.slice(0, -1)) / 100) * 255;
  return Number(token);
}

function hueValue(token: string): number {
  const value = token.toLowerCase();
  if (value.endsWith('turn')) return Number(value.slice(0, -4)) * 360;
  if (value.endsWith('rad')) return (Number(value.slice(0, -3)) * 180) / Math.PI;
  if (value.endsWith('grad')) return (Number(value.slice(0, -4)) * 360) / 400;
  return Number(value.replace(/deg$/, ''));
}

function parseColor(raw: string): Hsl | undefined {
  const value = raw.trim().toLowerCase();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const digits = hex.length === 3 || hex.length === 4 ? hex.split('').map((c) => c + c).join('') : hex;
    if ((digits.length !== 6 && digits.length !== 8) || !/^[0-9a-f]+$/.test(digits)) return undefined;
    const red = Number.parseInt(digits.slice(0, 2), 16);
    const green = Number.parseInt(digits.slice(2, 4), 16);
    const blue = Number.parseInt(digits.slice(4, 6), 16);
    return rgbToHsl(red, green, blue);
  }
  if (value.startsWith('rgb')) {
    const parts = argsOf(value);
    if (parts.length < 3) return undefined;
    const red = channelValue(parts[0] as string);
    const green = channelValue(parts[1] as string);
    const blue = channelValue(parts[2] as string);
    if (![red, green, blue].every((n) => Number.isFinite(n))) return undefined;
    return rgbToHsl(red, green, blue);
  }
  if (value.startsWith('hsl')) {
    const parts = argsOf(value);
    if (parts.length < 3) return undefined;
    const h = hueValue(parts[0] as string);
    const s = Number((parts[1] as string).replace(/%$/, ''));
    const l = Number((parts[2] as string).replace(/%$/, ''));
    if (![h, s, l].every((n) => Number.isFinite(n))) return undefined;
    return { h: ((h % 360) + 360) % 360, s, l };
  }
  return undefined;
}

function colorsOf(value: string): { color: string; hsl: Hsl }[] {
  const found: { color: string; hsl: Hsl }[] = [];
  for (const match of value.matchAll(COLOR)) {
    const hsl = parseColor(match[0]);
    if (hsl !== undefined) found.push({ color: match[0], hsl });
  }
  return found;
}

function wideSpacing(value: string): string | undefined {
  const match = /(-?[0-9]*\.?[0-9]+)\s*(px|rem|em)\b/i.exec(value);
  if (match === null) return undefined;
  const size = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  const wide = unit === 'px' ? size >= 1 : size >= 0.05;
  return wide ? `${match[1]}${unit}` : undefined;
}

function warnAt(ctx: Ctx, index: number, message: string): void {
  ctx.out.push({ path: ctx.rel, line: lineAt(ctx.starts, index), message });
}

function declsOf(body: string, bodyStart: number): Decl[] {
  const decls: Decl[] = [];
  let cursor = 0;
  for (const chunk of splitOutside(body, ';')) {
    const base = bodyStart + cursor;
    cursor += chunk.length + 1;
    const colon = splitOutside(chunk, ':')[0] ?? chunk;
    if (colon.length === chunk.length) continue;
    const prop = colon.trim().toLowerCase();
    const value = chunk.slice(colon.length + 1).trim();
    if (prop === '') continue;
    decls.push({ prop, value, index: base + (chunk.length - chunk.trimStart().length) });
  }
  return decls;
}

function fontNames(value: string): string[] {
  const names: string[] = [];
  for (const part of splitOutside(value, ',')) {
    const raw = part.replace(/!important/gi, '').trim();
    if (raw === '') continue;
    const name = raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').trim();
    if (name === '' || name.includes('(') || name.startsWith('--')) continue;
    names.push(name);
  }
  return names;
}

function shadowBlur(value: string): string | undefined {
  for (const shadow of splitOutside(value, ',')) {
    const bare = shadow.replace(/[a-z-]+\([^()]*\)/gi, ' ').replace(/\binset\b/gi, ' ');
    const lengths = [...bare.matchAll(/(-?[0-9]*\.?[0-9]+)\s*(px|rem|em)?(?![0-9a-z])/gi)];
    if (lengths.length < 3) continue;
    const third = lengths[2] as RegExpMatchArray;
    const size = Number(third[1]);
    const unit = (third[2] ?? '').toLowerCase();
    if (!Number.isFinite(size)) continue;
    const px = unit === 'px' ? size : unit === '' ? size : size * 16;
    if (px >= 24) return `${third[1]}${unit}`;
  }
  return undefined;
}

function colorDeclarations(ctx: Ctx, decl: Decl): void {
  const background = decl.prop === 'background' || decl.prop === 'background-color';
  const foreground =
    decl.prop === 'color' ||
    decl.prop === 'outline' ||
    decl.prop === 'outline-color' ||
    decl.prop === 'fill' ||
    decl.prop.startsWith('border') ||
    decl.prop.startsWith('outline-');
  if (!background && !foreground) return;
  for (const { color, hsl } of colorsOf(decl.value)) {
    if (background && hsl.l > 90 && hsl.h >= 30 && hsl.h <= 50) ctx.cream.push({ index: decl.index, color });
    if (foreground && hsl.s > 45 && hsl.h >= 5 && hsl.h <= 30) {
      ctx.terracotta.push({ index: decl.index, color });
    }
  }
}

function gradientWarnings(ctx: Ctx, decl: Decl): void {
  for (const call of callArgs(decl.value, 'linear-gradient')) {
    const hues = colorsOf(call.args).map((item) => item.hsl.h);
    const purple = hues.find((h) => h >= 250 && h <= 290);
    const blue = hues.find((h) => h >= 200 && h <= 240);
    if (purple === undefined || blue === undefined) continue;
    const stops = colorsOf(call.args);
    const from = stops.find((item) => item.hsl.h === purple)?.color ?? '';
    const to = stops.find((item) => item.hsl.h === blue)?.color ?? '';
    warnAt(ctx, decl.index + call.at, `purple-blue gradient: ${from} to ${to}`);
  }
}

function fontDeclaration(ctx: Ctx, decl: Decl): void {
  if (decl.prop !== 'font-family') return;
  for (const name of fontNames(decl.value)) {
    const folded = key(name);
    if (GENERIC_FAMILIES.has(folded)) continue;
    const trendy = TRENDY_FONTS.get(folded);
    if (trendy !== undefined) {
      warnAt(ctx, decl.index, `trendy default font: ${trendy}`);
      continue;
    }
    ctx.used.push({ path: ctx.rel, line: lineAt(ctx.starts, decl.index), name });
  }
}

function declaration(ctx: Ctx, decl: Decl): void {
  if (decl.prop.endsWith('background-clip') && /^text(?:$|[\s;])/i.test(decl.value.trim())) {
    warnAt(ctx, decl.index, 'gradient text: background-clip: text');
  }
  if (decl.prop.endsWith('backdrop-filter') && callArgs(decl.value, 'blur').length > 0) {
    warnAt(ctx, decl.index, 'glass and heavy shadow: backdrop-filter: blur');
  }
  if (decl.prop.endsWith('box-shadow')) {
    const blur = shadowBlur(decl.value);
    if (blur !== undefined) warnAt(ctx, decl.index, `glass and heavy shadow: box-shadow blur ${blur}`);
  }
  colorDeclarations(ctx, decl);
  gradientWarnings(ctx, decl);
  fontDeclaration(ctx, decl);
}

function eyebrow(ctx: Ctx, ruleStart: number, decls: Decl[]): void {
  const upper = decls.some((decl) => decl.prop === 'text-transform' && /\buppercase\b/i.test(decl.value));
  if (!upper) return;
  for (const decl of decls) {
    if (decl.prop !== 'letter-spacing') continue;
    const spacing = wideSpacing(decl.value);
    if (spacing === undefined) continue;
    warnAt(ctx, ruleStart, `eyebrow label: text-transform: uppercase with letter-spacing ${spacing}`);
    return;
  }
}

function lintCss(ctx: Ctx, css: string, offset: number): void {
  for (const match of css.matchAll(RULE)) {
    const head = match[1] ?? '';
    const base = offset + (match.index ?? 0);
    if (head.trim().startsWith('@')) continue;
    const decls = declsOf(match[2] ?? '', base + head.length + 1);
    eyebrow(ctx, base + (head.length - head.trimStart().length), decls);
    for (const decl of decls) declaration(ctx, decl);
  }
}

function maskComments(text: string): string {
  return text.replace(COMMENT, blank);
}

function visibleText(masked: string): string {
  return masked.replace(SCRIPT_BLOCK, blank).replace(ANY_TAG, blank);
}

function emojiWarnings(ctx: Ctx, visible: string): void {
  const found = [...visible.matchAll(EMOJI)];
  if (found.length === 0) return;
  const codes: string[] = [];
  for (const match of found) {
    const code = (match[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    const label = `U+${code}`;
    if (!codes.includes(label)) codes.push(label);
  }
  const line = lineAt(ctx.starts, found[0]?.index ?? 0);
  ctx.out.push({
    path: ctx.rel,
    line,
    message: `emoji in visible text: ${found.length} emoji (${codes.slice(0, 3).join(', ')})`,
  });
}

function numberingWarnings(ctx: Ctx, masked: string): void {
  const hits: number[] = [];
  for (const match of masked.matchAll(ELEMENT_TEXT)) {
    if (ZERO_PADDED.test(match[3] ?? '')) hits.push(match.index ?? 0);
  }
  if (hits.length < 3) return;
  ctx.out.push({
    path: ctx.rel,
    line: lineAt(ctx.starts, hits[0] as number),
    message: `decorative numbering: ${hits.length} elements whose whole text is a zero-padded number`,
  });
}

function lintHtml(ctx: Ctx, text: string): void {
  const masked = maskComments(text);
  emojiWarnings(ctx, visibleText(masked));
  numberingWarnings(ctx, masked);
  for (const match of masked.matchAll(STYLE_BLOCK)) {
    const offset = (match.index ?? 0) + '<style'.length + (match[1] ?? '').length + 1;
    lintCss(ctx, match[2] ?? '', offset);
  }
}

function paletteWarnings(ctx: Ctx): void {
  const cream = ctx.cream[0];
  const terracotta = ctx.terracotta[0];
  if (cream === undefined || terracotta === undefined) return;
  warnAt(ctx, cream.index, `cream and terracotta palette: ${cream.color} background with ${terracotta.color}`);
}

function googleFamilies(url: string): string[] {
  const names: string[] = [];
  const decoded = url.replace(/&amp;/gi, '&');
  for (const match of decoded.matchAll(GOOGLE_FAMILY)) {
    const value = (match[1] ?? '').split(':')[0] ?? '';
    let name: string;
    try {
      name = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
      name = value.replace(/\+/g, ' ');
    }
    if (name !== '') names.push(name);
  }
  return names;
}

function collectLoaded(text: string, loaded: Set<string>): void {
  for (const match of text.matchAll(FONT_FACE)) {
    const family = /font-family\s*:\s*([^;}]+)/i.exec(match[1] ?? '');
    if (family === null) continue;
    for (const name of fontNames(family[1] ?? '')) loaded.add(key(name));
  }
  if (THEME_LINK.test(text)) {
    for (const name of THEME_FONTS) loaded.add(key(name));
  }
  for (const match of text.matchAll(GOOGLE_URL)) {
    for (const name of googleFamilies(match[0])) loaded.add(key(name));
  }
}

export async function styleWarnings(entries: StyleEntry[]): Promise<StyleWarning[]> {
  const out: StyleWarning[] = [];
  const loaded = new Set<string>();
  const used: { path: string; line: number; name: string }[] = [];

  for (const entry of entries) {
    const ext = path.extname(entry.rel).toLowerCase();
    if (!STYLE_EXTENSIONS.has(ext) || entry.size > MAX_SCAN_BYTES) continue;
    const text = await readFile(entry.abs, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    collectLoaded(text, loaded);
    if (stylePathSkipped(entry.rel)) continue;
    const ctx: Ctx = { rel: entry.rel, starts: lineStarts(text), out, used, cream: [], terracotta: [] };
    if (ext === '.css') lintCss(ctx, text, 0);
    else lintHtml(ctx, text);
    paletteWarnings(ctx);
  }

  const seen = new Set<string>();
  for (const item of used) {
    const folded = key(item.name);
    if (loaded.has(folded)) continue;
    const mark = `${item.path}\n${folded}`;
    if (seen.has(mark)) continue;
    seen.add(mark);
    out.push({
      path: item.path,
      line: item.line,
      message: `font not loaded: ${item.name} (no @font-face, /_themes/ fonts or Google Fonts link)`,
    });
  }

  return out;
}
