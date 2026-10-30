import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { ApiError, UsageError } from './exit.ts';

export const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  'google-chrome',
  'chromium',
  'chromium-browser',
];

const DEVTOOLS_URL = /DevTools listening on (ws:\/\/\S+)/;
const REQUEST_TIMEOUT_MS = 60000;
const LOAD_TIMEOUT_MS = 20000;

// Chrome outlives us when the CLI dies early (Ctrl+C, SIGTERM, an uncaught
// error), so every launch is tracked and the whole set is reaped from the
// process hooks: leaving a headless browser and its temp profile behind is a
// leak nobody notices until the machine complains.
const liveBrowsers = new Map<ChildProcess, string>();
let signalHandlersInstalled = false;

// Chrome runs in its own process group, so one signal to the group also stops
// the renderer and GPU helpers, which otherwise keep writing to the profile.
function killBrowser(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

const PROFILE_REMOVE = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;

function reapBrowsers(): void {
  const browsers = [...liveBrowsers];
  liveBrowsers.clear();
  for (const [child, profile] of browsers) {
    killBrowser(child, 'SIGKILL');
    try {
      rmSync(profile, PROFILE_REMOVE);
    } catch {}
  }
  dropSignalHandlers();
}

function onInterrupt(): void {
  reapBrowsers();
  process.exit(130);
}

function onTerminate(): void {
  reapBrowsers();
  process.exit(143);
}

function dropSignalHandlers(): void {
  if (!signalHandlersInstalled) return;
  signalHandlersInstalled = false;
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
}

function trackBrowser(child: ChildProcess, profile: string): void {
  liveBrowsers.set(child, profile);
  if (!signalHandlersInstalled) {
    signalHandlersInstalled = true;
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
  }
}

function forgetBrowser(child: ChildProcess): void {
  liveBrowsers.delete(child);
  if (liveBrowsers.size === 0) dropSignalHandlers();
}

let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once('exit', reapBrowsers);
}

export type Clip = { x: number; y: number; width: number; height: number };

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function whichInPath(name: string, pathValue: string | undefined): string | undefined {
  for (const dir of String(pathValue ?? '').split(path.delimiter)) {
    if (dir === '') continue;
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

export function findChrome(env: Record<string, string | undefined> = process.env): string | undefined {
  const explicit = (env.CHROME ?? '').trim();
  if (explicit !== '') {
    if (existsSync(explicit)) return explicit;
    const found = whichInPath(explicit, env.PATH);
    if (found !== undefined) return found;
    throw new UsageError(`CHROME is set but not found: ${explicit}`);
  }
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.startsWith('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const found = whichInPath(candidate, env.PATH);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

type Pending = { resolve: (value: any) => void; reject: (err: Error) => void };
type Listener = (message: any) => void;

export class Connection {
  socket: WebSocket;
  nextId: number;
  pending: Map<number, Pending>;
  listeners: Listener[];

  constructor(socket: WebSocket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    socket.addEventListener('message', (event: MessageEvent) => {
      const text = typeof event.data === 'string' ? event.data : '';
      if (text === '') return;
      let message: any;
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof message.id === 'number') {
        const waiting = this.pending.get(message.id);
        if (waiting === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) waiting.reject(new ApiError(String(message.error?.message ?? 'protocol error')));
        else waiting.resolve(message.result);
        return;
      }
      for (const listener of [...this.listeners]) listener(message);
    });
    socket.addEventListener('close', () => {
      for (const waiting of this.pending.values()) waiting.reject(new ApiError('chrome devtools closed'));
      this.pending.clear();
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId;
    this.nextId += 1;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ApiError(`chrome devtools did not answer ${method}`));
      }, REQUEST_TIMEOUT_MS);
      const done = (fn: (value: any) => void) => (value: any): void => {
        clearTimeout(timer);
        fn(value);
      };
      this.pending.set(id, { resolve: done(resolve), reject: done(reject) });
      try {
        this.socket.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new ApiError(`chrome devtools send failed: ${messageOf(err)}`));
      }
    });
  }

  onMessage(listener: Listener): void {
    this.listeners.push(listener);
  }

  removeListener(listener: Listener): void {
    this.listeners = this.listeners.filter((item) => item !== listener);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      this.listeners = [];
    }
  }
}

async function connect(url: string, timeoutMs = 20000): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        socket.close();
      } catch {}
      reject(new ApiError('chrome devtools did not answer'));
    }, timeoutMs);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer);
        reject(new ApiError('cannot reach chrome devtools'));
      },
      { once: true },
    );
  });
}

