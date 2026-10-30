import process from 'node:process';
import { parseCommandArgs, stringValue } from '../args.ts';
import type { Ctx } from '../context.ts';
import { requireArt, requireUrl } from '../config.ts';
import { UsageError } from '../exit.ts';
import { displayPath, handoffDirName, parseTarget, runHandoff } from '../handoff.ts';
import { HANDOFF_USAGE } from '../usage.ts';
import { warn } from '../warn.ts';

export const DEFAULT_WIDTHS = [1440, 390];
export const DEFAULT_MODES = ['light', 'dark'];

export function widthList(text: string | undefined): number[] {
  if (text === undefined) return DEFAULT_WIDTHS;
  const parts = text.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return DEFAULT_WIDTHS;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^[0-9]+$/.test(part)) throw new UsageError(`invalid width: ${part}`);
    const width = Number(part);
    if (width < 1 || width > 10000) throw new UsageError(`invalid width: ${part}`);
    if (!out.includes(width)) out.push(width);
  }
  return out;
}

export function modeList(text: string | undefined): string[] {
  if (text === undefined) return DEFAULT_MODES;
  const parts = text.split(',').map((part) => part.trim()).filter((part) => part !== '');
  if (parts.length === 0) return DEFAULT_MODES;
  const out: string[] = [];
  for (const part of parts) {
    if (part !== 'light' && part !== 'dark') throw new UsageError(`invalid mode: ${part} (light or dark)`);
    if (!out.includes(part)) out.push(part);
  }
  return out;
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    { out: { type: 'string' }, widths: { type: 'string' }, modes: { type: 'string' } },
    1,
    1,
    HANDOFF_USAGE,
  );
  const target = parseTarget(args.positionals[0] as string);
  const config = await ctx.config(target.kind === 'local' ? target.dir : undefined);
  const version = target.kind === 'remote' ? target.version : null;
  const out = stringValue(args, 'out') ?? `./${handoffDirName(target.slug, version)}`;

  if (target.kind === 'remote') {
    requireUrl(config);
    requireArt(config);
  } else if (config.art === undefined) {
    warn('no art host configured; skipping the /_themes proxy');
  }

  const result = await runHandoff(target, {
    out,
    widths: widthList(stringValue(args, 'widths')),
    modes: modeList(stringValue(args, 'modes')),
    art: config.art ?? '',
    chrome: process.env.CHROME,
    onProgress: (line) => ctx.out.line(line),
  });

  const display = displayPath(result.out);
  ctx.out.data({
    out: result.out,
    url: result.url,
    source: result.source,
    screens: result.spec.screens.map((screen) => ({
      id: screen.id,
      title: screen.title,
      states: screen.states,
      variants: screen.variants.length,
    })),
    tokens: { light: result.tokens.light.length, dark: result.tokens.dark.length },
    baselines: result.baselines,
    map: { file: result.mapFile, written: result.mapWritten },
  });
  ctx.out.line(`out: ${display}`);
  ctx.out.line(`tokens: ${result.tokens.light.length} (${result.tokens.dark.length} dark)`);
  ctx.out.line(`screens: ${result.screens}, baselines: ${result.baselines}`);
  if (result.mapWritten) ctx.out.line(`map: ${result.mapFile} (starter written)`);
  ctx.out.line(`next: rshow compare --against ${display} --map ${result.mapFile}`);
}
