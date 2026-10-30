import { colorDistance, formatColor, parseColor, parsePx } from './color.ts';
import type { Rgba } from './color.ts';

export type TokenDecl = { name: string; value: string };
export type TokenSets = { light: TokenDecl[]; dark: TokenDecl[] };

export type TokenType = 'color' | 'dimension' | 'fontFamily' | 'fontWeight' | 'number' | 'string';

export type TokenIndex = {
  light: TokenDecl[];
  dark: TokenDecl[];
  colors: { name: string; rgba: Rgba }[];
  sizes: { name: string; px: number }[];
};

const COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;
const DARK_SELECTOR = /data-mode\s*=\s*['"]?dark/i;
const DARK_MEDIA = /prefers-color-scheme\s*:\s*dark/i;
const ROOT = /^(:root|html)(?![\w-])/i;

type DeclVisitor = (selector: string, body: string, dark: boolean) => void;

export function stripCssComments(css: string): string {
  return css.replace(COMMENT, ' ');
}

function walkRules(css: string, dark: boolean, visit: DeclVisitor): void {
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open === -1) break;
    const head = css.slice(index, open).trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      const char = css[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      cursor += 1;
    }
    const body = css.slice(open + 1, Math.max(open + 1, cursor - 1));
    if (head.startsWith('@')) {
      const nested = head.startsWith('@media') || head.startsWith('@supports') || head.startsWith('@layer');
      if (nested) walkRules(body, dark || DARK_MEDIA.test(head), visit);
    } else if (head !== '') {
      visit(head, body, dark);
    }
    index = cursor;
  }
}

function selectorTargetsRoot(selector: string): boolean {
  for (const part of selector.split(',')) {
    const text = part.trim();
    if (text === '') continue;
    if (ROOT.test(text)) return true;
  }
  return false;
}

function declarationsOf(body: string): TokenDecl[] {
  const found: TokenDecl[] = [];
  for (const chunk of body.split(';')) {
    const colon = chunk.indexOf(':');
    if (colon === -1) continue;
    const name = chunk.slice(0, colon).trim();
    if (!name.startsWith('--')) continue;
    const value = chunk
      .slice(colon + 1)
      .replace(/!important/gi, '')
      .trim();
    if (value === '') continue;
    found.push({ name, value });
  }
  return found;
}

function assign(list: TokenDecl[], decl: TokenDecl): void {
  const found = list.find((item) => item.name === decl.name);
  if (found === undefined) list.push({ name: decl.name, value: decl.value });
  else found.value = decl.value;
}

export function extractTokens(texts: readonly string[]): TokenSets {
  const sets: TokenSets = { light: [], dark: [] };
  for (const text of texts) {
    walkRules(stripCssComments(text), false, (selector, body, dark) => {
      if (!selectorTargetsRoot(selector)) return;
      const isDark = dark || DARK_SELECTOR.test(selector);
      for (const decl of declarationsOf(body)) assign(isDark ? sets.dark : sets.light, decl);
    });
  }
  return sets;
}

export function groupOf(name: string): { group: string; key: string } {
  const bare = name.replace(/^--/, '');
  const parts = bare.split('-').filter((part) => part !== '');
  if (parts.length <= 1) return { group: 'base', key: bare };
  return { group: parts[0] as string, key: parts.slice(1).join('-') };
}

