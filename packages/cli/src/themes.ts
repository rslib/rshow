import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEME_NAME_PATTERN, THEME_PREFIX } from 'rshow-shared';
import type { Finding } from './check.ts';
import { parseColor } from './color.ts';
import type { Rgba } from './color.ts';
import { UsageError } from './exit.ts';
import { extractTokens } from './tokens.ts';
import type { TokenDecl } from './tokens.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Running from src in the repo, then from the bundled dist in an installed
// package, where themes/default sits next to dist.
export const BUILTIN_BASES: readonly string[] = [
  path.resolve(HERE, '../../../themes'),
  path.resolve(HERE, '../themes'),
];

// The same two places for the skills rshow ships: <repo>/skills from src, and
// <package>/skills next to dist when installed.
export const BUILTIN_SKILL_BASES: readonly string[] = [
  path.resolve(HERE, '../../../skills'),
  path.resolve(HERE, '../skills'),
];

export const ROLE_TOKENS = ['--bg', '--fg', '--muted', '--accent', '--layer-01'];
export const TEXT_ROLES = ['--fg', '--muted', '--accent'];
export const GROUND_TOKENS = ['--bg', '--layer-01'];
export const LICENCE_FILES = ['OFL.txt', 'LICENSE', 'LICENSE.txt', 'LICENSE.md'];
export const MIN_CONTRAST = 4.5;

const COLOUR_VALUE = /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(.+\))$/i;
const VAR_VALUE = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;
const DECLARATION_VAR = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;
const FONT_FORMATS: Record<string, string> = {
  '.woff2': 'woff2',
  '.woff': 'woff',
  '.ttf': 'truetype',
  '.otf': 'opentype',
};

export type FontEntry = { family: string; weight?: string; style?: string; file: string };

export type ThemeDoc = {
  dir: string;
  text: string;
  json: Record<string, unknown>;
};

export type ThemeValues = {
  tokens: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
};

export type MergedValues = { light: Record<string, string>; dark: Record<string, string> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function isFile(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => undefined);
  return info !== undefined && info.isFile();
}

async function isDir(dir: string): Promise<boolean> {
  const info = await stat(dir).catch(() => undefined);
  return info !== undefined && info.isDirectory();
}

export function tokenMap(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isRecord(value)) return out;
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw === 'string' && raw.trim() !== '') out[name] = raw.trim();
  }
  return out;
}

export function fontList(value: unknown): FontEntry[] {
  if (!Array.isArray(value)) return [];
  const out: FontEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const family = stringField(item.family);
    const file = stringField(item.file);
    if (family === undefined || file === undefined) continue;
    const weight = item.weight === undefined ? undefined : String(item.weight);
    const style = stringField(item.style);
    out.push({ family, file, ...(weight === undefined ? {} : { weight }), ...(style === undefined ? {} : { style }) });
  }
  return out;
}

export function themeValues(json: unknown): ThemeValues {
  const doc = isRecord(json) ? json : {};
  const modes = isRecord(doc.modeTokens) ? doc.modeTokens : {};
  return {
    tokens: tokenMap(doc.tokens),
    light: tokenMap(modes.light),
    dark: tokenMap(modes.dark),
  };
}

