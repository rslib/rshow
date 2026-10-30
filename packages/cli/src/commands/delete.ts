import { boolValue, parseCommandArgs } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import { DELETE_USAGE, usageLine } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, { yes: { type: 'boolean' } }, 1, 1, DELETE_USAGE);
  const slug = validateSlug(args.positionals[0] as string);
  if (!boolValue(args, 'yes')) throw new UsageError(`delete needs --yes (try: ${usageLine(DELETE_USAGE)})`);
  const api = await ctx.api();
  await api.deleteArtifact(slug);
  ctx.out.data(null);
  ctx.out.line(`deleted: ${slug}`);
}
