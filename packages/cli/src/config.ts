import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { UsageError } from './exit.ts';
import { normalizeTags } from './tags.ts';
import { find } from './tokenstore.ts';

export const DEFAULT_OUT = 'dist';
export const GLOBAL_DIR = 'rshow';
export const GLOBAL_FILE = 'config.json';
export const LOCAL_FILE = 'rshow.json';
export const NO_SERVER =
  'no server configured: run rshow init --url <admin-url> --art <viewer-url>';

export type Env = Record<string, string | undefined>;

export type ConfigFields = {
  url?: string;
  art?: string;
  theme?: string;
  tokens?: Record<string, string>;
  slug?: string;
  title?: string;
  project?: string;
  tags?: string[];
  build?: string;
  out?: string;
};

export type AppConfig = ConfigFields & { url?: string; art?: string; out: string };

const STRING_FIELDS = ['url', 'art', 'theme', 'slug', 'title', 'project', 'build', 'out'] as const;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function withoutSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function globalConfigPath(env: Env): string {
  const xdg = (env.XDG_CONFIG_HOME ?? '').trim();
  const home = (env.HOME ?? '').trim();
  const base = xdg !== '' ? xdg : path.join(home !== '' ? home : homedir(), '.config');
  return path.join(base, GLOBAL_DIR, GLOBAL_FILE);
}

export function localConfigPath(dir: string): string {
  return path.join(path.resolve(dir), LOCAL_FILE);
}

function layerOf(file: string, value: unknown): ConfigFields {
  if (!isRecord(value)) throw new UsageError(`${file} must hold a JSON object`);

  const fieldOf = (key: (typeof STRING_FIELDS)[number]): string | undefined => {
    const raw = value[key];
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== 'string') throw new UsageError(`${file}: ${key} must be a string`);
    const text = raw.trim();
    return text === '' ? undefined : text;
  };

  const layer: ConfigFields = {
    url: fieldOf('url'),
    art: fieldOf('art'),
    theme: fieldOf('theme'),
    slug: fieldOf('slug'),
    title: fieldOf('title'),
    project: fieldOf('project'),
    build: fieldOf('build'),
    out: fieldOf('out'),
  };

  const rawTokens = value.tokens;
  if (rawTokens !== undefined && rawTokens !== null) {
    if (!isRecord(rawTokens)) throw new UsageError(`${file}: tokens must be an object`);
    const tokens: Record<string, string> = {};
    for (const [key, raw] of Object.entries(rawTokens)) {
      if (typeof raw !== 'string') throw new UsageError(`${file}: tokens.${key} must be a string`);
      tokens[key] = raw;
    }
    if (Object.keys(tokens).length > 0) layer.tokens = tokens;
  }

  const rawTags = value.tags;
  if (rawTags !== undefined && rawTags !== null) {
    if (!Array.isArray(rawTags)) throw new UsageError(`${file}: tags must be an array`);
    for (const raw of rawTags) {
      if (typeof raw !== 'string') throw new UsageError(`${file}: tags must hold strings`);
    }
    const tags = normalizeTags(rawTags);
    if (tags.length > 0) layer.tags = tags;
  }

  return layer;
}

export async function readConfigFile(file: string): Promise<ConfigFields> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return {};
    throw new UsageError(`cannot read ${file}: ${messageOf(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`invalid JSON in ${file}`);
  }
  return layerOf(file, parsed);
}

export async function loadConfig(env: Env, dir?: string): Promise<AppConfig> {
  const layers: ConfigFields[] = [await readConfigFile(globalConfigPath(env))];
  if (dir !== undefined) layers.push(await readConfigFile(localConfigPath(dir)));

  let url: string | undefined;
  let art: string | undefined;
  let out = DEFAULT_OUT;
  let theme: string | undefined;
  let slug: string | undefined;
  let title: string | undefined;
  let project: string | undefined;
  let tags: string[] | undefined;
  let build: string | undefined;
  const tokens: Record<string, string> = {};

  for (const layer of layers) {
    if (layer.url !== undefined) url = layer.url;
    if (layer.art !== undefined) art = layer.art;
    if (layer.out !== undefined) out = layer.out;
    if (layer.theme !== undefined) theme = layer.theme;
    if (layer.slug !== undefined) slug = layer.slug;
    if (layer.title !== undefined) title = layer.title;
    if (layer.project !== undefined) project = layer.project;
    if (layer.tags !== undefined) tags = layer.tags;
    if (layer.build !== undefined) build = layer.build;
    if (layer.tokens !== undefined) Object.assign(tokens, layer.tokens);
  }

  const envUrl = (env.RSHOW_URL ?? '').trim();
  if (envUrl !== '') url = envUrl;
  const envArt = (env.RSHOW_ART ?? '').trim();
  if (envArt !== '') art = envArt;

  const config: AppConfig = { out };
  if (url !== undefined) config.url = withoutSlash(url);
  if (art !== undefined) config.art = withoutSlash(art);
  if (theme !== undefined) config.theme = theme;
  if (Object.keys(tokens).length > 0) config.tokens = tokens;
  if (slug !== undefined) config.slug = slug;
  if (title !== undefined) config.title = title;
  if (project !== undefined) config.project = project;
  if (tags !== undefined) config.tags = tags;
  if (build !== undefined) config.build = build;
  return config;
}

export function requireUrl(config: AppConfig): string {
  if (config.url === undefined) throw new UsageError(NO_SERVER);
  return config.url;
}

export function requireArt(config: AppConfig): string {
  if (config.art === undefined) throw new UsageError(NO_SERVER);
  return config.art;
}

export async function readToken(env: Env, url: string): Promise<string> {
  const token = (env.RSHOW_TOKEN ?? '').trim();
  if (token !== '') return token;
  const found = await find(env, url);
  if (found !== undefined) return found.token;
  throw new UsageError('no token: run rshow login, or set RSHOW_TOKEN');
}
