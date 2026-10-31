import process from 'node:process';
import { UsageError } from './exit.ts';
import { runTool, toolFailure } from './tool.ts';

export const SERVICE = 'rshow';

const MISSING = 44;

type Env = Record<string, string | undefined>;

function bin(env: Env): string {
  const set = (env.RSHOW_SECURITY_BIN ?? '').trim();
  return set === '' ? 'security' : set;
}

// RSHOW_SECURITY_BIN stands in for the keychain in a test, on any system.
export function canSave(
  platform: string = process.platform,
  securityBin: string | undefined = process.env.RSHOW_SECURITY_BIN,
): boolean {
  return platform === 'darwin' || (securityBin ?? '').trim() !== '';
}

// The token goes to `security -i` on stdin, so that it never shows up in argv
// where ps sees it, and never in a shell history.
export async function save(url: string, token: string, env: Env = process.env): Promise<void> {
  if (!canSave(process.platform, env.RSHOW_SECURITY_BIN)) {
    throw new UsageError('the keychain needs macOS; set RSHOW_TOKEN instead');
  }
  const line = `add-generic-password -U -s ${SERVICE} -a ${url} -w ${token}\n`;
  const result = await runTool(bin(env), ['-i'], line, env);
  if (result.code !== 0) throw toolFailure('cannot save the token in the keychain', result, token);
  if ((await read(url, env)) !== token) {
    throw toolFailure('cannot save the token in the keychain', result, token);
  }
}

export async function read(url: string, env: Env = process.env): Promise<string | undefined> {
  if (!canSave(process.platform, env.RSHOW_SECURITY_BIN)) return undefined;
  const args = ['find-generic-password', '-s', SERVICE, '-a', url, '-w'];
  const result = await runTool(bin(env), args, undefined, env);
  if (result.absent || result.code === MISSING) return undefined;
  if (result.code !== 0) throw toolFailure('cannot read the token from the keychain', result);
  const token = result.stdout.trim();
  return token === '' ? undefined : token;
}

export async function remove(url: string, env: Env = process.env): Promise<boolean> {
  if (!canSave(process.platform, env.RSHOW_SECURITY_BIN)) return false;
  const args = ['delete-generic-password', '-s', SERVICE, '-a', url];
  const result = await runTool(bin(env), args, undefined, env);
  if (result.absent || result.code === MISSING) return false;
  if (result.code !== 0) throw toolFailure('cannot remove the token from the keychain', result);
  return true;
}
