import { parseCommandArgs } from '../args.ts';
import type { Ctx } from '../context.ts';
import { EXIT, UsageError } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import {
  CHECK_USAGE,
  COMPLETION_USAGE,
  COMPARE_USAGE,
  CONFIG_USAGE,
  DELETE_USAGE,
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

export const SHELLS = ['bash', 'zsh', 'fish'] as const;

export type Shell = (typeof SHELLS)[number];

// The flags every command takes, with the line the help prints for them.
const GLOBAL_OPTIONS = [
  { name: '--json', description: 'print the API reply JSON' },
  { name: '--help', description: 'show this help' },
  { name: '--version', description: 'print rshow <version>' },
];

const SKILL_TARGETS = ['claude', 'pi', 'codex'];

type Entry = { usage: string; path?: boolean; choices?: string[] };

type Option = { name: string; value: string | undefined };

export type Spec = {
  words: string[];
  options: Option[];
  path: boolean;
  choices: string[];
  summary: string;
};

// The commands the completion offers, in the order the general help lists them:
// the usage text each takes its long options from, and whether its first
// argument is a file or a folder. `docs` stays out, as in the help.
const SPECS: Record<string, Entry> = {
  publish: { usage: PUBLISH_USAGE, path: true },
  check: { usage: CHECK_USAGE, path: true },
  handoff: { usage: HANDOFF_USAGE, path: true },
  compare: { usage: COMPARE_USAGE },
  preview: { usage: PREVIEW_USAGE, path: true },
  config: { usage: CONFIG_USAGE, path: true },
  init: { usage: INIT_USAGE },
  doctor: { usage: DOCTOR_USAGE, path: true },
  theme: { usage: THEME_USAGE },
  'theme new': { usage: THEME_NEW_USAGE },
  'theme check': { usage: THEME_CHECK_USAGE, path: true },
  'theme preview': { usage: THEME_PREVIEW_USAGE, path: true },
  'theme publish': { usage: THEME_PUBLISH_USAGE, path: true },
  'theme list': { usage: THEME_LIST_USAGE },
  skills: { usage: SKILLS_USAGE },
  'skills install': { usage: SKILLS_INSTALL_USAGE, choices: SKILL_TARGETS },
  'skills uninstall': { usage: SKILLS_UNINSTALL_USAGE, choices: SKILL_TARGETS },
  'skills status': { usage: SKILLS_STATUS_USAGE, choices: SKILL_TARGETS },
  project: { usage: PROJECT_USAGE },
  'project create': { usage: PROJECT_CREATE_USAGE },
  'project list': { usage: PROJECT_LIST_USAGE },
  'project show': { usage: PROJECT_SHOW_USAGE },
  'project share': { usage: PROJECT_SHARE_USAGE },
  'project delete': { usage: PROJECT_DELETE_USAGE },
  tag: { usage: TAG_USAGE },
  list: { usage: LIST_USAGE },
  show: { usage: SHOW_USAGE },
  share: { usage: SHARE_USAGE },
  pin: { usage: PIN_USAGE },
  delete: { usage: DELETE_USAGE },
  login: { usage: LOGIN_USAGE },
  logout: { usage: LOGOUT_USAGE },
  completion: { usage: COMPLETION_USAGE, choices: [...SHELLS] },
};

// The long options of a command, from the first line of its usage text: a flag
// that a bare word follows takes that word as its value.
function optionsOf(usage: string): Option[] {
  const out: Option[] = [];
  for (const found of usageLine(usage).matchAll(/--([a-z][a-z0-9-]*)(?:\s+([^[\]\s|]+))?/g)) {
    out.push({ name: `--${found[1]}`, value: found[2] });
  }
  return out;
}

// The one-line summary the help prints for a command: its line in the general
// help, or its line in the help of its parent. A line that packs the summary
// one space after the arguments keeps it after them instead.
function summaryOf(name: string): string {
  const words = name.split(' ');
  const parent = SPECS[words[0] as string];
  const text = words.length === 1 || parent === undefined ? GENERAL_USAGE : parent.usage;
  for (const line of text.split('\n')) {
    if (!/^ {2}\S/.test(line)) continue;
    const parts = line.trim().split(/ {2,}/);
    const spec = (parts[0] ?? '').split(' ');
    if (spec[0] !== words[0]) continue;
    if (words.length === 2 && spec[1] !== words[1]) continue;
    if (parts.length > 1) return parts.slice(1).join(' ').trim();
    let index = 1;
    while (index < spec.length && /^(?:<[^>]+>|\[[^\]]*\]|--?\S+)$/.test(spec[index] as string)) index += 1;
    const summary = spec.slice(index).join(' ').trim();
    return summary.startsWith('[') ? '' : summary;
  }
  return '';
}

export function specs(): Spec[] {
  return Object.entries(SPECS).map(([name, entry]) => ({
    words: name.split(' '),
    options: optionsOf(entry.usage),
    path: entry.path === true,
    choices: entry.choices ?? [],
    summary: summaryOf(name),
  }));
}