export async function readThemeJson(dir: string): Promise<ThemeDoc> {
  const file = path.join(dir, 'theme.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') throw new UsageError(`${dir} has no theme.json`);
    throw new UsageError(`cannot read ${file}: ${messageOf(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`invalid JSON in ${file}`);
  }
  if (!isRecord(parsed)) throw new UsageError(`${file} must hold a JSON object`);
  return { dir, text, json: parsed };
}

export async function builtinThemeDir(
  name: string,
  bases: readonly string[] = BUILTIN_BASES,
): Promise<string | undefined> {
  if (!THEME_NAME_PATTERN.test(name)) return undefined;
  for (const base of bases) {
    const dir = path.join(base, name);
    if (await isDir(dir)) return dir;
  }
  return undefined;
}

export async function builtinSkillsDir(bases: readonly string[] = BUILTIN_SKILL_BASES): Promise<string | undefined> {
  for (const base of bases) {
    if (await isDir(base)) return base;
  }
  return undefined;
}

// A print block repeats the light values under a selector that also names
// [data-mode="dark"], so it would land in the dark set; drop it and measure
// print against the light values instead.
function stripPrint(css: string): string {
  let out = '';
  let index = 0;
  while (index < css.length) {
    const at = css.indexOf('@media print', index);
    if (at === -1) {
      out += css.slice(index);
      break;
    }
    out += css.slice(index, at);
    const open = css.indexOf('{', at);
    if (open === -1) break;
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      const char = css[cursor];
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      cursor += 1;
    }
    index = cursor;
  }
  return out;
}

export async function themeTokenSets(dir: string): Promise<{ light: TokenDecl[]; dark: TokenDecl[] }> {
  const file = path.join(dir, 'tokens.css');
  const text = await readFile(file, 'utf8').catch(() => undefined);
  return extractTokens(text === undefined ? [] : [stripPrint(text)]);
}

function declMap(list: readonly TokenDecl[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of list) out[decl.name] = decl.value;
  return out;
}

export function mergeValues(base: { light: TokenDecl[]; dark: TokenDecl[] }, values: ThemeValues): MergedValues {
  const light = declMap(base.light);
  const dark = declMap(base.dark);
  return {
    light: { ...light, ...values.tokens, ...values.light },
    dark: { ...dark, ...values.tokens, ...values.dark },
  };
}

function declarations(values: Record<string, string>, indent: string): string {
  return Object.entries(values)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}

export function presetTokenCss(name: string, values: ThemeValues): string {
  const parts: string[] = [];
  const light = { ...values.tokens, ...values.light };
  const root = declarations(light, '  ');
  if (root !== '') parts.push(`:root {\n${root}\n}`);
  const dark = declarations(values.dark, '    ');
  if (dark !== '') {
    parts.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-mode="light"]) {\n${dark}\n  }\n}`);
    parts.push(`:root[data-mode="dark"] {\n${declarations(values.dark, '  ')}\n}`);
  }
  if (parts.length === 0) return '';
  return `\n/* preset "${name}": token overrides, after the base so they win. */\n${parts.join('\n\n')}\n`;
}

function fontUrl(file: string): string {
  return file.includes('/') ? file : `fonts/${file}`;
}

export function presetFontCss(fonts: readonly FontEntry[]): string {
  const rules = fonts.map((font) => {
    const lines = [`  font-family: "${font.family.replace(/"/g, '\\"')}";`];
    lines.push(`  font-style: ${font.style ?? 'normal'};`);
    lines.push(`  font-weight: ${font.weight ?? '400'};`);
    lines.push('  font-display: swap;');
    const url = fontUrl(font.file);
    const format = FONT_FORMATS[path.extname(url).toLowerCase()];
    const source = format === undefined ? `url("${url}")` : `url("${url}") format("${format}")`;
    lines.push(`  src: ${source};`);
    return `@font-face {\n${lines.join('\n')}\n}`;
  });
  return rules.length === 0 ? '' : `\n${rules.join('\n\n')}\n`;
}

export function mergeTheme(
  base: Record<string, unknown>,
  preset: Record<string, unknown>,
  baseName: string,
): Record<string, unknown> {
  const baseValues = themeValues(base);
  const presetValues = themeValues(preset);
  const merged: Record<string, unknown> = { ...base, ...preset };
  merged.tokens = { ...baseValues.tokens, ...presetValues.tokens };
  merged.modeTokens = {
    light: { ...baseValues.light, ...presetValues.light },
    dark: { ...baseValues.dark, ...presetValues.dark },
  };
  merged.extends = { name: baseName, from: base.name };
  return merged;
}

async function appendFile(file: string, addition: string): Promise<void> {
  if (addition === '') return;
  const before = await readFile(file, 'utf8').catch(() => '');
  const glue = before === '' || before.endsWith('\n') ? '' : '\n';
  await writeFile(file, `${before}${glue}${addition}`);
}

