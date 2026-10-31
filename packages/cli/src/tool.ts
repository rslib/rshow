import { spawn } from 'node:child_process';
import process from 'node:process';
import { ApiError } from './exit.ts';

export type Run = { code: number; stdout: string; stderr: string; absent: boolean };

type Env = Record<string, string | undefined>;

// The tool runs with the environment of rshow, plus what the caller set: a
// test narrows it to a stand-in binary and the variables that drive it.
function childEnv(env: Env | undefined): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(env ?? {})) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out;
}

// A tool that is not installed is not a failure: `security` is macOS only and
// `secret-tool` is an optional package, so a missing binary reports absent and
// the caller picks another store.
export function runTool(bin: string, args: string[], input?: string, env?: Env): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv(env) });
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
      else reject(new ApiError(`${bin}: ${err.message}`));
    });
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr, absent: false }));
    child.stdin.end(input ?? '');
  });
}

// The detail of a failed call, with the token taken out of it, in case a tool
// echoes what it was given on stdin.
export function toolFailure(doing: string, result: Run, secret?: string): ApiError {
  const text = secret === undefined ? result.stderr : result.stderr.split(secret).join('[redacted]');
  const detail = text.trim();
  return new ApiError(`${doing}: ${detail === '' ? `exit ${result.code}` : detail}`);
}
