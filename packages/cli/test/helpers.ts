import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../src/main.ts', import.meta.url));

export type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
};

export type RouteReply = { status: number; body?: unknown; text?: string; delayMs?: number };
export type Router = (req: RecordedRequest) => RouteReply | undefined;

export type FakeApi = {
  url: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
};

export async function startFakeApi(router: Router): Promise<FakeApi> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks),
      };
      requests.push(recorded);
      const reply = router(recorded) ?? { status: 404, body: { error: 'not found' } };
      send(res, reply);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function send(res: ServerResponse, reply: RouteReply): void {
  const body = reply.text !== undefined ? reply.text : reply.body === undefined ? '' : JSON.stringify(reply.body);
  const headers = body === '' ? {} : { 'content-type': 'application/json' };
  const flush = (): void => {
    res.writeHead(reply.status, headers);
    res.end(body);
  };
  if (reply.delayMs === undefined) flush();
  else setTimeout(flush, reply.delayMs);
}

export type CliResult = { code: number; stdout: string; stderr: string };

const tempDirs: string[] = [];

process.on('exit', () => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// A child never sees the real home, so a config file or keychain item on the
// machine that runs the tests cannot change their result.
const TEST_HOME = mkdtempSync(path.join(tmpdir(), 'rshow-home-'));
tempDirs.push(TEST_HOME);

function childEnvOf(env: Record<string, string>): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: TEST_HOME,
    // The system trust store belongs to the machine that runs the tests, and
    // reading it costs half a second on macOS.
    RSHOW_SYSTEM_CA: '0',
    ...env,
  };
}

export type RunOptions = { cwd?: string; input?: string };

export function runCli(
  args: string[],
  env: Record<string, string> = {},
  opts: RunOptions = {},
): Promise<CliResult> {
  const childEnv = childEnvOf(env);
  const spawnOptions: SpawnOptions = {
    env: childEnv,
    stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  };
  if (opts.cwd !== undefined) spawnOptions.cwd = opts.cwd;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], spawnOptions);
    const out = child.stdout;
    const err = child.stderr;
    if (out === null || err === null) {
      reject(new Error('child stdio was not piped'));
      return;
    }
    let stdout = '';
    let stderr = '';
    out.setEncoding('utf8');
    out.on('data', (chunk: string) => {
      stdout += chunk;
    });
    err.setEncoding('utf8');
    err.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (opts.input !== undefined && child.stdin !== null) child.stdin.end(opts.input);
  });
}

export type RunningCli = {
  stdout: () => string;
  stderr: () => string;
  waitFor: (match: RegExp, timeoutMs?: number) => Promise<string>;
  stop: () => Promise<number | null>;
};

export function startCli(
  args: string[],
  env: Record<string, string> = {},
  opts: RunOptions = {},
): RunningCli {
  const spawnOptions: SpawnOptions = { env: childEnvOf(env), stdio: ['ignore', 'pipe', 'pipe'] };
  if (opts.cwd !== undefined) spawnOptions.cwd = opts.cwd;
  const child = spawn(process.execPath, [CLI, ...args], spawnOptions);
  const out = child.stdout;
  const err = child.stderr;
  if (out === null || err === null) throw new Error('child stdio was not piped');
  let stdout = '';
  let stderr = '';
  out.setEncoding('utf8');
  out.on('data', (chunk: string) => {
    stdout += chunk;
  });
  err.setEncoding('utf8');
  err.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.on('error', () => {});
  const closed = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  const waitFor = async (match: RegExp, timeoutMs = 15000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = stdout.match(match);
      if (found !== null) return found[0];
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for ${match}: stdout ${JSON.stringify(stdout)} stderr ${JSON.stringify(stderr)}`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  };

  return {
    stdout: () => stdout,
    stderr: () => stderr,
    waitFor,
    stop: () => {
      child.kill('SIGTERM');
      return closed;
    },
  };
}

export async function tempDir(prefix = 'rshow-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

export async function makeTempDir(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await tempDir();
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return dir;
}

export function jsonBody(req: RecordedRequest): any {
  return JSON.parse(req.body.toString('utf8'));
}

export function artifact(slug: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug,
    title: slug,
    owner: 'owner@example.com',
    mode: 'private',
    pinned: null,
    latest: 1,
    served: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
    role: 'owner',
    project: null,
    tags: [],
    url: `https://art.example.com/${slug}/`,
    ...overrides,
  };
}