function childrenOf(all: readonly Spec[], parent: string): Spec[] {
  return all.filter((spec) => spec.words.length === 2 && spec.words[0] === parent);
}

// A single-quoted shell word, so that a summary holding a quote cannot break
// the script it lands in.
function quoted(text: string): string {
  return `'${text.replace(/'/g, "'\\''")}'`;
}

// A `_describe` list entry: the name, and the summary after a colon.
function described(name: string, summary: string): string {
  return quoted(summary === '' ? name : `${name}:${summary}`);
}

function bashScript(): string {
  const all = specs();
  const top = all.filter((spec) => spec.words.length === 1);

  const arms = all.map((spec) => {
    const key = quoted(spec.words.join(' '));
    const children = childrenOf(all, spec.words[0] as string);
    const names = spec.options.map((option) => option.name);
    const values = spec.options.filter((option) => option.value !== undefined).map((option) => option.name);
    const parts: string[] = [];
    const choices = spec.words.length === 1 && children.length > 0 ? children.map((child) => child.words[1]) : spec.choices;
    if (choices.length > 0) parts.push(`choices='${choices.join(' ')}'`);
    if (names.length > 0) parts.push(`opts="$opts ${names.join(' ')}"`);
    if (values.length > 0) parts.push(`vals='${values.join(' ')}'`);
    if (spec.path) parts.push('paths=1');
    return `    ${key}) ${parts.length === 0 ? ':' : parts.join('; ')} ;;`;
  });

  return [
    '# bash completion for rshow, printed by `rshow completion bash`.',
    '# Load it with',
    '#   rshow completion bash > ~/.local/share/bash-completion/completions/rshow',
    '',
    `_rshow_commands='${top.map((spec) => spec.words[0]).join(' ')}'`,
    `_rshow_options='${GLOBAL_OPTIONS.map((option) => option.name).join(' ')}'`,
    '',
    '_rshow() {',
    '  local cur prev cmd sub key word opts vals paths choices i',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    "  prev=''",
    '  if [ "$COMP_CWORD" -gt 0 ]; then',
    '    prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  fi',
    '',
    '  i=1',
    '  while [ "$i" -lt "$COMP_CWORD" ]; do',
    '    word="${COMP_WORDS[i]}"',
    '    case "$word" in',
    '      -*) ;;',
    '      *)',
    '        if [ -z "$cmd" ]; then',
    '          cmd="$word"',
    '        elif [ -z "$sub" ]; then',
    '          sub="$word"',
    '        fi',
    '        ;;',
    '    esac',
    '    i=$((i + 1))',
    '  done',
    '',
    '  if [ -z "$cmd" ]; then',
    '    COMPREPLY=( $(compgen -W "$_rshow_commands $_rshow_options" -- "$cur") )',
    '    return 0',
    '  fi',
    '',
    '  key="$cmd"',
    '  if [ -n "$sub" ]; then',
    '    key="$cmd $sub"',
    '  fi',
    '',
    '  opts="$_rshow_options"',
    "  vals=''",
    "  paths=''",
    "  choices=''",
    '  case "$key" in',
    ...arms,
    '    *) return 0 ;;',
    '  esac',
    '',
    '  # A flag that takes a value completes nothing: the value is a slug or a',
    '  # folder, and this script never asks the API.',
    '  if [ -n "$vals" ]; then',
    '    case " $vals " in',
    '      *" $prev "*) return 0 ;;',
    '    esac',
    '  fi',
    '',
    '  case "$cur" in',
    '    -*)',
    '      COMPREPLY=( $(compgen -W "$opts" -- "$cur") )',
    '      return 0',
    '      ;;',
    '  esac',
    '',
    '  if [ -n "$choices" ]; then',
    '    COMPREPLY=( $(compgen -W "$choices" -- "$cur") )',
    '    return 0',
    '  fi',
    '  if [ -n "$paths" ]; then',
    '    COMPREPLY=( $(compgen -f -- "$cur") )',
    '    return 0',
    '  fi',
    '  return 0',
    '}',
    '',
    'complete -F _rshow rshow',
  ].join('\n');
}

function zshArguments(spec: Spec): string {
  const parts = GLOBAL_OPTIONS.map((option) => quoted(`${option.name}[${option.description}]`));
  for (const option of spec.options) {
    parts.push(quoted(option.value === undefined ? option.name : `${option.name}=`));
  }
  if (spec.choices.length > 0) parts.push(quoted(`*: :(${spec.choices.join(' ')})`));
  else if (spec.path) parts.push(quoted('*:file or folder:_files'));
  return `_arguments ${parts.join(' ')}`;
}

