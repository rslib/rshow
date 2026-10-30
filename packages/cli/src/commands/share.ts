import { emailList, parseCommandArgs, stringValue } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import { SHARE_USAGE, usageLine } from '../usage.ts';

const MODES = new Set(['private', 'people', 'public']);

type ShareChange = { email: string; role: 'viewer' | 'editor' };

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    {
      mode: { type: 'string' },
      add: { type: 'string', multiple: true },
      editor: { type: 'string', multiple: true },
      remove: { type: 'string', multiple: true },
    },
    1,
    1,
    SHARE_USAGE,
  );
  const slug = validateSlug(args.positionals[0] as string);
  const mode = stringValue(args, 'mode');
  if (mode !== undefined && !MODES.has(mode)) throw new UsageError(`unknown mode: ${mode}`);
  const changes: ShareChange[] = [
    ...emailList(args, 'add').map((email) => ({ email, role: 'viewer' as const })),
    ...emailList(args, 'editor').map((email) => ({ email, role: 'editor' as const })),
  ];
  const removals = emailList(args, 'remove');
  if (mode === undefined && changes.length === 0 && removals.length === 0) {
    throw new UsageError(`nothing to change (try: ${usageLine(SHARE_USAGE)})`);
  }

  const api = await ctx.api();
  const artifact = mode === undefined ? null : await api.patchArtifact(slug, { mode });
  const shares: any[] = [];
  for (const change of changes) {
    shares.push(await api.putShare(slug, change.email, change.role));
  }
  for (const email of removals) {
    await api.deleteShare(slug, email);
  }

  ctx.out.data({ artifact, shares, removed: removals });
  if (mode !== undefined) ctx.out.line(`mode: ${mode}`);
  for (const share of shares) ctx.out.line(`share ${share.email} ${share.role}`);
  for (const email of removals) ctx.out.line(`removed ${email}`);
}
