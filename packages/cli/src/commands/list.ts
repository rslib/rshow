import { parseCommandArgs, stringValue } from '../args.ts';
import type { ArtifactFilter } from '../client.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import { validateTag } from '../tags.ts';
import { LIST_USAGE, usageLine } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    { project: { type: 'string' }, tag: { type: 'string' }, q: { type: 'string' } },
    0,
    0,
    LIST_USAGE,
  );

  const filter: ArtifactFilter = {};
  const project = stringValue(args, 'project');
  if (project !== undefined) filter.project = validateSlug(project);
  const tag = stringValue(args, 'tag');
  if (tag !== undefined) filter.tag = validateTag(tag);
  const q = stringValue(args, 'q')?.trim();
  if (q !== undefined) {
    if (q === '') throw new UsageError(`--q needs text (try: ${usageLine(LIST_USAGE)})`);
    filter.q = q;
  }

  const api = await ctx.api();
  const reply = await api.artifacts(filter);
  const artifacts = Array.isArray(reply?.artifacts) ? reply.artifacts : [];
  ctx.out.data(reply);
  if (artifacts.length === 0) {
    ctx.out.line('no artifacts');
    return;
  }
  for (const artifact of artifacts) {
    const served = artifact.served === null || artifact.served === undefined ? '-' : `v${artifact.served}`;
    ctx.out.line(`${artifact.slug} ${artifact.mode} ${served} ${artifact.title}`);
  }
}
