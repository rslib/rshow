import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { UsageError } from './exit.ts';
import { warn } from './warn.ts';

const DIR = 'rshow';
const FILE = 'credentials';
const VERSION = 1;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
// The bits that let a group or anyone else open the file.
const SHARED = 0o077;

type Env = Record<string, string | undefined>;

const fixed = new Set<string>();

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function credentialsPath(env: Env): string {
  const xdg = (env.XDG_CONFIG_HOME ?? '').trim();
  const home = (env.HOME ?? '').trim();
  const base = xdg !== '' ? xdg : path.join(home !== '' ? home : homedir(), '.config');
  return path.join(base, DIR, FILE);
}

// A file another account can read holds a token they were never given, so a
// loose mode is tightened, once, and the person is told why.
async function tighten(file: string): Promise<void> {
  await chmod(file, FILE_MODE).catch(() => {});
  if (fixed.has(file)) return;
  fixed.add(file);
  warn(`${file} was readable by group or other; its mode is now 600`);
}

async function load(file: string): Promise<Record<string, string>> {
  const info = await stat(file).catch(() => undefined);
  if (info === undefined) return {};
  if ((info.mode & SHARED) !== 0) await tighten(file);

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
  if (!isRecord(parsed)) throw new UsageError(`${file} must hold a JSON object`);
  if (parsed.version !== undefined && parsed.version !== VERSION) {
    throw new UsageError(`${file}: version must be ${VERSION}`);
  }
  const raw = parsed.tokens ?? {};
  if (!isRecord(raw)) throw new UsageError(`${file}: tokens must be an object`);
  const tokens: Record<string, string> = {};
  for (const [url, token] of Object.entries(raw)) {
    if (typeof token !== 'string') throw new UsageError(`${file}: tokens.${url} must be a string`);
    tokens[url] = token;
  }
  return tokens;
}

async function store(file: string, tokens: Record<string, string>): Promise<void> {
  const dir = path.dirname(file);
  let created: string | undefined;
  try {
    created = await mkdir(dir, { recursive: true, mode: DIR_MODE });
  } catch (err) {
    throw new UsageError(`cannot make ${dir}: ${messageOf(err)}`);
  }
  if (created !== undefined) await chmod(dir, DIR_MODE).catch(() => {});

  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  const body = `${JSON.stringify({ version: VERSION, tokens }, null, 2)}\n`;
  try {
    await writeFile(temp, body, { mode: FILE_MODE, flag: 'wx' });
    await chmod(temp, FILE_MODE);
    await rename(temp, file);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw new UsageError(`cannot write ${file}: ${messageOf(err)}`);
  }
}

export async function read(file: string, url: string): Promise<string | undefined> {
  return (await load(file))[url];
}

export async function save(file: string, url: string, token: string): Promise<void> {
  const tokens = await load(file);
  tokens[url] = token;
  await store(file, tokens);
}

export async function remove(file: string, url: string): Promise<boolean> {
  const tokens = await load(file);
  if (tokens[url] === undefined) return false;
  delete tokens[url];
  if (Object.keys(tokens).length === 0) {
    await unlink(file).catch((err: { code?: string }) => {
      if (err.code !== 'ENOENT') throw new UsageError(`cannot remove ${file}: ${messageOf(err)}`);
    });
    return true;
  }
  await store(file, tokens);
  return true;
}
