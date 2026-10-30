import { parseCommandArgs, stringList } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import { normalizeTags, tagsOf, withTags } from '../tags.ts';
import { TAG_USAGE, usageLine } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    { add: { type: 'string', multiple: true }, remove: { type: 'string', multiple: true } },
    1,
    1,
    TAG_USAGE,
  );
  const slug = validateSlug(args.positionals[0] as string);
  const add = normalizeTags(stringList(args, 'add'));
  const remove = normalizeTags(stringList(args, 'remove'));
  if (add.length === 0 && remove.length === 0) {
    throw new UsageError(`nothing to change (try: ${usageLine(TAG_USAGE)})`);
  }

  const api = await ctx.api();
  const current = await api.artifact(slug);
  const tags = withTags(tagsOf(current?.tags), add, remove);
  const artifact = await api.patchArtifact(slug, { tags });

  ctx.out.data({ artifact, tags });
  ctx.out.line(`slug: ${slug}`);
  ctx.out.line(`tags: ${tags.length === 0 ? '-' : tags.join(' ')}`);
}
