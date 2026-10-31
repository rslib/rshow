import process from 'node:process';
import { TOKEN_PREFIX } from 'rshow-shared';
import { parseCommandArgs, stringValue } from '../args.ts';
import { Client } from '../client.ts';
import { requireUrl } from '../config.ts';
import type { Ctx } from '../context.ts';
import { ApiError, UsageError } from '../exit.ts';
import { choose } from '../tokenstore.ts';
import { LOGIN_USAGE } from '../usage.ts';

async function hiddenLine(): Promise<string> {
  process.stderr.write('token: ');
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise<string>((resolve, reject) => {
    let text = '';
    const finish = (err?: UsageError): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      if (err === undefined) resolve(text);
      else reject(err);
    };
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === '\u0003') {
          finish(new UsageError('login aborted'));
          return;
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u007f' || char === '\b') text = text.slice(0, -1);
        else if (char >= ' ') text += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function pipedText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function tokenFromStdin(): Promise<string> {
  const token = process.stdin.isTTY === true ? await hiddenLine() : await pipedText();
  if (token === '') throw new UsageError('expected a token on stdin');
  if (!token.startsWith(TOKEN_PREFIX)) throw new UsageError(`that is not an rshow token: it must start with ${TOKEN_PREFIX}`);
  return token;
}

export async function run(argv: string[], ctx: Ctx, platform: string = process.platform): Promise<void> {
  const args = parseCommandArgs(argv, { url: { type: 'string' } }, 0, 0, LOGIN_USAGE);
  const settings = await ctx.config();
  const given = (stringValue(args, 'url') ?? '').trim();
  const url = (given === '' ? requireUrl(settings) : given).replace(/\/+$/, '');
  const token = await tokenFromStdin();

  const me = (await new Client(url, token).send('GET', '/api/me')).body;
  const email = typeof me?.email === 'string' ? me.email : '';
  const scope = typeof me?.scope === 'string' ? me.scope : '';

  const store = await choose(process.env, platform);
  await store.save(url, token);
  if ((await store.read(url)) !== token) {
    throw new ApiError(`cannot save the token in ${store.description}`);
  }
  ctx.out.data({ email, scope, url });
  ctx.out.line(`logged in as ${email} (scope ${scope}) for ${url}, saved in ${store.description}`);
}
