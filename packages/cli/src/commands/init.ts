import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { boolValue, parseCommandArgs, stringValue } from '../args.ts';
import { globalConfigPath, readConfigFile } from '../config.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { INIT_USAGE } from '../usage.ts';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function serverUrl(value: string | undefined, flag: string): string {
  const text = (value ?? '').trim();
  if (text === '') throw new UsageError(`init needs --${flag} <url>`);
  const url = text.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError(`--${flag} is not a url: ${text}`);
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    throw new UsageError(`--${flag} must be an https:// url: ${text}`);
  }
  return url;
}

async function rawConfig(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return {};
    throw new UsageError(`cannot read ${file}: ${messageOf(err)}`);
  }
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new UsageError(`${file} must hold a JSON object`);
  return parsed;
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    {
      url: { type: 'string' },
      art: { type: 'string' },
      theme: { type: 'string' },
      force: { type: 'boolean' },
    },
    0,
    0,
    INIT_USAGE,
  );
  const url = serverUrl(stringValue(args, 'url'), 'url');
  const art = serverUrl(stringValue(args, 'art'), 'art');
  const theme = (stringValue(args, 'theme') ?? '').trim();

  const file = globalConfigPath(process.env);
  const current = await readConfigFile(file);
  const same = (have: string | undefined, want: string): boolean =>
    have === undefined || have.replace(/\/+$/, '') === want;
  if (!boolValue(args, 'force')) {
    const clash = [same(current.url, url) ? undefined : current.url, same(current.art, art) ? undefined : current.art].find(
      (value): value is string => value !== undefined,
    );
    if (clash !== undefined) {
      throw new UsageError(`${file} already has ${clash}; run rshow init --force to replace it`);
    }
  }

  const raw = await rawConfig(file);
  raw.url = url;
  raw.art = art;
  if (theme !== '') raw.theme = theme;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

  ctx.out.data({ path: file, url, art });
  ctx.out.line(`wrote ${file}`);
  ctx.out.line('next: rshow login');
}
