import { spawn } from 'node:child_process';
import process from 'node:process';
import { BuildError } from './exit.ts';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function shellPath(env: Record<string, string | undefined>): string {
  const shell = (env.SHELL ?? '').trim();
  return shell === '' ? '/bin/sh' : shell;
}

export async function runBuild(
  dir: string,
  command: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(shellPath(env), ['-c', command], { cwd: dir, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (value) => resolve(value));
  }).catch((err) => {
    throw new BuildError(`build failed: ${messageOf(err)}`);
  });
  if (code !== 0) {
    throw new BuildError(`build failed: ${code === null ? 'killed by a signal' : `exit ${code}`}`);
  }
}
