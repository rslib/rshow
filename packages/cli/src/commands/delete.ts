import { boolValue, parseCommandArgs, stringValue } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import { DELETE_USAGE, usageLine } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    { version: { type: 'string' }, force: { type: 'boolean' }, yes: { type: 'boolean' } },
    1,
    1,
    DELETE_USAGE,
  );
  const slug = validateSlug(args.positionals[0] as string);
  const raw = stringValue(args, 'version');
  let version: number | null = null;
  if (raw !== undefined) {
    if (!/^[0-9]+$/.test(raw) || Number(raw) < 1) {
      throw new UsageError(`expected a version number, got: ${raw}`);
    }
    version = Number(raw);
  }
  if (!boolValue(args, 'yes')) throw new UsageError(`delete needs --yes (try: ${usageLine(DELETE_USAGE)})`);

  const api = await ctx.api();
  const force = boolValue(args, 'force');
  if (version === null) {
    await api.deleteArtifact(slug, force);
    ctx.out.data(null);
    ctx.out.line(`deleted: ${slug}`);
    return;
  }

  const artifact = await api.deleteVersion(slug, version, force);
  ctx.out.data(artifact);
  ctx.out.line(`deleted: ${slug} v${version}`);
  ctx.out.line(`served: ${artifact?.served === null || artifact?.served === undefined ? '-' : artifact.served}`);
}
