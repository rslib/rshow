import { parseArgs } from 'node:util';
import { EMAIL_PATTERN } from 'rshow-shared';
import { UsageError } from './exit.ts';
import { TAG_PATTERN } from './tags.ts';
import { usageLine } from './usage.ts';

export type OptionSpec = Record<string, { type: 'string' | 'boolean'; multiple?: boolean }>;

export type ParsedArgs = {
  values: Record<string, string | boolean | string[] | undefined>;
  positionals: string[];
};

const LIST_FLAGS = new Set(['--add', '--editor', '--remove', '--tag']);
const LOWERCASE_TAG = new RegExp(TAG_PATTERN.source, 'i');

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isListValue(token: string | undefined): boolean {
  if (token === undefined || token.startsWith('-')) return false;
  return token.includes('@') || LOWERCASE_TAG.test(token);
}

// Accepts both "--add a@b --add c@d", "--add a@b c@d" and "--tag x --tag y",
// "--tag x y" before parseArgs runs.
export function expandListFlags(argv: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;
    if (!LIST_FLAGS.has(arg)) {
      out.push(arg);
      i += 1;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('-')) {
      throw new UsageError(`${arg} needs a value`);
    }
    out.push(arg, value);
    i += 2;
    while (isListValue(argv[i])) {
      out.push(arg, argv[i] as string);
      i += 1;
    }
  }
  return out;
}

export function parseCommandArgs(
  argv: readonly string[],
  options: OptionSpec,
  minPositionals: number,
  maxPositionals: number,
  hint: string,
): ParsedArgs {
  const expanded = expandListFlags(argv);
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({ args: expanded, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(`${messageOf(err)} (try: ${usageLine(hint)})`);
  }
  const count = parsed.positionals.length;
  if (count < minPositionals || count > maxPositionals) {
    const expected =
      minPositionals === maxPositionals ? `${minPositionals}` : `${minPositionals} to ${maxPositionals}`;
    throw new UsageError(`expected ${expected} argument(s) (try: ${usageLine(hint)})`);
  }
  return { values: parsed.values as ParsedArgs['values'], positionals: parsed.positionals };
}

export function stringValue(args: ParsedArgs, name: string): string | undefined {
  const value = args.values[name];
  return typeof value === 'string' ? value : undefined;
}

export function stringList(args: ParsedArgs, name: string): string[] {
  const value = args.values[name];
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' ? [value] : [];
}

export function boolValue(args: ParsedArgs, name: string): boolean {
  return args.values[name] === true;
}

export function emailList(args: ParsedArgs, name: string): string[] {
  const list = stringList(args, name);
  for (const email of list) {
    if (!EMAIL_PATTERN.test(email)) throw new UsageError(`--${name} needs an email, got: ${email}`);
  }
  return list;
}
