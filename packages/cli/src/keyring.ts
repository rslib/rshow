import process from 'node:process';
import { runTool, toolFailure } from './tool.ts';

export const SERVICE = 'rshow';
const PROBE_SERVICE = 'rshow-probe';
const PROBE_ACCOUNT = 'probe';
const NOT_FOUND = 1;

type Env = Record<string, string | undefined>;

function bin(env: Env): string {
  const set = (env.RSHOW_SECRET_TOOL_BIN ?? '').trim();
  return set === '' ? 'secret-tool' : set;
}

// RSHOW_SECRET_TOOL_BIN stands in for a desktop keyring in a test, on any
// system.
export function canUse(env: Env, platform: string = process.platform): boolean {
  return platform === 'linux' || (env.RSHOW_SECRET_TOOL_BIN ?? '').trim() !== '';
}

// secret-tool exits 0 for a secret it found and 1 for one it does not have, so
// both mean the Secret Service answered; a D-Bus failure exits with a message.
export async function usable(env: Env = process.env): Promise<boolean> {
  const args = ['lookup', 'service', PROBE_SERVICE, 'account', PROBE_ACCOUNT];
  const result = await runTool(bin(env), args, undefined, env);
  return !result.absent && (result.code === 0 || result.code === NOT_FOUND);
}

// The token goes to secret-tool on stdin, never in argv, where ps sees it.
export async function save(url: string, token: string, env: Env = process.env): Promise<void> {
  const args = ['store', '--label', `rshow ${url}`, 'service', SERVICE, 'account', url];
  const result = await runTool(bin(env), args, token, env);
  if (result.code !== 0) throw toolFailure('cannot save the token in the keyring', result, token);
  if ((await read(url, env)) !== token) {
    throw toolFailure('cannot save the token in the keyring', result, token);
  }
}

export async function read(url: string, env: Env = process.env): Promise<string | undefined> {
  const args = ['lookup', 'service', SERVICE, 'account', url];
  const result = await runTool(bin(env), args, undefined, env);
  if (result.absent || result.code === NOT_FOUND) return undefined;
  if (result.code !== 0) throw toolFailure('cannot read the token from the keyring', result);
  const token = result.stdout.trim();
  return token === '' ? undefined : token;
}

export async function remove(url: string, env: Env = process.env): Promise<boolean> {
  const args = ['clear', 'service', SERVICE, 'account', url];
  const result = await runTool(bin(env), args, undefined, env);
  if (result.absent || result.code === NOT_FOUND) return false;
  if (result.code !== 0) throw toolFailure('cannot remove the token from the keyring', result);
  return true;
}
