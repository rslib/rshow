import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import katex from 'katex';
import { MAX_BLOB_BYTES, MAX_VERSION_BYTES, MAX_VERSION_FILES } from 'rshow-shared';
import { CheckError, UsageError } from './exit.ts';
import type { Output } from './output.ts';
import { mockupWarnings } from './mockup.ts';
import { networkDetail, readyNetwork } from './network.ts';
import { styleWarnings } from './style.ts';

export type Severity = 'error' | 'warning';

export type Finding = { path: string; line: number; severity: Severity; message: string };

export type CheckOptions = { art?: string; offline?: boolean; style?: boolean; fetchImpl?: typeof fetch };

export type CheckResult = {
  findings: Finding[];
  errors: number;
  warnings: number;
  files: number;
  bytes: number;
};

export type HtmlFacts = { viewport: boolean; title: boolean; slides: boolean; deckScript: boolean };

const SCAN_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs']);
const SKIPPED_NAMES = new Set(['node_modules']);
const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const BASE_URL = 'https://art.invalid/';
const SCRIPT_HOSTS = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'];
const STYLE_HOSTS = ['fonts.googleapis.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];
const VERSION_AT = /@[0-9]+\.[0-9]+\.[0-9]+/;
const VERSION_PATH = /\/[0-9]+\.[0-9]+\.[0-9]+\//;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const IGNORED = /^(?:#|data:|blob:|mailto:|tel:|javascript:)/i;
const THEME_REF = /^\/_themes\/([a-z0-9][a-z0-9-]*)@(latest|[0-9]+)\//;
const TAG_PATTERN = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_PATTERN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s]*))\s*\)/gi;
const CSS_IMPORT = /@import\s+(?:"([^"]*)"|'([^']*)')/gi;
// The name has to start the value or follow a /, so that xmath.js is no math.js.
const MATH_JS = /(?:^|\/)math\.js(?:[?#]|$)/i;
const MATH_CSS = /(?:^|\/)math\.css(?:[?#]|$)/i;

const CONNECT_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'fetch', pattern: /fetch\s*\(\s*["'`](https?:\/\/[^"'`\s)]+)/g },
  { name: 'new WebSocket', pattern: /new\s+WebSocket\s*\(\s*["'`](https?:\/\/[^"'`\s)]+)/g },
  { name: 'new EventSource', pattern: /new\s+EventSource\s*\(\s*["'`](https?:\/\/[^"'`\s)]+)/g },
  {
    name: 'XMLHttpRequest.open',
    pattern: /\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,\s*["'`](https?:\/\/[^"'`\s)]+)/g,
  },
];

type Entry = { rel: string; abs: string; size: number };

type Where = { file: string; line: number };

type ThemeRef = Where & { files: Map<string, Where> };

type Scan = {
  files: Set<string>;
  findings: Finding[];
  art: string;
  offline: boolean;
  fetchImpl: typeof fetch;
  themes: Map<string, ThemeRef>;
};

function add(scan: Scan, file: string, line: number, severity: Severity, message: string): void {
  scan.findings.push({ path: file, line, severity, message });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
}

export function pathProblem(rel: string): string | undefined {
  if (rel.includes('\\')) return 'path has a backslash';
  if (rel.split('/').some((segment) => segment === '..')) return 'path has a .. segment';
  return undefined;
}

function lineFinder(text: string): (index: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0x0a) starts.push(i + 1);
  }
  return (index: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] as number) <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

function maskComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, (match) => match.replace(/[^\n]/g, ' '));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function attributes(raw: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of raw.matchAll(ATTR_PATTERN)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === '' || found.has(name)) continue;
    found.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return found;
}

function hostOf(value: string): string | undefined {
  if (!EXTERNAL.test(value) || IGNORED.test(value)) return undefined;
  try {
    const host = new URL(value, BASE_URL).hostname;
    return host === '' ? undefined : host.toLowerCase();
  } catch {
    return undefined;
  }
}

function pathnameOf(value: string): string {
  try {
    return new URL(value, BASE_URL).pathname;
  } catch {
    return value;
  }
}

function resolvePath(file: string, ref: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(ref);
  } catch {
    decoded = ref;
  }
  const wantsIndex = decoded.endsWith('/');
  const base = path.posix.dirname(file);
  const parts: string[] = base === '.' ? [] : base.split('/');
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  const joined = parts.join('/');
  if (joined === '') return 'index.html';
  return wantsIndex ? `${joined}/index.html` : joined;
}

function resolveRef(scan: Scan, file: string, raw: string, line: number): void {
  const value = raw.trim();
  if (value === '' || IGNORED.test(value) || EXTERNAL.test(value)) return;

  if (value.startsWith('/')) {
    const theme = THEME_REF.exec(value);
    if (theme !== null) {
      const key = `${theme[1]}@${theme[2]}`;
      let where = scan.themes.get(key);
      if (where === undefined) {
        where = { file, line, files: new Map() };
        scan.themes.set(key, where);
      }
      const rest = (value.slice(theme[0].length).split(/[?#]/)[0] ?? '').trim();
      if (rest !== '' && !where.files.has(rest)) where.files.set(rest, { file, line });
      return;
    }
    add(
      scan,
      file,
      line,
      'error',
      `root-relative reference ${value} (only /_themes/<name>@<n>/ or /_themes/<name>@latest/ paths may start with a slash)`,
    );
    return;
  }

  const cut = value.split(/[?#]/)[0] ?? '';
  if (cut === '') return;
  const target = resolvePath(file, cut);
  if (target === undefined) {
    add(scan, file, line, 'error', `reference ${value} points outside the folder`);
    return;
  }
  if (!scan.files.has(target)) add(scan, file, line, 'error', `missing file: ${target}`);
}

function checkScript(scan: Scan, file: string, line: number, attrs: Map<string, string>): void {
  const value = (attrs.get('src') ?? '').trim();
  const host = hostOf(value);
  if (host === undefined) return;
  if (!SCRIPT_HOSTS.includes(host)) {
    add(scan, file, line, 'error', `script host not allowed: ${value} (allowed: ${SCRIPT_HOSTS.join(', ')})`);
    return;
  }
  const pathname = pathnameOf(value);
  const pinned = host === 'cdnjs.cloudflare.com' ? VERSION_PATH.test(pathname) : VERSION_AT.test(pathname);
  if (pinned) return;
  const hint = host === 'cdnjs.cloudflare.com' ? '/1.2.3/ in the path' : '@1.2.3 in the path';
  add(scan, file, line, 'error', `script needs an exact version: ${value} (${hint})`);
}

function checkLink(scan: Scan, file: string, line: number, attrs: Map<string, string>): void {
  const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
  if (!rel.includes('stylesheet')) return;
  const value = (attrs.get('href') ?? '').trim();
  const host = hostOf(value);
  if (host === undefined || STYLE_HOSTS.includes(host)) return;
  add(scan, file, line, 'error', `stylesheet host not allowed: ${value} (allowed: ${STYLE_HOSTS.join(', ')})`);
}

function scanCss(scan: Scan, file: string, text: string, at: (index: number) => number): void {
  for (const match of text.matchAll(CSS_URL)) {
    resolveRef(scan, file, match[1] ?? match[2] ?? match[3] ?? '', at(match.index ?? 0));
  }
  for (const match of text.matchAll(CSS_IMPORT)) {
    resolveRef(scan, file, match[1] ?? match[2] ?? '', at(match.index ?? 0));
  }
}

function scanConnect(scan: Scan, file: string, text: string, at: (index: number) => number): void {
  for (const { name, pattern } of CONNECT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const url = match[1] ?? '';
      add(scan, file, at(match.index ?? 0), 'error', `${name} to ${url} is refused: connect-src is 'self' only`);
    }
  }
}

function scanHtml(scan: Scan, file: string, text: string, facts?: HtmlFacts): void {
  const at = lineFinder(text);
  const masked = maskComments(text);
  const refs: { value: string; line: number }[] = [];
  const mathTags: { open: number; line: number }[] = [];
  const equations: { open: number; line: number }[] = [];
  let mathScript = false;
  let mathStyle = false;

  for (const match of masked.matchAll(TAG_PATTERN)) {
    const name = (match[1] ?? '').toLowerCase();
    const line = at(match.index ?? 0);
    const attrs = attributes(match[2] ?? '');
    const classes = (attrs.get('class') ?? '').toLowerCase().split(/\s+/);
    const open = (match.index ?? 0) + match[0].length;

    for (const key of ['href', 'src', 'poster']) {
      const value = attrs.get(key);
      if (value === undefined) continue;
      refs.push({ value, line });
      if (facts !== undefined && /(?:^|\/)deck\.js(?:[?#]|$)/i.test(value.trim())) facts.deckScript = true;
    }
    const srcset = attrs.get('srcset');
    if (srcset !== undefined && !srcset.trim().startsWith('data:')) {
      for (const part of srcset.split(',')) {
        const value = part.trim().split(/\s+/)[0] ?? '';
        if (value !== '') refs.push({ value, line });
      }
    }

    if (name === 'script') {
      checkScript(scan, file, line, attrs);
      if (MATH_JS.test((attrs.get('src') ?? '').trim())) mathScript = true;
    }
    if (name === 'link') {
      checkLink(scan, file, line, attrs);
      if (MATH_CSS.test((attrs.get('href') ?? '').trim())) mathStyle = true;
    }
    if (name === 'img' && !attrs.has('alt')) add(scan, file, line, 'warning', 'img without alt');
    if (classes.includes('math')) {
      mathTags.push({ open, line });
      checkMath(scan, file, masked, name, open, line);
    }
    if (classes.includes('equation')) equations.push({ open, line });
    if (facts === undefined) continue;
    if (name === 'meta' && (attrs.get('name') ?? '').toLowerCase() === 'viewport') facts.viewport = true;
    if (name === 'title') facts.title = true;
    if (name === 'section' && classes.includes('slide')) facts.slides = true;
  }

  if (mathTags.length > 0) {
    const line = (mathTags[0] as { line: number }).line;
    if (!mathScript) add(scan, file, line, 'warning', 'math without math.js: the LaTeX shows as plain text');
    if (!mathStyle) add(scan, file, line, 'warning', 'math without math.css: the equation prints twice');
  }
  for (const equation of equations) {
    const close = masked.indexOf('</div', equation.open);
    const end = close < 0 ? masked.length : close;
    if (mathTags.some((tag) => tag.open > equation.open && tag.open < end)) continue;
    add(scan, file, equation.line, 'warning', 'equation without class math: write it in LaTeX');
  }

  for (const ref of refs) resolveRef(scan, file, ref.value, ref.line);
  scanCss(scan, file, masked, at);
  scanConnect(scan, file, masked, at);
}

// The LaTeX is the text of the element, so it runs from the end of the open tag
// to the close tag. A child tag there means the content is markup rather than
// LaTeX, and an unescaped < lands there too, because the browser reads <b as a
// tag and eats it, so that line is a warning rather than a silent skip.
function checkMath(scan: Scan, file: string, text: string, name: string, open: number, line: number): void {
  const close = text.indexOf(`</${name}`, open);
  if (close < 0) return;
  const raw = text.slice(open, close);
  if (/<[a-zA-Z/]/.test(raw)) {
    add(scan, file, line, 'warning', 'math holds a tag: write < as &lt;');
    return;
  }
  try {
    katex.renderToString(decodeEntities(raw), { displayMode: name === 'div', throwOnError: true, strict: 'ignore' });
  } catch (err) {
    if (!(err instanceof katex.ParseError)) return;
    add(scan, file, line, 'error', `bad LaTeX: ${err.message.replace(/\s+/g, ' ').trim()}`);
  }
}

async function scanFile(scan: Scan, entry: Entry, facts: HtmlFacts | undefined): Promise<void> {
  const ext = path.extname(entry.rel).toLowerCase();
  if (!SCAN_EXTENSIONS.has(ext) || entry.size > MAX_SCAN_BYTES) return;
  const text = await readFile(entry.abs, 'utf8');
  if (ext === '.html' || ext === '.htm') {
    scanHtml(scan, entry.rel, text, facts);
    return;
  }
  const at = lineFinder(text);
  if (ext === '.css') scanCss(scan, entry.rel, text, at);
  else scanConnect(scan, entry.rel, text, at);
}

async function collect(scan: Scan, dir: string, prefix: string, entries: Entry[]): Promise<void> {
  const items = await readdir(dir, { withFileTypes: true });
  items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const item of items) {
    if (item.name.startsWith('.') || SKIPPED_NAMES.has(item.name)) continue;
    const rel = prefix === '' ? item.name : `${prefix}/${item.name}`;
    const abs = path.join(dir, item.name);
    const problem = pathProblem(rel);
    if (problem !== undefined) add(scan, rel, 1, 'error', problem);
    if (item.isDirectory()) {
      await collect(scan, abs, rel, entries);
      continue;
    }
    if (!item.isFile()) continue;
    const info = await stat(abs).catch(() => undefined);
    if (info === undefined) continue;
    entries.push({ rel, abs, size: info.size });
  }
}

async function checkThemeFile(scan: Scan, key: string, rel: string, where: Where): Promise<void> {
  const url = `${scan.art}/_themes/${key}/${rel}`;
  let status: number;
  await readyNetwork();
  try {
    const reply = await scan.fetchImpl(url, { method: 'HEAD' });
    status = reply.status;
  } catch (err) {
    add(scan, where.file, where.line, 'warning', `cannot check theme ${key}/${rel}: ${networkDetail(err, url)}`);
    return;
  }
  if (status === 404) add(scan, where.file, where.line, 'error', `theme ${key} has no ${rel} (${url})`);
  else if (status < 200 || status > 399) {
    add(scan, where.file, where.line, 'warning', `cannot check theme ${key}/${rel}: HTTP ${status}`);
  }
}

async function checkTheme(scan: Scan, key: string, where: ThemeRef): Promise<void> {
  if (scan.offline || scan.art === '') return;
  const url = `${scan.art}/_themes/${key}/tokens.css`;
  let status: number;
  await readyNetwork();
  try {
    const reply = await scan.fetchImpl(url, { method: 'HEAD' });
    status = reply.status;
  } catch (err) {
    add(scan, where.file, where.line, 'warning', `cannot check theme ${key}: ${networkDetail(err, url)}`);
    return;
  }
  if (status === 404) {
    add(scan, where.file, where.line, 'error', `theme ${key} is not published (${url})`);
    return;
  }
  if (status < 200 || status > 399) {
    add(scan, where.file, where.line, 'warning', `cannot check theme ${key}: HTTP ${status}`);
    return;
  }
  if (status > 299) return;
  for (const [rel, ref] of where.files) {
    if (rel === 'tokens.css') continue;
    await checkThemeFile(scan, key, rel, ref);
  }
}

export async function checkFolder(input: string, opts: CheckOptions = {}): Promise<CheckResult> {
  const root = path.resolve(input);
  const info = await stat(root).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw new UsageError(`no such folder: ${input}`);

  const scan: Scan = {
    files: new Set(),
    findings: [],
    art: (opts.art ?? '').replace(/\/+$/, ''),
    offline: opts.offline === true,
    fetchImpl: opts.fetchImpl ?? fetch,
    themes: new Map(),
  };

  const entries: Entry[] = [];
  await collect(scan, root, '', entries);

  let bytes = 0;
  for (const entry of entries) {
    scan.files.add(entry.rel);
    bytes += entry.size;
    if (entry.size > MAX_BLOB_BYTES) {
      add(
        scan,
        entry.rel,
        1,
        'error',
        `file too large: ${formatBytes(entry.size)} (at most ${formatBytes(MAX_BLOB_BYTES)})`,
      );
    }
  }
  if (entries.length > MAX_VERSION_FILES) {
    add(scan, '.', 1, 'error', `too many files: ${entries.length} (at most ${MAX_VERSION_FILES})`);
  }
  if (bytes > MAX_VERSION_BYTES) {
    add(
      scan,
      '.',
      1,
      'error',
      `folder too large: ${formatBytes(bytes)} (at most ${formatBytes(MAX_VERSION_BYTES)})`,
    );
  }

  const isTheme = scan.files.has('theme.json');
  const hasIndex = scan.files.has('index.html');
  if (!isTheme && !hasIndex) add(scan, 'index.html', 1, 'error', 'no index.html at the root');

  const facts: HtmlFacts = { viewport: false, title: false, slides: false, deckScript: false };
  for (const entry of entries) {
    await scanFile(scan, entry, entry.rel === 'index.html' ? facts : undefined);
  }

  if (hasIndex) {
    if (!facts.viewport) add(scan, 'index.html', 1, 'warning', 'no <meta name="viewport">');
    if (!facts.title) add(scan, 'index.html', 1, 'warning', 'no <title>');
    if (facts.deckScript && !facts.slides) {
      add(scan, 'index.html', 1, 'warning', 'deck without <section class="slide">');
    }
  }

  if (opts.style !== false) {
    for (const warning of await styleWarnings(entries)) {
      add(scan, warning.path, warning.line, 'warning', warning.message);
    }
  }

  for (const warning of await mockupWarnings(entries)) {
    add(scan, warning.path, warning.line, 'warning', warning.message);
  }

  for (const [key, where] of scan.themes) await checkTheme(scan, key, where);

  scan.findings.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.line - b.line;
  });

  const errors = scan.findings.filter((finding) => finding.severity === 'error').length;
  return {
    findings: scan.findings,
    errors,
    warnings: scan.findings.length - errors,
    files: entries.length,
    bytes,
  };
}

function tally(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export function countsLine(result: CheckResult): string {
  return `${tally(result.errors, 'error')}, ${tally(result.warnings, 'warning')}`;
}

export function summaryLine(result: CheckResult): string {
  const size = `${tally(result.files, 'file')}, ${formatBytes(result.bytes)}`;
  if (result.errors === 0 && result.warnings === 0) return `check: ok (${size})`;
  return `check: ${countsLine(result)} (${size})`;
}

export function reportCheck(out: Output, result: CheckResult): void {
  for (const finding of result.findings) {
    out.line(`${finding.path}:${finding.line}: ${finding.severity}: ${finding.message}`);
  }
  out.line(summaryLine(result));
}

export async function enforceCheck(out: Output, target: string, opts: CheckOptions = {}): Promise<void> {
  const info = await stat(target).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) return;
  const result = await checkFolder(target, opts);
  if (result.findings.length > 0) reportCheck(out, result);
  if (result.errors > 0) throw new CheckError(`check failed: ${countsLine(result)}`);
}