export async function buildPreset(presetDir: string, outDir: string): Promise<void> {
  const preset = await readThemeJson(presetDir);
  const baseName = stringField(preset.json.extends);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  if (baseName === undefined) {
    await cp(presetDir, outDir, { recursive: true });
    return;
  }

  const baseDir = await builtinThemeDir(baseName);
  if (baseDir === undefined) throw new UsageError(`no built-in theme: ${baseName}`);
  const base = await readThemeJson(baseDir);
  await cp(baseDir, outDir, { recursive: true });

  const values = themeValues(preset.json);
  const name = stringField(preset.json.name) ?? baseName;
  await appendFile(path.join(outDir, 'tokens.css'), presetTokenCss(name, values));

  const fonts = fontList(preset.json.fonts);
  if (fonts.length > 0) {
    const from = path.join(presetDir, 'fonts');
    if (await isDir(from)) await cp(from, path.join(outDir, 'fonts'), { recursive: true });
    await appendFile(path.join(outDir, 'fonts.css'), presetFontCss(fonts));
  }

  const merged = mergeTheme(base.json, preset.json, baseName);
  await writeFile(path.join(outDir, 'theme.json'), `${JSON.stringify(merged, null, 2)}\n`);
}

export function keyLine(text: string, key: string, mode?: 'light' | 'dark'): number {
  const lines = text.split('\n');
  let section: string | undefined;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const found = /"(light|dark)"\s*:/.exec(line);
    if (found !== null && found[1] !== undefined) section = found[1];
    if (!line.includes(`"${key}"`)) continue;
    if (mode === undefined || section === mode) return i + 1;
  }
  return 0;
}

function finding(path: string, line: number, severity: 'error' | 'warning', message: string): Finding {
  return { path, line: Math.max(1, line), severity, message };
}

function resolveValue(
  name: string,
  map: Record<string, string>,
  fallback: Record<string, string>,
): string | undefined {
  let current = map[name] ?? fallback[name];
  for (let i = 0; i < 10; i += 1) {
    if (current === undefined) return undefined;
    const ref = DECLARATION_VAR.exec(current.trim());
    if (ref === null) return current;
    const next = map[ref[1] as string] ?? fallback[ref[1] as string];
    if (next === undefined || next === current) return undefined;
    current = next;
  }
  return undefined;
}

function colourOf(name: string, map: Record<string, string>, fallback: Record<string, string>): Rgba | undefined {
  const value = resolveValue(name, map, fallback);
  return value === undefined ? undefined : parseColor(value);
}

function luminance(color: Rgba): number {
  const channel = (value: number): number => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const one = luminance(foreground);
  const other = luminance(background);
  const high = Math.max(one, other);
  const low = Math.min(one, other);
  return (high + 0.05) / (low + 0.05);
}

function contrastFindings(text: string, values: MergedValues): Finding[] {
  const found: Finding[] = [];
  const modes = ['light', 'dark', 'print'] as const;
  for (const mode of modes) {
    const map = mode === 'dark' ? values.dark : values.light;
    const section = mode === 'dark' ? 'dark' : 'light';
    for (const role of TEXT_ROLES) {
      const foreground = colourOf(role, map, values.light);
      if (foreground === undefined) continue;
      for (const ground of GROUND_TOKENS) {
        const background = colourOf(ground, map, values.light);
        if (background === undefined) continue;
        const ratio = contrastRatio(foreground, background);
        if (ratio >= MIN_CONTRAST) continue;
        const line = keyLine(text, role, section) || keyLine(text, role);
        found.push(
          finding(
            'theme.json',
            line,
            'error',
            `${mode}: ${role} on ${ground} is ${ratio.toFixed(2)}:1, needs ${MIN_CONTRAST}:1`,
          ),
        );
      }
    }
  }
  return found;
}

function validColour(value: string, known: ReadonlySet<string>): boolean {
  const text = value.trim();
  if (COLOUR_VALUE.test(text)) return parseColor(text) !== undefined;
  const ref = VAR_VALUE.exec(text);
  return ref !== null && known.has(ref[1] as string);
}

function isColourName(name: string, base: { light: Record<string, string>; dark: Record<string, string> }): boolean {
  const value = base.light[name] ?? base.dark[name];
  return value !== undefined && parseColor(value) !== undefined;
}

