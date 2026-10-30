import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {
  DATA_KEY_PATTERN,
  MAX_DATA_BYTES,
  MAX_DATA_KEYS,
  MAX_SKETCH_DATA_BYTES,
  SKETCH_DATA_KEY_PREFIX,
  THEME_VERSION_PATTERN,
} from 'rshow-shared';
import { ApiError } from './exit.ts';
import { contentTypeFor } from './files.ts';
import { buildPreset, builtinThemeDir, readThemeJson } from './themes.ts';
import { warn } from './warn.ts';

export type PreviewOptions = {
  dir: string;
  art?: string;
  port: number;
  host?: string;
  offline?: boolean;
  theme?: string;
  // 'theme' serves the --theme folder as the root too, which is what
  // `rshow theme preview` wants: the built theme folder is the whole site.
  root?: 'dir' | 'theme';
  reload?: boolean;
};

export type Preview = { url: string; port: number; close: () => Promise<void> };

const PROXY_PREFIX = '/_themes/';
const DATA_SEGMENT = '_data';
const EVENTS_PATH = '/_rshow/events';
const RELOAD_SCRIPT_PATH = '/_rshow/reload.js';
const RELOAD_TAG = '<script src="/_rshow/reload.js"></script>';
const RELOAD_SCRIPT = `(function () {
  if (typeof EventSource === 'undefined') {
    return;
  }
  var source = new EventSource('/_rshow/events');
  source.onmessage = function () {
    location.reload();
  };
})();
`;
const PREVIEW_USER = 'preview';
const DEBOUNCE_MS = 100;
const TEXT_TYPE = 'text/plain; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const SCRIPT_TYPE = 'text/javascript; charset=utf-8';

type ThemeSource = {
  name: string;
  source: string;
  built: string;
  label: 'local' | 'preset';
};

type StoredValue = { text: string; updated_at: string; updated_by: string };

type ResolvedTheme = { kind: 'local'; root: string; label: 'local' | 'preset' } | { kind: 'proxy' };

type DataStore = {
  get: (key: string) => StoredValue | undefined;
  count: () => number;
  write: (key: string, text: string) => Promise<{ etag: string; updated_at: string }>;
  close: () => Promise<void>;
};

type Session = {
  root: string;
  art: string;
  offline: boolean;
  reload: boolean;
  theme: ThemeSource | undefined;
  store: DataStore;
  clients: Set<ServerResponse>;
  builtin: Map<string, string | undefined>;
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function etagOf(text: string): string {
  return `"${createHash('sha256').update(text).digest('hex')}"`;
}

function etagMatches(ifMatch: string | null, etag: string): boolean {
  if (ifMatch === null) return false;
  return ifMatch
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === '*' || part === etag || part === `W/${etag}`);
}

function parseValue(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function dataLimit(key: string): number {
  return key.startsWith(SKETCH_DATA_KEY_PREFIX) ? MAX_SKETCH_DATA_BYTES : MAX_DATA_BYTES;
}

function jsonReply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': JSON_TYPE, 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, message: string, status: number): void {
  jsonReply(res, status, { error: message });
}

async function resolveFile(root: string, pathname: string): Promise<string | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0')) return undefined;
  const target = path.resolve(root, decoded.replace(/^\/+/, ''));
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;

  const info = await stat(target).catch(() => undefined);
  if (info === undefined) return undefined;
  if (info.isFile()) return target;
  if (!info.isDirectory()) return undefined;
  const index = path.join(target, 'index.html');
  const indexInfo = await stat(index).catch(() => undefined);
  if (indexInfo === undefined || !indexInfo.isFile()) return undefined;
  return index;
}

async function proxy(
  art: string,
  pathname: string,
  method: string,
  res: ServerResponse,
): Promise<void> {
  let reply: Response;
  try {
    reply = await fetch(art + pathname, { method: method === 'HEAD' ? 'HEAD' : 'GET' });
  } catch (err) {
    res.writeHead(502, { 'content-type': TEXT_TYPE, 'x-rshow-source': 'proxy' });
    res.end(`proxy error: ${messageOf(err)}\n`);
    return;
  }
  const body = Buffer.from(await reply.arrayBuffer());
  const headers: Record<string, string> = { 'x-rshow-source': 'proxy' };
  const type = reply.headers.get('content-type');
  if (type !== null) headers['content-type'] = type;
  const cache = reply.headers.get('cache-control');
  if (cache !== null) headers['cache-control'] = cache;
  res.writeHead(reply.status, headers);
  res.end(method === 'HEAD' ? undefined : body);
}

