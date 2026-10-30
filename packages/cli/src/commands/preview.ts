import { stat } from 'node:fs/promises';
import path from 'node:path';
import { boolValue, parseCommandArgs, stringValue } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { closeOnSignals, startPreview } from '../serve.ts';
import { PREVIEW_USAGE } from '../usage.ts';
import { warn } from '../warn.ts';

const DEFAULT_PORT = 4321;

export function portOf(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  if (!/^[0-9]+$/.test(value)) throw new UsageError(`invalid port: ${value}`);
  const port = Number(value);
  if (port > 65535) throw new UsageError(`invalid port: ${value}`);
  return port;
}

export async function requireFolder(input: string, what: string): Promise<string> {
  const dir = path.resolve(input);
  const info = await stat(dir).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw new UsageError(`no such ${what}: ${input}`);
  return dir;
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    {
      port: { type: 'string' },
      theme: { type: 'string' },
      offline: { type: 'boolean' },
      'no-reload': { type: 'boolean' },
    },
    1,
    1,
    PREVIEW_USAGE,
  );
  const dir = await requireFolder(args.positionals[0] as string, 'folder');
  const themeInput = stringValue(args, 'theme');
  const theme = themeInput === undefined ? undefined : await requireFolder(themeInput, 'theme folder');
  const offline = boolValue(args, 'offline');

  const port = portOf(stringValue(args, 'port'));
  const config = await ctx.config(dir);
  if (config.art === undefined && !offline) warn('no art host configured; skipping the /_themes proxy');
  const preview = await startPreview({
    dir,
    art: offline ? '' : (config.art ?? ''),
    offline,
    port,
    ...(theme === undefined ? {} : { theme }),
    reload: !boolValue(args, 'no-reload'),
  });
  closeOnSignals(preview);
  ctx.out.raw(preview.url);
}