export async function checkPreset(presetDir: string): Promise<Finding[]> {
  const preset = await readThemeJson(presetDir);
  const text = preset.text;
  const findings: Finding[] = [];

  const name = stringField(preset.json.name);
  if (name === undefined) {
    findings.push(finding('theme.json', keyLine(text, 'name'), 'error', 'theme.json needs a name'));
  } else if (!THEME_NAME_PATTERN.test(name)) {
    findings.push(
      finding(
        'theme.json',
        keyLine(text, 'name'),
        'error',
        `invalid theme name: ${name} (use lowercase letters, digits and hyphens, at most 40)`,
      ),
    );
  } else if (name.startsWith(THEME_PREFIX)) {
    findings.push(
      finding(
        'theme.json',
        keyLine(text, 'name'),
        'error',
        `invalid theme name: ${name} (the slug adds ${THEME_PREFIX})`,
      ),
    );
  }

  const fonts = fontList(preset.json.fonts);
  for (const font of fonts) {
    const file = path.join(presetDir, font.file);
    if (!(await isFile(file))) {
      findings.push(finding('theme.json', keyLine(text, 'file'), 'error', `missing font file: ${font.file}`));
    }
  }
  if (fonts.length > 0) {
    const found = await Promise.all(LICENCE_FILES.map((rel) => isFile(path.join(presetDir, 'fonts', rel))));
    if (!found.some(Boolean)) {
      findings.push(
        finding(
          'theme.json',
          keyLine(text, 'fonts'),
          'warning',
          `no font licence in fonts/ (add ${LICENCE_FILES.join(', ')})`,
        ),
      );
    }
  }

  const baseName = stringField(preset.json.extends);
  if (baseName === undefined) {
    const own = await themeTokenSets(presetDir);
    if (own.light.length > 0 || own.dark.length > 0) {
      findings.push(...contrastFindings(text, mergeValues(own, themeValues({}))));
    }
    return findings.sort((a, b) => a.line - b.line);
  }

  const baseDir = await builtinThemeDir(baseName);
  if (baseDir === undefined) {
    findings.push(
      finding('theme.json', keyLine(text, 'extends'), 'error', `no built-in theme: ${baseName}`),
    );
    return findings.sort((a, b) => a.line - b.line);
  }

  const baseTokens = await themeTokenSets(baseDir);
  const baseDecls = { light: declMap(baseTokens.light), dark: declMap(baseTokens.dark) };
  const known = new Set([...Object.keys(baseDecls.light), ...Object.keys(baseDecls.dark)]);
  const values = themeValues(preset.json);

  const overrides: { mode: 'light' | 'dark' | undefined; map: Record<string, string> }[] = [
    { mode: undefined, map: values.tokens },
    { mode: 'light', map: values.light },
    { mode: 'dark', map: values.dark },
  ];
  for (const { mode, map } of overrides) {
    for (const [token, value] of Object.entries(map)) {
      const line = keyLine(text, token, mode) || keyLine(text, token);
      if (!known.has(token)) {
        findings.push(finding('theme.json', line, 'error', `unknown token: ${token}`));
        continue;
      }
      if (isColourName(token, baseDecls) && !validColour(value, known)) {
        findings.push(
          finding(
            'theme.json',
            line,
            'error',
            `bad colour value for ${token}: ${value} (use #hex, rgb() or var(--token))`,
          ),
        );
      }
    }
  }

  findings.push(...contrastFindings(text, mergeValues(baseTokens, values)));
  return findings.sort((a, b) => a.line - b.line);
}

export async function baseRoleValues(
  baseDir: string,
  roles: readonly string[],
): Promise<{ light: Record<string, string>; dark: Record<string, string> }> {
  const base = await readThemeJson(baseDir);
  const declared = themeValues(base.json);
  const sets = await themeTokenSets(baseDir);
  const css = { light: declMap(sets.light), dark: declMap(sets.dark) };
  const pick = (mode: 'light' | 'dark'): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const role of roles) {
      const value = declared[mode][role] ?? css[mode][role] ?? declared.light[role] ?? css.light[role];
      if (value !== undefined) out[role] = value;
    }
    return out;
  };
  return { light: pick('light'), dark: pick('dark') };
}
