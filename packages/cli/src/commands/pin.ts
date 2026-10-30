import { parseCommandArgs } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import { PIN_USAGE } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, {}, 2, 2, PIN_USAGE);
  const slug = validateSlug(args.positionals[0] as string);
  const target = args.positionals[1] as string;
  let pinned: number | null;
  if (target === 'live') {
    pinned = null;
  } else {
    if (!/^[0-9]+$/.test(target) || Number(target) < 1) {
      throw new UsageError(`expected a version number or live, got: ${target}`);
    }
    pinned = Number(target);
  }

  const api = await ctx.api();
  const artifact = await api.patchArtifact(slug, { pinned });
  ctx.out.data(artifact);
  ctx.out.line(`slug: ${slug}`);
  ctx.out.line(`pinned: ${pinned === null ? 'live' : pinned}`);
  ctx.out.line(`served: ${artifact.served === null || artifact.served === undefined ? '-' : artifact.served}`);
}
