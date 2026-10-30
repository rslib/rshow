import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { UsageError } from './exit.ts';

export const MAP_FILE = 'rshow.map.json';

export type RshowMap = {
  components: Record<string, string>;
  tokens: Record<string, string>;
  screens: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textMap(file: string, key: string, value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new UsageError(`${file}: ${key} must be an object`);
  const out: Record<string, string> = {};
  for (const [name, target] of Object.entries(value)) {
    if (typeof target !== 'string') throw new UsageError(`${file}: ${key}.${name} must be a string`);
    out[name] = target;
  }
  return out;
}

export function mapPath(dir?: string): string {
  return path.resolve(dir ?? process.cwd(), MAP_FILE);
}

export async function readMapFile(file: string): Promise<RshowMap | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return undefined;
    throw new UsageError(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`invalid JSON in ${file}`);
  }
  if (!isRecord(parsed)) throw new UsageError(`${file} must hold a JSON object`);
  return {
    components: textMap(file, 'components', parsed.components),
    tokens: textMap(file, 'tokens', parsed.tokens),
    screens: textMap(file, 'screens', parsed.screens),
  };
}

export async function writeMapFile(file: string, map: RshowMap): Promise<void> {
  await writeFile(file, `${JSON.stringify(sortMap(map), null, 2)}\n`);
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) out[key] = value[key] as string;
  return out;
}

export function sortMap(map: RshowMap): RshowMap {
  return {
    components: sortRecord(map.components),
    tokens: sortRecord(map.tokens),
    screens: sortRecord(map.screens),
  };
}

export function starterMap(
  components: readonly string[],
  tokens: readonly string[],
  screens: readonly string[],
): RshowMap {
  const map: RshowMap = { components: {}, tokens: {}, screens: {} };
  for (const name of components) map.components[name] = '';
  for (const name of tokens) map.tokens[name] = '';
  for (const name of screens) map.screens[name] = '';
  return sortMap(map);
}