function zshScript(): string {
  const all = specs();
  const top = all.filter((spec) => spec.words.length === 1);
  const groups = top.filter((spec) => childrenOf(all, spec.words[0] as string).length > 0);

  const arms = all.map((spec) => {
    const children = childrenOf(all, spec.words[0] as string);
    const key = quoted(spec.words.join(' '));
    if (spec.words.length === 1 && children.length > 0) {
      const subs = children.map((child) => `          ${described(child.words[1] as string, child.summary)}`);
      return [
        `        ${key})`,
        '          subs=(',
        ...subs,
        '          )',
        `          _describe -t commands ${quoted(`${spec.words[0]} command`)} subs`,
        '          ;;',
      ].join('\n');
    }
    return `        ${key}) ${zshArguments(spec)} ;;`;
  });

  return [
    '#compdef rshow',
    '',
    '# Completion for rshow, printed by `rshow completion zsh`.',
    '# Load it with',
    '#   rshow completion zsh > ~/.local/share/zsh/site-functions/_rshow',
    '# and keep that folder on $fpath, before compinit.',
    '',
    '_rshow() {',
    '  local -a commands subs groups',
    '  local state key',
    '',
    '  groups=(',
    ...groups.map((spec) => `    ${quoted(spec.words[0] as string)}`),
    '  )',
    '',
    '  _arguments -C \\',
    ...GLOBAL_OPTIONS.map((option) => `    ${quoted(`${option.name}[${option.description}]`)} \\`),
    "    '1: :->command' \\",
    "    '*:: :->args' && return 0",
    '',
    '  case $state in',
    '    command)',
    '      commands=(',
    ...top.map((spec) => `        ${described(spec.words[0] as string, spec.summary)}`),
    '      )',
    "      _describe -t commands 'rshow command' commands",
    '      ;;',
    '    args)',
    '      key=$words[1]',
    '      if (( $groups[(Ie)$words[1]] )); then',
    '        case $words[2] in',
    '          \'\'|-*) ;;',
    '          *) key="$words[1] $words[2]" ;;',
    '        esac',
    '      fi',
    '      case $key in',
    ...arms,
    '      esac',
    '      ;;',
    '  esac',
    '}',
    '',
    '# Sourced from a shell that runs compinit as well as autoloaded from $fpath.',
    'if (( $+functions[compdef] )); then',
    '  compdef _rshow rshow',
    'fi',
  ].join('\n');
}

function fishScript(): string {
  const all = specs();
  const top = all.filter((spec) => spec.words.length === 1);
  const condition = (words: readonly string[]): string =>
    words.map((word) => `__fish_seen_subcommand_from ${word}`).join('; and ');

  const lines = [
    '# fish completion for rshow, printed by `rshow completion fish`.',
    '# Load it with',
    '#   rshow completion fish > ~/.config/fish/completions/rshow.fish',
    '',
    'complete -c rshow -f',
    '',
    '# commands',
  ];

  for (const spec of top) {
    const summary = spec.summary === '' ? '' : ` -d ${quoted(spec.summary)}`;
    lines.push(`complete -c rshow -n __fish_use_subcommand -a ${quoted(spec.words[0] as string)}${summary}`);
  }

  for (const spec of all.filter((entry) => entry.words.length === 2)) {
    const parent = spec.words[0] as string;
    const siblings = childrenOf(all, parent).map((child) => child.words[1]);
    const summary = spec.summary === '' ? '' : ` -d ${quoted(spec.summary)}`;
    lines.push(
      `complete -c rshow -n ${quoted(
        `__fish_seen_subcommand_from ${parent}; and not __fish_seen_subcommand_from ${siblings.join(' ')}`,
      )} -a ${quoted(spec.words[1] as string)}${summary}`,
    );
  }

  lines.push('', '# options');
  for (const option of GLOBAL_OPTIONS) {
    lines.push(`complete -c rshow -l ${option.name.slice(2)} -d ${quoted(option.description)}`);
  }

  for (const spec of all) {
    const seen = quoted(condition(spec.words));
    for (const option of spec.options) {
      const value = option.value === undefined ? '' : ' -r';
      lines.push(`complete -c rshow -n ${seen} -l ${option.name.slice(2)}${value}`);
    }
    if (spec.choices.length > 0) lines.push(`complete -c rshow -n ${seen} -a ${quoted(spec.choices.join(' '))}`);
    else if (spec.path) lines.push(`complete -c rshow -n ${seen} -F`);
  }

  return lines.join('\n');
}

export function script(shell: Shell): string {
  if (shell === 'bash') return bashScript();
  if (shell === 'zsh') return zshScript();
  return fishScript();
}

function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(argv, {}, 0, 1, COMPLETION_USAGE);
  const shell = args.positionals[0];
  if (shell === undefined) {
    throw new UsageError(`completion needs a shell: bash, zsh or fish (try: ${usageLine(COMPLETION_USAGE)})`);
  }
  if (!isShell(shell)) throw new UsageError(`unknown shell: ${shell} (use bash, zsh or fish)`);
  ctx.out.raw(script(shell));
  return EXIT.ok;
}