function devtoolsUrlOf(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new ApiError('chrome did not open a devtools port'));
    }, timeoutMs);
    const onData = (chunk: string): void => {
      buffered += chunk;
      const found = DEVTOOLS_URL.exec(buffered);
      if (found === null) return;
      cleanup();
      resolve(found[1] as string);
    };
    const onExit = (code: number | null): void => {
      cleanup();
      reject(new ApiError(`chrome exited before it was ready (${code === null ? 'signal' : code})`));
    };
    const onError = (err: Error): void => {
      cleanup();
      reject(new UsageError(`cannot run chrome: ${err.message}`));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
    };
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

export type ChromeOptions = { binary?: string; timeoutMs?: number };

export class Chrome {
  child: ChildProcess;
  connection: Connection;
  profile: string;
  binary: string;

  constructor(child: ChildProcess, connection: Connection, profile: string, binary: string) {
    this.child = child;
    this.connection = connection;
    this.profile = profile;
    this.binary = binary;
  }

  static async launch(opts: ChromeOptions = {}): Promise<Chrome> {
    const binary = opts.binary ?? findChrome();
    if (binary === undefined) throw new UsageError('no Chrome or Chromium found, set CHROME');
    const profile = await mkdtemp(path.join(tmpdir(), 'rshow-chrome-'));
    const child = spawn(
      binary,
      [
        '--headless=new',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--use-mock-keychain',
        '--password-store=basic',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--window-size=1440,900',
        'about:blank',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
    );
    installExitHook();
    trackBrowser(child, profile);
    try {
      const url = await devtoolsUrlOf(child, opts.timeoutMs ?? 30000);
      const socket = await connect(url);
      return new Chrome(child, new Connection(socket), profile, binary);
    } catch (err) {
      forgetBrowser(child);
      killBrowser(child, 'SIGKILL');
      await rm(profile, { recursive: true, force: true }).catch(() => {});
      if (err instanceof ApiError || err instanceof UsageError) throw err;
      throw new ApiError(`cannot start chrome: ${messageOf(err)}`);
    }
  }

  async close(): Promise<void> {
    try {
      await this.connection.send('Browser.close');
    } catch {}
    this.connection.close();
    killBrowser(this.child, 'SIGTERM');
    await delay(50);
    if (this.child.exitCode === null) killBrowser(this.child, 'SIGKILL');
    await rm(this.profile, PROFILE_REMOVE).catch(() => {});
    forgetBrowser(this.child);
  }
}

export class Page {
  connection: Connection;
  targetId: string;
  sessionId: string;

  constructor(connection: Connection, targetId: string, sessionId: string) {
    this.connection = connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  static async open(chrome: Chrome): Promise<Page> {
    const created = await chrome.connection.send('Target.createTarget', { url: 'about:blank' });
    const attached = await chrome.connection.send('Target.attachToTarget', {
      targetId: created.targetId,
      flatten: true,
    });
    const page = new Page(chrome.connection, created.targetId, attached.sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    return page;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return this.connection.send(method, params, this.sessionId);
  }

  waitForEvent(method: string, timeoutMs = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      const listener = (message: any): void => {
        if (message.sessionId !== this.sessionId || message.method !== method) return;
        clearTimeout(timer);
        this.connection.removeListener(listener);
        resolve(message.params);
      };
      const timer = setTimeout(() => {
        this.connection.removeListener(listener);
        reject(new ApiError(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.connection.onMessage(listener);
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
    });
    if (reply?.exceptionDetails !== undefined) {
      const text = reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? 'error';
      throw new ApiError(`page error: ${String(text).split('\n')[0]}`);
    }
    return reply?.result?.value as T;
  }

  async navigate(url: string): Promise<void> {
    const loaded = this.waitForEvent('Page.loadEventFired', LOAD_TIMEOUT_MS);
    try {
      const reply = await this.send('Page.navigate', { url });
      if (typeof reply?.errorText === 'string' && reply.errorText !== '') {
        throw new ApiError(`cannot open ${url}: ${reply.errorText}`);
      }
      await loaded;
    } catch (err) {
      loaded.catch(() => undefined);
      throw err;
    }
    await this.settle();
  }

  async settle(ms = 120): Promise<void> {
    await this.evaluate('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true').catch(
      () => undefined,
    );
    await delay(ms);
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width <= 500,
      screenWidth: width,
      screenHeight: height,
    });
  }

  async screenshot(clip?: Clip): Promise<Uint8Array> {
    const params: Record<string, unknown> = { format: 'png', captureBeyondViewport: clip !== undefined };
    if (clip !== undefined) {
      params.clip = {
        x: Math.max(0, clip.x),
        y: Math.max(0, clip.y),
        width: Math.max(1, clip.width),
        height: Math.max(1, clip.height),
        scale: 1,
      };
    }
    const reply = await this.send('Page.captureScreenshot', params);
    return new Uint8Array(Buffer.from(String(reply?.data ?? ''), 'base64'));
  }

  async close(): Promise<void> {
    await this.connection.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
  }
}
