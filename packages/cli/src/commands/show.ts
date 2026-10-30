import { parseCommandArgs } from '../args.ts';
import type { Ctx } from '../context.ts';
import { validateSlug } from '../slug.ts';
import { SHOW_USAGE } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, {}, 1, 1, SHOW_USAGE);
  const slug = validateSlug(args.positionals[0] as string);
  const api = await ctx.api();
  const reply = await api.artifact(slug);
  ctx.out.data(reply);

  const versions = Array.isArray(reply?.versions) ? reply.versions : [];
  const shares = Array.isArray(reply?.shares) ? reply.shares : [];
  ctx.out.line(`slug: ${reply.slug}`);
  ctx.out.line(`title: ${reply.title}`);
  ctx.out.line(`owner: ${reply.owner}`);
  ctx.out.line(`mode: ${reply.mode}`);
  ctx.out.line(`role: ${reply.role}`);
  ctx.out.line(`pinned: ${reply.pinned === null || reply.pinned === undefined ? 'live' : reply.pinned}`);
  ctx.out.line(`latest: ${reply.latest === null || reply.latest === undefined ? '-' : reply.latest}`);
  ctx.out.line(`served: ${reply.served === null || reply.served === undefined ? '-' : reply.served}`);
  ctx.out.line(`updated: ${reply.updated_at}`);
  ctx.out.line(`url: ${reply.url}`);
  ctx.out.line(`versions: ${versions.length}`);
  for (const version of versions) {
    const label = version.label === '' || version.label === undefined ? '-' : version.label;
    ctx.out.line(
      `v${version.n} ${label} ${version.created_by} ${version.created_at} ${version.files} files ${version.bytes} bytes ${version.url}`,
    );
  }
  ctx.out.line(`shares: ${shares.length}`);
  for (const share of shares) {
    ctx.out.line(`share ${share.email} ${share.role}`);
  }
}
