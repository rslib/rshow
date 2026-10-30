import { stat } from 'node:fs/promises';
import path from 'node:path';
import { boolValue, parseCommandArgs } from '../args.ts';
import { checkFolder, reportCheck } from '../check.ts';
import type { Ctx } from '../context.ts';
import { EXIT, UsageError } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import { CHECK_USAGE } from '../usage.ts';
import { warn } from '../warn.ts';

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(
    argv,
    { offline: { type: 'boolean' }, 'no-style': { type: 'boolean' } },
    1,
    1,
    CHECK_USAGE,
  );
  const input = args.positionals[0] as string;
  const dir = path.resolve(input);
  const info = await stat(dir).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw new UsageError(`no such folder: ${input}`);

  const config = await ctx.config(dir);
  const offline = boolValue(args, 'offline');
  const art = config.art;
  if (art === undefined && !offline) warn('no art host configured; skipping theme checks');
  const result = await checkFolder(dir, {
    art,
    offline: offline || art === undefined,
    style: !boolValue(args, 'no-style'),
  });

  ctx.out.data({
    errors: result.errors,
    warnings: result.warnings,
    files: result.files,
    bytes: result.bytes,
    findings: result.findings,
  });
  reportCheck(ctx.out, result);
  return result.errors > 0 ? EXIT.check : EXIT.ok;
}
