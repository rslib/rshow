import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseCommandArgs } from '../args.ts';
import { globalConfigPath, localConfigPath } from '../config.ts';
import type { AppConfig } from '../config.ts';
import type { Ctx } from '../context.ts';
import { EXIT } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import * as keychain from '../keychain.ts';
import { DOCTOR_USAGE } from '../usage.ts';
import { VERSION } from '../version.ts';
import { resolvedTheme } from './config.ts';

const TIMEOUT_MS = 5000;

type Status = 'ok' | 'warn' | 'fail';
type Check = { name: string; status: Status; detail: string };
type Token = { token?: string; source: 'env' | 'keychain' | 'none'; error?: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function isFile(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => undefined);
  return info !== undefined && info.isFile();
}

async function packageJsonPath(): Promise<string | undefined> {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const file = path.join(dir, 'package.json');
    if (await isFile(file)) return file;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

function versionParts(text: string): number[] {
  return text
    .replace(/^v/, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function atLeast(current: number[], needed: number[]): boolean {
  for (let i = 0; i < 3; i += 1) {
    const have = current[i] ?? 0;
    const want = needed[i] ?? 0;
    if (have !== want) return have > want;
  }
  return true;
}

function minimumOf(range: string): number[] | undefined {
  const match = /^>=\s*v?([0-9]+)(?:\.([0-9]+))?(?:\.([0-9]+))?/.exec(range.trim());
  if (match === null) return undefined;
  return [match[1], match[2], match[3]].map((part) => Number.parseInt(part ?? '0', 10));
}

async function nodeCheck(): Promise<Check> {
  const name = 'node';
  const current = process.versions.node;
  const file = await packageJsonPath();
  if (file === undefined) return { name, status: 'warn', detail: `v${current} (package.json not found)` };
  let range: string;
  try {
    const body = JSON.parse(await readFile(file, 'utf8')) as { engines?: { node?: unknown } };
    range = typeof body.engines?.node === 'string' ? body.engines.node : '';
  } catch (err) {
    return { name, status: 'warn', detail: `v${current} (${messageOf(err)})` };
  }
  const needed = minimumOf(range);
  if (needed === undefined) return { name, status: 'warn', detail: `v${current} (no engines.node)` };
  const status = atLeast(versionParts(current), needed) ? 'ok' : 'warn';
  return { name, status, detail: `v${current} (needs ${range})` };
}

async function tokenOf(url: string | undefined): Promise<Token> {
  const env = (process.env.RSHOW_TOKEN ?? '').trim();
  if (env !== '') return { token: env, source: 'env' };
  if (url === undefined) return { source: 'none' };
  try {
    const saved = await keychain.read(url);
    if (saved !== undefined) return { token: saved, source: 'keychain' };
    return { source: 'none' };
  } catch (err) {
    return { source: 'none', error: messageOf(err) };
  }
}

async function getJson(url: string, token?: string): Promise<{ status: number; body?: unknown }> {
  const headers: Record<string, string> = {};
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const reply = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (reply.status !== 200) return { status: reply.status };
  const body: unknown = await reply.json().catch(() => undefined);
  return { status: reply.status, body };
}

function configCheck(found: string[], config: AppConfig | undefined, error?: unknown): Check {
  const name = 'config';
  const where = found.length === 0 ? 'no config file' : found.join(', ');
  if (config === undefined) {
    return { name, status: 'fail', detail: `${where}: ${messageOf(error)}` };
  }
  const missing: string[] = [];
  if (config.url === undefined) missing.push('url');
  if (config.art === undefined) missing.push('art');
  if (missing.length > 0) {
    return { name, status: 'fail', detail: `${where} (missing ${missing.join(' and ')})` };
  }
  return { name, status: 'ok', detail: where };
}

function tokenCheck(token: Token): Check {
  const name = 'token';
  if (token.token === undefined) {
    const reason = token.error === undefined ? '' : ` (${token.error})`;
    return { name, status: 'fail', detail: `none${reason}: run rshow login, or set RSHOW_TOKEN` };
  }
  return { name, status: 'ok', detail: `source: ${token.source}` };
}

async function apiCheck(url: string | undefined, token: Token): Promise<Check> {
  const name = 'api';
  if (url === undefined) return { name, status: 'fail', detail: 'no url configured' };
  if (token.token === undefined) return { name, status: 'fail', detail: 'no token' };
  try {
    const reply = await getJson(`${url}/api/me`, token.token);
    if (reply.status !== 200) return { name, status: 'fail', detail: `HTTP ${reply.status}` };
    const body = (reply.body ?? {}) as { email?: unknown; scope?: unknown };
    const email = typeof body.email === 'string' ? body.email : '';
    const scope = typeof body.scope === 'string' ? body.scope : '';
    return { name, status: 'ok', detail: `${email} (scope ${scope})` };
  } catch (err) {
    return { name, status: 'fail', detail: messageOf(err) };
  }
}

async function artCheck(art: string | undefined): Promise<Check> {
  const name = 'art';
  if (art === undefined) return { name, status: 'warn', detail: 'no art host configured' };
  try {
    const reply = await getJson(`${art}/_themes/default.json`);
    if (reply.status !== 200) return { name, status: 'warn', detail: `HTTP ${reply.status}` };
    const version = (reply.body as { version?: unknown } | undefined)?.version;
    if (typeof version !== 'number' && typeof version !== 'string') {
      return { name, status: 'warn', detail: 'invalid theme JSON' };
    }
    return { name, status: 'ok', detail: `version ${version}` };
  } catch (err) {
    return { name, status: 'warn', detail: messageOf(err) };
  }
}

async function themeCheck(config: AppConfig | undefined): Promise<Check | undefined> {
  const name = 'theme';
  const theme = config?.theme;
  if (theme === undefined) return undefined;
  const pinned = theme.includes('@') && !theme.endsWith('@latest');
  if (config?.art === undefined && !pinned) {
    return { name, status: 'warn', detail: 'no art host configured' };
  }
  try {
    return { name, status: 'ok', detail: await resolvedTheme(config?.art ?? '', theme) };
  } catch (err) {
    return { name, status: 'warn', detail: messageOf(err) };
  }
}

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(argv, {}, 0, 1, DOCTOR_USAGE);
  const dir = args.positionals[0];

  const found: string[] = [];
  for (const file of [globalConfigPath(process.env), dir === undefined ? undefined : localConfigPath(dir)]) {
    if (file !== undefined && (await isFile(file))) found.push(file);
  }

  let config: AppConfig | undefined;
  let configError: unknown;
  try {
    config = await ctx.config(dir);
  } catch (err) {
    configError = err;
  }

  const token = await tokenOf(config?.url);
  const checks: Check[] = [
    { name: 'rshow', status: 'ok', detail: VERSION },
    await nodeCheck(),
    configCheck(found, config, configError),
    tokenCheck(token),
    await apiCheck(config?.url, token),
    await artCheck(config?.art),
  ];
  const theme = await themeCheck(config);
  if (theme !== undefined) checks.push(theme);

  ctx.out.data({ checks });
  for (const check of checks) ctx.out.line(`${check.status}  ${check.name}  ${check.detail}`);
  return checks.some((check) => check.status === 'fail') ? EXIT.check : EXIT.ok;
}
