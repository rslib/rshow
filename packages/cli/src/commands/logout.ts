import { parseCommandArgs, stringValue } from '../args.ts';
import { requireUrl } from '../config.ts';
import type { Ctx } from '../context.ts';
import * as keychain from '../keychain.ts';
import { LOGOUT_USAGE } from '../usage.ts';

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, { url: { type: 'string' } }, 0, 0, LOGOUT_USAGE);
  const settings = await ctx.config();
  const given = (stringValue(args, 'url') ?? '').trim();
  const url = (given === '' ? requireUrl(settings) : given).replace(/\/+$/, '');

  const removed = await keychain.remove(url);
  ctx.out.line(removed ? `logged out of ${url}` : `no saved token for ${url}`);
}
