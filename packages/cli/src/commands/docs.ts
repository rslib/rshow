import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCommandArgs, stringValue } from '../args.ts';
import type { Ctx } from '../context.ts';
import { EXIT, UsageError } from '../exit.ts';
import { builtinThemeDir, themeTokenSets } from '../themes.ts';
import {
  CHECK_USAGE,
  COMPARE_USAGE,
  CONFIG_USAGE,
  DELETE_USAGE,
  DOCS_USAGE,
  DOCTOR_USAGE,
  GENERAL_USAGE,
  HANDOFF_USAGE,
  INIT_USAGE,
  LIST_USAGE,
  LOGIN_USAGE,
  LOGOUT_USAGE,
  PIN_USAGE,
  PREVIEW_USAGE,
  PROJECT_CREATE_USAGE,
  PROJECT_DELETE_USAGE,
  PROJECT_LIST_USAGE,
  PROJECT_SHARE_USAGE,
  PROJECT_SHOW_USAGE,
  PROJECT_USAGE,
  PUBLISH_USAGE,
  SHARE_USAGE,
  SHOW_USAGE,
  SKILLS_INSTALL_USAGE,
  SKILLS_STATUS_USAGE,
  SKILLS_UNINSTALL_USAGE,
  SKILLS_USAGE,
  TAG_USAGE,
  THEME_CHECK_USAGE,
  THEME_LIST_USAGE,
  THEME_NEW_USAGE,
  THEME_PREVIEW_USAGE,
  THEME_PUBLISH_USAGE,
  THEME_USAGE,
  usageLine,
} from '../usage.ts';

// The usage block of every command and subcommand, under the name the help
// prints it with: "publish", "theme", "theme new". Every page is written from
// these constants, so a page and `<command> --help` never differ.
const USAGE: Record<string, string> = {
  publish: PUBLISH_USAGE,
  check: CHECK_USAGE,
  handoff: HANDOFF_USAGE,
  compare: COMPARE_USAGE,
  preview: PREVIEW_USAGE,
  config: CONFIG_USAGE,
  init: INIT_USAGE,
  doctor: DOCTOR_USAGE,
  theme: THEME_USAGE,
  'theme new': THEME_NEW_USAGE,
  'theme check': THEME_CHECK_USAGE,
  'theme preview': THEME_PREVIEW_USAGE,
  'theme publish': THEME_PUBLISH_USAGE,
  'theme list': THEME_LIST_USAGE,
  skills: SKILLS_USAGE,
  'skills install': SKILLS_INSTALL_USAGE,
  'skills uninstall': SKILLS_UNINSTALL_USAGE,
  'skills status': SKILLS_STATUS_USAGE,
  project: PROJECT_USAGE,
  'project create': PROJECT_CREATE_USAGE,
  'project list': PROJECT_LIST_USAGE,
  'project show': PROJECT_SHOW_USAGE,
  'project share': PROJECT_SHARE_USAGE,
  'project delete': PROJECT_DELETE_USAGE,
  tag: TAG_USAGE,
  list: LIST_USAGE,
  show: SHOW_USAGE,
  share: SHARE_USAGE,
  pin: PIN_USAGE,
  delete: DELETE_USAGE,
  login: LOGIN_USAGE,
  logout: LOGOUT_USAGE,
};

// What each exit code means, keyed by its name in `exit.ts`, so a new code
// needs a line here before the command compiles.
const WHEN: Record<keyof typeof EXIT, string> = {
  ok: 'the work was done.',
  usage: 'a usage error: an unknown flag, an argument that is not valid, or a missing value. The usage line goes with it.',
  auth: 'the API refused the token with 401 or 403.',
  api: 'the API returned another error.',
  build: 'the `--build` command failed.',
  check: '`rshow check`, `rshow publish` or `rshow theme publish` found an error, or `rshow skills install` found a skill folder that is not from rshow.',
  compare: '`rshow compare` found a difference.',
};

const ARG_WORD = /^(?:<[^>]+>|\[[^\]]*\]|[a-z0-9-]+@v<n>|--?\S+)$/;
const SUBCOMMAND_WORD = /^[a-z][a-z0-9-]*$/;
const ROLE_NAME = /^\s*\*\s{3,}(--[a-z0-9*-]+(?:\d+\.\.\d+)?)\s{2,}(.*)$/;
const ROLE_MORE = /^\s*\*\s{6,}(\S.*)$/;

export type Row = { name: string; file: string; summary: string };

