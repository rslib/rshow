import process from 'node:process';
import { parseCommandArgs, stringValue } from '../args.ts';
import { requireUrl } from '../config.ts';
import type { Ctx } from '../context.ts';
import { every } from '../tokenstore.ts';
import { LOGOUT_USAGE } from '../usage.ts';

// Every store is tried, so that a switch of backend leaves no token behind.
export async function run(argv: string[], ctx: Ctx, platform: string = process.platform): Promise<void> {
  const args = parseCommandArgs(argv, { url: { type: 'string' } }, 0, 0, LOGOUT_USAGE);
  const settings = await ctx.config();
  const given = (stringValue(args, 'url') ?? '').trim();
  const url = (given === '' ? requireUrl(settings) : given).replace(/\/+$/, '');

  const removed: string[] = [];
  for (const store of await every(process.env, platform)) {
    if (await store.remove(url)) removed.push(store.description);
  }
  if (removed.length === 0) {
    ctx.out.line(`no saved token for ${url}`);
    return;
  }
  ctx.out.line(`logged out of ${url}, removed from ${removed.join(' and ')}`);
}