// ------------------------------------------------------------------ themes ---

async function prepareTheme(dir: string): Promise<ThemeSource> {
  const doc = await readThemeJson(dir);
  const declared = typeof doc.json.name === 'string' ? doc.json.name.trim() : '';
  const name = declared === '' ? path.basename(dir) : declared;
  const base = typeof doc.json.extends === 'string' ? doc.json.extends.trim() : '';
  if (base === '') return { name, source: dir, built: dir, label: 'local' };
  const built = await mkdtemp(path.join(tmpdir(), 'rshow-theme-'));
  await buildPreset(dir, built);
  return { name, source: dir, built, label: 'preset' };
}

async function resolveTheme(session: Session, name: string): Promise<ResolvedTheme | undefined> {
  if (session.theme !== undefined && session.theme.name === name) {
    return { kind: 'local', root: session.theme.built, label: session.theme.label };
  }
  let builtin = session.builtin.get(name);
  if (builtin === undefined && !session.builtin.has(name)) {
    builtin = await builtinThemeDir(name);
    session.builtin.set(name, builtin);
  }
  if (builtin !== undefined) return { kind: 'local', root: builtin, label: 'local' };
  if (session.art !== '' && !session.offline) return { kind: 'proxy' };
  return undefined;
}

function redirectTheme(res: ServerResponse, segment: string, search: string): void {
  res.writeHead(301, { location: `${PROXY_PREFIX}${segment}/${search}` });
  res.end();
}

async function serveTheme(
  res: ServerResponse,
  method: string,
  session: Session,
  raw: string,
  pathname: string,
  segment: string,
  name: string,
): Promise<void> {
  const rest = pathname.slice(PROXY_PREFIX.length);
  const resolved = await resolveTheme(session, name);
  if (resolved === undefined) {
    res.writeHead(404, { 'content-type': TEXT_TYPE });
    res.end(method === 'HEAD' ? undefined : `theme ${name} is not on disk and no art host is set\n`);
    return;
  }
  if (resolved.kind === 'proxy') {
    await proxy(session.art, raw, method, res);
    return;
  }
  const rel = rest.slice(segment.length).replace(/^\/+/, '');
  const target = await resolveFile(resolved.root, `/${rel}`);
  if (target === undefined) {
    res.writeHead(404, { 'content-type': TEXT_TYPE, 'x-rshow-source': resolved.label });
    res.end(method === 'HEAD' ? undefined : 'not found\n');
    return;
  }
  await sendFile(res, method, session, target, { 'x-rshow-source': resolved.label });
}

async function handleTheme(
  req: IncomingMessage,
  res: ServerResponse,
  session: Session,
  raw: string,
  pathname: string,
  method: string,
): Promise<void> {
  const rest = pathname.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  const segment = slash < 0 ? rest : rest.slice(0, slash);
  const match = THEME_VERSION_PATTERN.exec(segment);
  if (match === null) {
    // /_themes/<name>.json and anything else stays a proxy concern.
    if (session.art !== '' && !session.offline) {
      await proxy(session.art, raw, method, res);
      return;
    }
    res.writeHead(404, { 'content-type': TEXT_TYPE });
    res.end(method === 'HEAD' ? undefined : 'not found\n');
    return;
  }
  const name = match[1] as string;
  if (slash < 0) {
    const search = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
    if ((await resolveTheme(session, name)) !== undefined) {
      redirectTheme(res, segment, search);
      return;
    }
  }
  await serveTheme(res, method, session, raw, pathname, segment, name);
}

// -------------------------------------------------------------- data store ---