export function inferType(name: string, value: string): TokenType {
  const lower = name.toLowerCase();
  const text = value.trim();
  if (parseColor(text) !== undefined && /^(#|rgba?\(|hsla?\()/i.test(text)) return 'color';
  if (/font-family$/.test(lower)) return 'fontFamily';
  if (/weight/.test(lower) && /^[0-9]{3}$/.test(text)) return 'fontWeight';
  if (/weight$/.test(lower)) return 'fontWeight';
  if (/^[0-9.]+$/.test(text)) return 'number';
  if (/^-?[0-9.]+(px|rem|em|pt|%|vh|vw|ch)$/.test(text)) return 'dimension';
  if (/^-?[0-9.]+(ms|s)$/.test(text)) return 'string';
  if (/font/i.test(lower)) return 'fontFamily';
  return 'string';
}

function dtcgGroup(list: TokenDecl[]): Record<string, unknown> {
  const groups = new Map<string, Record<string, unknown>>();
  const names = list.map((item) => item.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const decl = list.find((item) => item.name === name) as TokenDecl;
    const { group, key } = groupOf(decl.name);
    let bucket = groups.get(group);
    if (bucket === undefined) {
      bucket = {};
      groups.set(group, bucket);
    }
    bucket[key] = { $value: decl.value, $type: inferType(decl.name, decl.value) };
  }
  const out: Record<string, unknown> = {};
  for (const group of [...groups.keys()].sort()) out[group] = groups.get(group);
  return out;
}

export function dtcgTokens(sets: TokenSets): Record<string, unknown> {
  const out: Record<string, unknown> = { $description: 'rshow handoff tokens, W3C DTCG 2025.10' };
  Object.assign(out, dtcgGroup(sets.light));
  if (sets.dark.length > 0) out.dark = dtcgGroup(sets.dark);
  return out;
}

export function tokenIndex(sets: TokenSets): TokenIndex {
  const pick = (list: TokenDecl[]): { colors: TokenIndex['colors']; sizes: TokenIndex['sizes'] } => {
    const colors: TokenIndex['colors'] = [];
    const sizes: TokenIndex['sizes'] = [];
    for (const decl of list) {
      const rgba = parseColor(decl.value);
      if (rgba !== undefined) colors.push({ name: decl.name, rgba });
      const px = parsePx(decl.value);
      if (px !== undefined) sizes.push({ name: decl.name, px });
    }
    return { colors, sizes };
  };
  const light = pick(sets.light);
  const dark = pick(sets.dark);
  return {
    light: sets.light,
    dark: sets.dark,
    colors: [...light.colors, ...dark.colors],
    sizes: [...light.sizes, ...dark.sizes],
  };
}

export function matchTokenColor(index: TokenIndex, color: Rgba, tolerance = 0): string | undefined {
  for (const entry of index.colors) {
    if (colorDistance(entry.rgba, color) <= tolerance) return entry.name;
  }
  return undefined;
}

export function matchTokenSize(index: TokenIndex, px: number): string | undefined {
  for (const entry of index.sizes) {
    if (Math.abs(entry.px - px) < 0.01) return entry.name;
  }
  return undefined;
}

export function nearestTokenColor(
  index: TokenIndex,
  color: Rgba,
  tolerance: number,
): { name: string; value: string; distance: number } | undefined {
  let best: { name: string; value: string; distance: number } | undefined;
  for (const entry of index.colors) {
    const distance = colorDistance(entry.rgba, color);
    if (distance > tolerance) continue;
    if (best === undefined || distance < best.distance) {
      best = { name: entry.name, value: formatColor(entry.rgba), distance };
    }
  }
  return best;
}

export function tokenValueOf(sets: TokenSets, name: string, mode: string): string | undefined {
  const list = mode === 'dark' ? sets.dark : sets.light;
  const found = list.find((item) => item.name === name) ?? sets.light.find((item) => item.name === name);
  return found?.value;
}

export function cssFilesOfHtml(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (value !== undefined && value.trim() !== '') found.push(value.trim());
  }
  return found;
}

export function inlineStylesOfHtml(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) found.push(match[1] ?? '');
  return found;
}

function flattenGroup(group: unknown, prefix: string, out: TokenDecl[]): void {
  if (group === null || typeof group !== 'object') return;
  for (const [key, value] of Object.entries(group as Record<string, unknown>)) {
    if (key.startsWith('$')) continue;
    if (value !== null && typeof value === 'object' && typeof (value as { $value?: unknown }).$value === 'string') {
      const name = prefix === '' ? `--${key}` : `--${prefix}-${key}`;
      out.push({ name, value: (value as { $value: string }).$value });
      continue;
    }
    flattenGroup(value, prefix === '' ? key : `${prefix}-${key}`, out);
  }
}

function flattenInto(tree: unknown, out: TokenDecl[]): void {
  for (const [key, value] of Object.entries(tree as Record<string, unknown>)) {
    if (key.startsWith('$') || key === 'dark') continue;
    if (key === 'base' && value !== null && typeof value === 'object') {
      for (const [name, token] of Object.entries(value as Record<string, unknown>)) flattenGroup({ [name]: token }, '', out);
      continue;
    }
    flattenGroup({ [key]: value }, '', out);
  }
}

export function flattenDtcg(tree: unknown): TokenSets {
  const sets: TokenSets = { light: [], dark: [] };
  if (tree === null || typeof tree !== 'object') return sets;
  const dark = (tree as Record<string, unknown>).dark;
  flattenInto(tree, sets.light);
  if (dark !== undefined && typeof dark === 'object') flattenInto(dark, sets.dark);
  return sets;
}
