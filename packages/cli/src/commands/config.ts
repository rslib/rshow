import { THEME_NAME_PATTERN } from 'rshow-shared';
import { boolValue, parseCommandArgs } from '../args.ts';
import type { AppConfig } from '../config.ts';
import type { Ctx } from '../context.ts';
import { CONFIG_USAGE } from '../usage.ts';
import { warn } from '../warn.ts';

const THEME_TIMEOUT_MS = 5000;

type ThemeRef = { name: string; version?: string };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function themeRefOf(theme: string): ThemeRef {
  const at = theme.indexOf('@');
  if (at < 0) return { name: theme };
  return { name: theme.slice(0, at), version: theme.slice(at + 1) };
}

async function fetchVersion(art: string, name: string): Promise<string> {
  const reply = await fetch(`${art}/_themes/${name}.json`, { signal: AbortSignal.timeout(THEME_TIMEOUT_MS) });
  if (reply.status !== 200) throw new Error(`HTTP ${reply.status}`);
  const body: unknown = await reply.json();
  const version = (body as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && Number.isInteger(version) && version >= 0) return String(version);
  if (typeof version === 'string' && /^[0-9]+$/.test(version)) return version;
  throw new Error('invalid theme JSON');
}

// Resolves <name>, <name>@latest or <name>@<n> to <name>@<n> against the art host.
// A pinned version is returned as it is, with no request.
export async function resolvedTheme(art: string, theme: string): Promise<string> {
  const ref = themeRefOf(theme);
  if (ref.version !== undefined && ref.version !== 'latest') return theme;
  if (!THEME_NAME_PATTERN.test(ref.name)) throw new Error('theme name is not valid');
  return `${ref.name}@${await fetchVersion(art, ref.name)}`;
}

async function resolveTheme(config: AppConfig): Promise<AppConfig> {
  const theme = config.theme ?? 'default';
  const ref = themeRefOf(theme);
  if (ref.version !== undefined && ref.version !== 'latest') return config;
  if (config.art === undefined) {
    warn('no art host configured; skipping theme version lookup');
    return config;
  }
  try {
    return { ...config, theme: await resolvedTheme(config.art, theme) };
  } catch (err) {
    warn(`cannot resolve theme ${ref.name}: ${messageOf(err)}`);
    return config.theme === undefined ? config : { ...config, theme: ref.name };
  }
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, { offline: { type: 'boolean' } }, 0, 1, CONFIG_USAGE);
  const dir = args.positionals[0];
  const loaded = await ctx.config(dir);
  const config = boolValue(args, 'offline') ? loaded : await resolveTheme(loaded);
  ctx.out.data(config);
  ctx.out.line(JSON.stringify(config, null, 2));
}