// The store is in memory for the session and mirrored to a JSON file in a temp
// dir, so a page reload finds what the scripts wrote and nothing outlives the run.
function createDataStore(): DataStore {
  const values = new Map<string, StoredValue>();
  let dir: string | undefined;

  const persist = async (): Promise<void> => {
    if (dir === undefined) dir = await mkdtemp(path.join(tmpdir(), 'rshow-data-'));
    const doc = Object.fromEntries(values);
    await writeFile(path.join(dir, 'data.json'), `${JSON.stringify(doc, null, 2)}\n`);
  };

  return {
    get: (key) => values.get(key),
    count: () => values.size,
    write: async (key, text) => {
      const updated_at = new Date().toISOString();
      values.set(key, { text, updated_at, updated_by: PREVIEW_USER });
      await persist();
      return { etag: etagOf(text), updated_at };
    },
    close: async () => {
      if (dir === undefined) return;
      await rm(dir, { recursive: true, force: true });
      dir = undefined;
    },
  };
}

function dataKeyOf(pathname: string): string | undefined {
  const cut = pathname.lastIndexOf('/');
  if (cut <= 0) return undefined;
  if (!pathname.slice(0, cut).endsWith(`/${DATA_SEGMENT}`)) return undefined;
  let key: string;
  try {
    key = decodeURIComponent(pathname.slice(cut + 1));
  } catch {
    return undefined;
  }
  return DATA_KEY_PATTERN.test(key) ? key : undefined;
}

// A body over the limit is dropped as it arrives, so a huge value costs no
// memory while the client still reads the 413.
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  let over = false;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    size += bytes.byteLength;
    if (size > limit) over = true;
    else chunks.push(bytes);
  }
  return over ? undefined : Buffer.concat(chunks);
}

function valueText(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

async function handleData(
  req: IncomingMessage,
  res: ServerResponse,
  store: DataStore,
  key: string,
  method: string,
): Promise<void> {
  if (method === 'GET' || method === 'HEAD') {
    const entry = store.get(key);
    if (entry === undefined) {
      jsonError(res, 'not found', 404);
      return;
    }
    const body = JSON.stringify({
      value: parseValue(entry.text),
      updated_at: entry.updated_at,
      updated_by: entry.updated_by,
    });
    res.writeHead(200, {
      'content-type': JSON_TYPE,
      'cache-control': 'no-store',
      etag: etagOf(entry.text),
    });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }
  if (method !== 'PUT') {
    res.writeHead(405, { allow: 'GET, HEAD, PUT', 'content-type': TEXT_TYPE });
    res.end('method not allowed\n');
    return;
  }

  const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    jsonError(res, 'expected application/json', 415);
    return;
  }
  const limit = dataLimit(key);
  const body = await readBody(req, limit);
  if (body === undefined) {
    jsonError(res, 'value too large', 413);
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch {
    jsonError(res, 'expected a JSON body', 400);
    return;
  }
  if (!isRecord(parsed) || !('value' in parsed)) {
    jsonError(res, 'expected {value}', 400);
    return;
  }
  const text = valueText(parsed.value);
  const existing = store.get(key);
  const ifMatch = req.headers['if-match'] ?? null;
  if (ifMatch !== null && ifMatch.trim() !== '') {
    if (existing === undefined || !etagMatches(ifMatch, etagOf(existing.text))) {
      jsonError(res, 'etag mismatch', 409);
      return;
    }
  }
  if (existing === undefined && store.count() >= MAX_DATA_KEYS) {
    jsonError(res, 'too many keys for this artifact', 409);
    return;
  }
  if (Buffer.byteLength(text) > limit) {
    jsonError(res, 'value too large', 413);
    return;
  }
  const written = await store.write(key, text);
  jsonReply(res, 200, { ok: true, key, updated_at: written.updated_at }, { etag: written.etag });
}

// ------------------------------------------------------------ live reload ---

function subscribe(res: ServerResponse, session: Session): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  res.write('retry: 200\n\n');
  session.clients.add(res);
  res.on('close', () => {
    session.clients.delete(res);
  });
}

function broadcast(session: Session): void {
  const frame = `data: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`;
  for (const client of session.clients) client.write(frame);
}

function injectReload(html: string): string {
  const close = /<\/body\s*>/gi;
  let at = -1;
  for (let found = close.exec(html); found !== null; found = close.exec(html)) at = found.index;
  if (at < 0) return `${html}${RELOAD_TAG}\n`;
  return `${html.slice(0, at)}${RELOAD_TAG}\n${html.slice(at)}`;
}