export type Section = { label: string; note: string; names: string[] };

export type DocsResult = { commands: number; files: string[] };

// The lines of the first list in a usage text: the command or subcommand, its
// arguments, then the one-line summary that `--help` prints.
function listLines(usage: string): string[] {
  const lines = usage.split('\n');
  const start = lines.findIndex((line) => /^\s{2}\S/.test(line));
  if (start < 0) return [];
  const out: string[] = [];
  for (const line of lines.slice(start)) {
    if (!/^\s{2}\S/.test(line)) break;
    out.push(line);
  }
  return out;
}

// The command and its arguments, without the summary.
function specWords(line: string): string[] {
  const spec = line.trim().split(/\s{2,}/)[0] ?? '';
  return spec.split(' ').filter((word) => word !== '');
}

// The one-line summary: what follows the run of two or more spaces, or else
// what follows the last argument when the help packs it into one space.
function summaryOf(line: string): string {
  const text = line.trim();
  const parts = text.split(/\s{2,}/);
  if (parts.length > 1) return parts.slice(1).join(' ').trim();
  const words = text.split(' ');
  let index = 0;
  while (index < words.length && (index === 0 || ARG_WORD.test(words[index] as string))) index += 1;
  return words.slice(index).join(' ');
}

// The first sentence of a usage block, lowercased, for a command whose help
// gives it no one-line summary.
function proseSummary(usage: string): string {
  for (const line of usage.split('\n').slice(1)) {
    const text = line.trim();
    if (text === '' || text.startsWith('-')) continue;
    const found = /^[A-Z].*?\.(?:\s|$)/.exec(text);
    const sentence = (found?.[0] ?? text).trim().replace(/\.$/, '').trim();
    return `${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
  }
  return '';
}

// Commands whose own help lists subcommands, such as `theme`.
function parents(): string[] {
  const out: string[] = [];
  for (const [name, usage] of Object.entries(USAGE)) {
    const words = listLines(usage)
      .map((line) => specWords(line)[1])
      .filter((word): word is string => word !== undefined);
    if (words.length > 0 && words.every((word) => SUBCOMMAND_WORD.test(word))) out.push(name);
  }
  return out.sort();
}

// The subcommands a parent's help lists, in the order it lists them.
function subcommandsOf(parent: string): string[] {
  const usage = USAGE[parent];
  if (usage === undefined) return [];
  const out: string[] = [];
  for (const line of listLines(usage)) {
    const word = specWords(line)[1];
    if (word !== undefined && SUBCOMMAND_WORD.test(word)) out.push(word);
  }
  return out;
}

// The summary the parent's help gives one of its subcommands. A line with no
// summary column has none, and the prose of its own usage fills the gap.
function subSummary(parent: string, sub: string): string {
  const usage = USAGE[parent];
  if (usage === undefined) return '';
  for (const line of listLines(usage)) {
    const words = specWords(line);
    if (words[0] !== parent || words[1] !== sub) continue;
    return line.trim().split(/\s{2,}/).length > 1 ? summaryOf(line) : '';
  }
  return '';
}

// "new, check, preview, publish or list"
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

// Every command and subcommand with its one-line summary, in the order the
// general help prints them, each parent followed by its subcommands.
export function commandRows(): Row[] {
  const parentNames = parents();
  const general = listLines(GENERAL_USAGE);
  const ownSummary = new Map<string, string>();
  for (const line of general) {
    const head = specWords(line)[0];
    if (head === undefined) continue;
    const second = specWords(line)[1];
    const isSub = second !== undefined && parentNames.includes(head) && subcommandsOf(head).includes(second);
    if (!isSub && !ownSummary.has(head)) ownSummary.set(head, summaryOf(line));
  }

  const rows: Row[] = [];
  const seen = new Set<string>();
  const push = (name: string, summary: string): void => {
    if (seen.has(name)) return;
    const usage = USAGE[name];
    if (usage === undefined) throw new Error(`no usage text for "${name}"`);
    seen.add(name);
    rows.push({ name, file: `${name.replace(/ /g, '-')}.md`, summary: summary === '' ? proseSummary(usage) : summary });
  };
  const pushParent = (parent: string): void => {
    push(parent, ownSummary.get(parent) ?? joinWords(subcommandsOf(parent)));
    for (const sub of subcommandsOf(parent)) push(`${parent} ${sub}`, subSummary(parent, sub));
  };

  for (const line of general) {
    const head = specWords(line)[0];
    if (head === undefined) continue;
    if (parentNames.includes(head)) {
      pushParent(head);
      continue;
    }
    push(head, summaryOf(line));
  }
  for (const parent of parentNames) pushParent(parent);
  return rows;
}

// One table cell: one line, with `|` escaped.
function cell(text: string): string {
  return text.split(/\s+/).join(' ').trim().replace(/\|/g, '\\|');
}

function commandPage(row: Row, rows: readonly Row[]): string {
  const usage = USAGE[row.name] ?? '';
  const parts = [`# rshow ${row.name}`, '', '```sh', usage, '```', ''];
  const subs = subcommandsOf(row.name).filter((sub) => !sub.includes(' '));
  if (subs.length > 0) {
    parts.push('## Commands', '', '| Command | What it does |', '| --- | --- |');
    for (const sub of subs) {
      const name = `${row.name} ${sub}`;
      const found = rows.find((item) => item.name === name);
      if (found === undefined) continue;
      parts.push(`| [\`rshow ${name}\`](${found.file}) | ${cell(found.summary)} |`);
    }
    parts.push('');
  }
  return `${parts.join('\n')}\n`;
}

function indexPage(rows: readonly Row[]): string {
  const parts = [
    '# Commands',
    '',
    'Every rshow command and subcommand. Each page holds the text that `rshow <command> --help` prints, and `rshow docs` writes both, so the two never differ.',
    '',
    '| Command | What it does |',
    '| --- | --- |',
  ];
  for (const row of rows) parts.push(`| [\`rshow ${row.name}\`](${row.file}) | ${cell(row.summary)} |`);
  return `${parts.join('\n')}\n`;
}

function escapeRegex(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

// A role names one token, or a family: `--support-*` and `--chart-1..8`.
function rolePattern(name: string): RegExp {
  const marked = name.replace(/[0-9]*\.\.[0-9]*/g, '\u0000');
  const source = escapeRegex(marked).replace(/\u0000/g, '\\d+').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`);
}

// The roles the header comment gives, in the order it gives them. A line names
// a token and its text; a line indented under it continues that text.
export function parseRoles(header: string): { pattern: RegExp; text: string }[] {
  const roles: { pattern: RegExp; text: string }[] = [];
  let named = false;
  let current: { pattern: RegExp; lines: string[] } | undefined;
  const flush = (): void => {
    if (current !== undefined) roles.push({ pattern: current.pattern, text: current.lines.join(' ').trim() });
    current = undefined;
  };
  for (const line of header.split('\n')) {
    if (!named) {
      if (/^\s*\*\s+Roles\b/.test(line)) named = true;
      continue;
    }
    const found = ROLE_NAME.exec(line);
    if (found !== null) {
      flush();
      current = { pattern: rolePattern(found[1] as string), lines: [(found[2] as string).trim()] };
      continue;
    }
    const more = ROLE_MORE.exec(line);
    if (more !== null && current !== undefined) {
      current.lines.push((more[1] as string).trim());
      continue;
    }
    if (line.trim() === '*') break;
  }
  flush();
  return roles;
}

// The `:root` block of a stylesheet: the one block with the light values.
function rootBlock(css: string): string {
  const at = css.indexOf(':root {');
  if (at < 0) return '';
  let depth = 0;
  for (let index = at; index < css.length; index += 1) {
    const char = css[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(at, index + 1);
    }
  }
  return css.slice(at);
}

// The `:root` block grouped the way the file groups it: each comment names a
// group and keeps a short note on it.
export function parseSections(block: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  let pending: { label: string; lines: string[] } | undefined;
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (pending !== undefined) {
      if (trimmed.endsWith('*/')) {
        current = { label: pending.label, note: pending.lines.join(' ').trim(), names: [] };
        sections.push(current);
        pending = undefined;
        continue;
      }
      pending.lines.push(trimmed.replace(/^\*\s?/, '').trim());
      continue;
    }
    const comment = /\/\*(.*)$/.exec(line);
    if (comment !== null) {
      const rest = comment[1] ?? '';
      const label = (closed: string): string => closed.replace(/^[\s-]+/, '').replace(/[\s-]+$/, '');
      // `/* ---- line heights ---- */` names the group and says nothing on it.
      if (rest.includes('*/')) {
        current = { label: label(rest.slice(0, rest.indexOf('*/'))), note: '', names: [] };
        sections.push(current);
        pending = undefined;
        continue;
      }
      pending = { label: label(rest), lines: [] };
      continue;
    }
    const found = /^\s*(--[a-z0-9-]+)\s*:/.exec(line);
    if (found === null) continue;
    if (current === undefined) {
      current = { label: '', note: '', names: [] };
      sections.push(current);
    }
    current.names.push(found[1] as string);
  }
  return sections.filter((section) => section.names.length > 0);
}

function heading(label: string): string {
  return label === '' ? 'Other' : `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export async function themeTokensPage(): Promise<string> {
  const dir = await builtinThemeDir('default');
  if (dir === undefined) throw new Error('no built-in theme: default');
  const css = await readFile(path.join(dir, 'tokens.css'), 'utf8');
  const end = css.indexOf('*/');
  const roles = parseRoles(end < 0 ? css : css.slice(0, end));
  const sections = parseSections(rootBlock(css));
  const sets = await themeTokenSets(dir);
  const light = new Map(sets.light.map((token) => [token.name, token.value]));
  const dark = new Map(sets.dark.map((token) => [token.name, token.value]));
  const known = new Set(sections.flatMap((section) => section.names));
  const missing = [...light.keys()].filter((name) => !known.has(name)).sort();
  if (missing.length > 0) throw new Error(`tokens.css holds tokens no group lists: ${missing.join(', ')}`);

  const parts = [
    '# Theme tokens',
    '',
    'Every CSS custom property of the built-in `default` theme, with its light value, its dark value and the role the theme gives it.',
    'The values come from `themes/default/tokens.css`, in the groups that file uses, and the roles come from the comment at the top of it.',
    'Print uses the light values.',
    '',
  ];
  for (const section of sections) {
    parts.push(`## ${heading(section.label)}`, '');
    if (section.note !== '') parts.push(section.note, '');
    parts.push('| Token | Light | Dark | Role |', '| --- | --- | --- | --- |');
    for (const name of section.names) {
      const role = roles.find((entry) => entry.pattern.test(name));
      parts.push(
        `| \`${name}\` | \`${light.get(name) ?? '-'}\` | \`${dark.get(name) ?? '-'}\` | ${cell(role?.text ?? '-')} |`,
      );
    }
    parts.push('');
  }
  return `${parts.join('\n')}\n`;
}

export function exitCodesPage(): string {
  const rows = Object.entries(EXIT)
    .map(([name, code]) => ({ name, code, when: WHEN[name as keyof typeof EXIT] }))
    .sort((a, b) => a.code - b.code || a.name.localeCompare(b.name));
  const parts = [
    '# Exit codes',
    '',
    'Every rshow command exits with one of these codes. On a failure it prints `rshow: <message>` on stderr first.',
    '',
    '| Code | Name | When |',
    '| --- | --- | --- |',
  ];
  for (const row of rows) parts.push(`| ${row.code} | ${row.name} | ${cell(row.when)} |`);
  return `${parts.join('\n')}\n`;
}

// Writes the reference Markdown under `out`: the command pages and their
// index, the theme tokens and the exit codes. Sorted, with no timestamp, so
// two runs write the same bytes.
export async function generate(out: string): Promise<DocsResult> {
  const dir = path.join(out, 'commands');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const rows = commandRows();
  const files: string[] = [];
  for (const row of rows) {
    const file = path.join(dir, row.file);
    await writeFile(file, commandPage(row, rows));
    files.push(file);
  }
  const index = path.join(dir, 'index.md');
  await writeFile(index, indexPage(rows));
  files.push(index);

  for (const [name, text] of [
    ['theme-tokens.md', await themeTokensPage()],
    ['exit-codes.md', exitCodesPage()],
  ] as const) {
    const file = path.join(out, name);
    await writeFile(file, text);
    files.push(file);
  }
  return { commands: rows.length, files: files.map((file) => path.relative(out, file)).sort() };
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, { out: { type: 'string' } }, 0, 0, DOCS_USAGE);
  const out = stringValue(args, 'out');
  if (out === undefined) throw new UsageError(`docs needs --out <dir> (try: ${usageLine(DOCS_USAGE)})`);
  const result = await generate(out);
  ctx.out.data(result);
  ctx.out.line(`wrote ${result.commands} command pages and the index under ${path.join(out, 'commands')}`);
  ctx.out.line(`wrote ${path.join(out, 'theme-tokens.md')}`);
  ctx.out.line(`wrote ${path.join(out, 'exit-codes.md')}`);
}
