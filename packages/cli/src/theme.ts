import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './exit.ts';

export type ThemeMeta = { name: string };

export function themeSlug(name: string): string {
  return `theme-${name}`;
}

export function themeUrl(name: string, n: number): string {
  return `/_themes/${name}@${n}/`;
}

export async function readThemeMeta(dir: string): Promise<ThemeMeta> {
  const file = path.join(dir, 'theme.json');
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') throw new UsageError(`${dir} has no theme.json`);
    throw new UsageError(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`invalid JSON in ${file}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UsageError(`${file} must hold a JSON object`);
  }
  const raw = (parsed as { name?: unknown }).name;
  if (typeof raw !== 'string' || raw.trim() === '') throw new UsageError(`theme.json needs a name`);
  const name = raw.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new UsageError(`invalid theme name: ${name}`);
  return { name };
}

export async function requireThemeDir(input: string): Promise<string> {
  const dir = path.resolve(input);
  const info = await stat(dir).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw new UsageError(`no such folder: ${input}`);
  return dir;
}