async function sendFile(
  res: ServerResponse,
  method: string,
  session: Session,
  file: string,
  headers: Record<string, string> = {},
): Promise<void> {
  const bytes = await readFile(file);
  const type = contentTypeFor(file);
  const all = { 'content-type': type, 'cache-control': 'no-store', ...headers };
  if (method === 'HEAD') {
    res.writeHead(200, all);
    res.end();
    return;
  }
  const inject = session.reload && type.startsWith('text/html');
  res.writeHead(200, all);
  res.end(inject ? injectReload(bytes.toString('utf8')) : bytes);
}

type WatchTarget = { dir: string; rebuild: boolean };

function startWatchers(session: Session, targets: readonly WatchTarget[]): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  for (const target of targets) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fire = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        const theme = session.theme;
        const rebuild = target.rebuild && theme !== undefined && theme.label === 'preset';
        const done = rebuild ? buildPreset(theme.source, theme.built) : Promise.resolve();
        done.then(
          () => broadcast(session),
          (err: unknown) => warn(`cannot rebuild ${target.dir}: ${messageOf(err)}`),
        );
      }, DEBOUNCE_MS);
      timer.unref();
    };
    try {
      const watcher = watch(target.dir, { recursive: true }, fire);
      watcher.on('error', () => undefined);
      watchers.push(watcher);
    } catch (err) {
      warn(`cannot watch ${target.dir}: ${messageOf(err)}`);
    }
  }
  return watchers;
}

// ---------------------------------------------------------------- the server ---

async function handle(req: IncomingMessage, res: ServerResponse, session: Session): Promise<void> {
  const method = req.method ?? 'GET';
  const raw = req.url ?? '/';
  const cut = raw.indexOf('?');
  const pathname = cut < 0 ? raw : raw.slice(0, cut);

  const key = dataKeyOf(pathname);
  if (key !== undefined) {
    await handleData(req, res, session.store, key, method);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': TEXT_TYPE });
    res.end('method not allowed\n');
    return;
  }

  if (pathname === EVENTS_PATH) {
    subscribe(res, session);
    return;
  }
  if (pathname === RELOAD_SCRIPT_PATH) {
    res.writeHead(200, { 'content-type': SCRIPT_TYPE, 'cache-control': 'no-store' });
    res.end(method === 'HEAD' ? undefined : RELOAD_SCRIPT);
    return;
  }
  if (pathname.startsWith(PROXY_PREFIX)) {
    await handleTheme(req, res, session, raw, pathname, method);
    return;
  }

  const file = await resolveFile(session.root, pathname);
  if (file === undefined) {
    res.writeHead(404, { 'content-type': TEXT_TYPE });
    res.end(method === 'HEAD' ? undefined : 'not found\n');
    return;
  }
  await sendFile(res, method, session, file);
}

export function closeOnSignals(preview: Preview): void {
  const stop = (): void => {
    preview
      .close()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

export async function startPreview(opts: PreviewOptions): Promise<Preview> {
  const dir = path.resolve(opts.dir);
  const art = (opts.art ?? '').replace(/\/+$/, '');
  const host = opts.host ?? '127.0.0.1';
  const theme = opts.theme === undefined ? undefined : await prepareTheme(path.resolve(opts.theme));
  const root = opts.root === 'theme' && theme !== undefined ? theme.built : dir;

  const session: Session = {
    root,
    art,
    offline: opts.offline === true,
    reload: opts.reload !== false,
    theme,
    store: createDataStore(),
    clients: new Set(),
    builtin: new Map(),
  };

  const targets: WatchTarget[] = [{ dir: root, rebuild: false }];
  if (theme !== undefined && theme.source !== root) targets.push({ dir: theme.source, rebuild: true });
  const watchers = startWatchers(session, targets);

  const server = createServer((req, res) => {
    handle(req, res, session).catch((err) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': TEXT_TYPE });
      res.end(`error: ${messageOf(err)}\n`);
    });
  });

  const cleanup = async (): Promise<void> => {
    for (const watcher of watchers) watcher.close();
    for (const client of session.clients) client.end();
    session.clients.clear();
    await session.store.close();
    if (theme !== undefined && theme.built !== theme.source) {
      await rm(theme.built, { recursive: true, force: true });
    }
  };

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(opts.port, host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (err) {
    await cleanup();
    throw new ApiError(`cannot listen on ${host}:${opts.port}: ${messageOf(err)}`);
  }

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : opts.port;
  return {
    url: `http://${host}:${port}`,
    port,
    close: async () => {
      await cleanup();
      await new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
