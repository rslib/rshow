import { spawn } from 'node:child_process';
import process from 'node:process';
import { ApiError, UsageError } from './exit.ts';

export const SERVICE = 'rshow';

const MISSING = 44;
const NO_MACOS = 'the keychain needs macOS; set RSHOW_TOKEN instead';

type Run = { code: number; stdout: string; stderr: string; absent: boolean };

function bin(): string {
  return process.env.RSHOW_SECURITY_BIN ?? 'security';
}

function usable(): boolean {
  return process.platform === 'darwin' || process.env.RSHOW_SECURITY_BIN !== undefined;
}

function run(args: string[], input?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.stdin.on('error', () => {});
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resolve({ code: -1, stdout, stderr, absent: true });
      else reject(new ApiError(`keychain: ${err.message}`));
    });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr, absent: false }));
    child.stdin.end(input ?? '');
  });
}

function failure(doing: string, result: Run, secret?: string): ApiError {
  const text = secret === undefined ? result.stderr : result.stderr.split(secret).join('[redacted]');
  const detail = text.trim();
  return new ApiError(`${doing}: ${detail === '' ? `exit ${result.code}` : detail}`);
}

// The token goes to `security -i` on stdin, so that it never shows up in argv
// where ps sees it, and never in a shell history.
export async function save(url: string, token: string): Promise<void> {
  if (!usable()) throw new UsageError(NO_MACOS);
  const line = `add-generic-password -U -s ${SERVICE} -a ${url} -w ${token}\n`;
  const result = await run(['-i'], line);
  if (result.code !== 0) throw failure('cannot save the token in the keychain', result, token);
  if ((await read(url)) !== token) throw failure('cannot save the token in the keychain', result, token);
}

export async function read(url: string): Promise<string | undefined> {
  if (!usable()) return undefined;
  const result = await run(['find-generic-password', '-s', SERVICE, '-a', url, '-w']);
  if (result.absent || result.code === MISSING) return undefined;
  if (result.code !== 0) throw failure('cannot read the token from the keychain', result);
  const token = result.stdout.trim();
  return token === '' ? undefined : token;
}

export async function remove(url: string): Promise<boolean> {
  if (!usable()) throw new UsageError(NO_MACOS);
  const result = await run(['delete-generic-password', '-s', SERVICE, '-a', url]);
  if (result.absent || result.code === MISSING) return false;
  if (result.code !== 0) throw failure('cannot remove the token from the keychain', result);
  return true;
}
