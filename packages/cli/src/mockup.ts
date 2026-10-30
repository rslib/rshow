import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type MockupEntry = { rel: string; abs: string; size: number };
export type MockupWarning = { path: string; line: number; message: string };

const MAX_SCAN_BYTES = 4 * 1024 * 1024;
const HTML_EXTENSIONS = new Set(['.html', '.htm']);
const MIN_COLS = 80;
const MIN_ROWS = 24;

const COMMENT = /<!--[\s\S]*?(?:-->|$)/g;
const SCRIPT_BLOCK = /<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>/gi;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ANY_TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const KEY_ZONES = new Set(['tui-keys', 'tui-statusbar', 'tui-dialog']);
const TERMINAL_KEYS = /(?:ctrl\s*[-+]\s*[cz\\]|\^\s*[cz\\]|\bc-[cz\\])/i;

type Board = { id: string; label: string; title: boolean; states: string[]; line: number; blocks: Block[] };
type Block = { states: string[]; line: number };
type Flow = { id: string; line: number };
type Saved = { board: Board | undefined; mockup: boolean; block: boolean };
type Frame = { name: string; inner: number; line: number; zone: boolean; saved: Saved };

type Scan = {
  path: string;
  lineOf: (index: number) => number;
  out: MockupWarning[];
  boards: Board[];
  flows: Flow[];
};

function blank(text: string): string {
  return text.replace(/[^\n]/g, ' ');
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

function attributes(raw: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of raw.matchAll(ATTR)) {
    const name = (match[1] ?? '').toLowerCase();
    if (name === '' || found.has(name)) continue;
    found.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

function classesOf(attrs: Map<string, string>): string[] {
  return (attrs.get('class') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((name) => name !== '');
}

function listOf(value: string | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
}

function sizeOf(attrs: Map<string, string>, name: string, fallback: number): number {
  const value = Number.parseInt((attrs.get(name) ?? '').trim(), 10);
  return Number.isFinite(value) ? value : fallback;
}

function idOf(value: string | undefined): string | undefined {
  const id = String(value ?? '').trim().replace(/^#/, '');
  return id === '' ? undefined : id;
}

function warn(scan: Scan, line: number, message: string): void {
  scan.out.push({ path: scan.path, line, message });
}

function keyHint(scan: Scan, masked: string, from: number, to: number, line: number): void {
  const hit = TERMINAL_KEYS.exec(masked.slice(from, to).replace(ANY_TAG, ''));
  if (hit === null) return;
  warn(scan, line, `key hint binds the terminal's key: ${hit[0].trim()}`);
}

function sizeGate(scan: Scan, attrs: Map<string, string>, line: number): void {
  if (attrs.has('data-allow-small')) return;
  const cols = sizeOf(attrs, 'data-cols', MIN_COLS);
  const rows = sizeOf(attrs, 'data-rows', MIN_ROWS);
  if (cols >= MIN_COLS && rows >= MIN_ROWS) return;
  warn(scan, line, `tui below the 80x24 minimum (${cols}x${rows}), or mark it with data-allow-small`);
}

function walk(scan: Scan, masked: string): void {
  const stack: Frame[] = [];
  let board: Board | undefined;
  let mockup = false;
  let block = false;

  const finish = (frame: Frame, end: number): void => {
    if (frame.zone) keyHint(scan, masked, frame.inner, end, frame.line);
    board = frame.saved.board;
    mockup = frame.saved.mockup;
    block = frame.saved.block;
  };

  for (const match of masked.matchAll(TAG)) {
    const name = (match[2] ?? '').toLowerCase();
    const at = match.index ?? 0;
    if ((match[1] ?? '') === '/') {
      let found = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if ((stack[i] as Frame).name === name) {
          found = i;
          break;
        }
      }
      if (found === -1) continue;
      while (stack.length > found) finish(stack.pop() as Frame, at);
      continue;
    }

    const attrs = attributes(match[3] ?? '');
    const classes = classesOf(attrs);
    const line = scan.lineOf(at);
    const end = at + match[0].length;
    const frame: Frame = {
      name,
      inner: end,
      line,
      zone: classes.some((item) => KEY_ZONES.has(item)),
      saved: { board, mockup, block },
    };
    const empty = VOID_ELEMENTS.has(name) || match[0].endsWith('/>');
    if (!empty) stack.push(frame);

    if (name === 'main' && classes.includes('mockup')) mockup = true;
    if (classes.includes('tui')) sizeGate(scan, attrs, line);

    if (name === 'section' && classes.includes('artboard') && mockup && board === undefined) {
      const id = (attrs.get('id') ?? '').trim();
      board = {
        id,
        label: id === '' ? `${scan.boards.length + 1}` : `#${id}`,
        title: (attrs.get('data-title') ?? '').trim() !== '',
        states: listOf(attrs.get('data-states')),
        line,
        blocks: [],
      };
      scan.boards.push(board);
    } else if (board !== undefined && !block && attrs.has('data-state')) {
      board.blocks.push({ states: listOf(attrs.get('data-state')), line });
      block = true;
    }

    const goto = idOf(attrs.get('data-goto'));
    if (goto !== undefined && mockup) scan.flows.push({ id: goto, line });
    const href = (attrs.get('href') ?? '').trim();
    if (board !== undefined && href.startsWith('#')) {
      const target = idOf(href);
      if (target !== undefined) scan.flows.push({ id: target, line });
    }

    if (empty) finish(frame, end);
  }
}

function resolve(scan: Scan): void {
  const ids = new Set<string>();
  const seen = new Map<string, number>();
  for (let i = 0; i < scan.boards.length; i += 1) {
    const item = scan.boards[i] as Board;
    if (item.id === '') {
      ids.add(`screen-${i + 1}`);
      continue;
    }
    ids.add(item.id);
    const count = (seen.get(item.id) ?? 0) + 1;
    seen.set(item.id, count);
    if (count === 2) warn(scan, item.line, `duplicate artboard id: ${item.id}`);
  }

  const unknown = new Set<string>();
  for (const flow of scan.flows) {
    if (ids.has(flow.id) || unknown.has(flow.id)) continue;
    unknown.add(flow.id);
    warn(scan, flow.line, `flow to #${flow.id} is not an artboard id in this file`);
  }

  for (const item of scan.boards) {
    if (!item.title) warn(scan, item.line, `artboard ${item.label} has no data-title`);
    for (const block of item.blocks) {
      const missing = block.states.filter((state) => state !== 'default' && !item.states.includes(state));
      if (missing.length === 0) continue;
      warn(scan, block.line, `block data-state "${missing.join(',')}" is not in the artboard data-states`);
    }
    for (const state of item.states) {
      if (state === 'default') continue;
      if (item.blocks.some((block) => block.states.includes(state))) continue;
      warn(scan, item.line, `artboard ${item.label} lists state "${state}" that no block uses`);
    }
  }
}

function htmlWarnings(rel: string, text: string): MockupWarning[] {
  const masked = text.replace(COMMENT, blank).replace(SCRIPT_BLOCK, blank);
  const scan: Scan = { path: rel, lineOf: lineFinder(text), out: [], boards: [], flows: [] };
  walk(scan, masked);
  resolve(scan);
  return scan.out;
}

export async function mockupWarnings(entries: MockupEntry[]): Promise<MockupWarning[]> {
  const out: MockupWarning[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry.rel).toLowerCase();
    if (!HTML_EXTENSIONS.has(ext) || entry.size > MAX_SCAN_BYTES) continue;
    const text = await readFile(entry.abs, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    out.push(...htmlWarnings(entry.rel, text));
  }
  return out;
}
