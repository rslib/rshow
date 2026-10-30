#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { isBinary } from './binary.ts';
import { Client } from './client.ts';
import { loadConfig, readToken, requireUrl } from './config.ts';
import type { AppConfig } from './config.ts';
import type { Ctx } from './context.ts';
import { ApiError, AuthError, BuildError, CheckError, EXIT, UsageError } from './exit.ts';
import type { ExitCode } from './exit.ts';
import { Output } from './output.ts';
import { VERSION } from './version.ts';
import {
  GENERAL_USAGE,
  PUBLISH_USAGE,
  PREVIEW_USAGE,
  CONFIG_USAGE,
  INIT_USAGE,
  DOCTOR_USAGE,
  THEME_USAGE,
  SKILLS_USAGE,
  LIST_USAGE,
  SHOW_USAGE,
  SHARE_USAGE,
  PIN_USAGE,
  DELETE_USAGE,
  LOGIN_USAGE,
  LOGOUT_USAGE,
  CHECK_USAGE,
  TAG_USAGE,
  PROJECT_USAGE,
  HANDOFF_USAGE,
  COMPARE_USAGE,
  DOCS_USAGE,
} from './usage.ts';
import { run as publish } from './commands/publish.ts';
import { run as check } from './commands/check.ts';
import { run as preview } from './commands/preview.ts';
import { run as config } from './commands/config.ts';
import { run as init } from './commands/init.ts';
import { run as doctor } from './commands/doctor.ts';
import { run as theme } from './commands/theme.ts';
import { run as skills } from './commands/skills.ts';
import { run as list } from './commands/list.ts';
import { run as show } from './commands/show.ts';
import { run as share } from './commands/share.ts';
import { run as pin } from './commands/pin.ts';
import { run as remove } from './commands/delete.ts';
import { run as project } from './commands/project.ts';
import { run as tag } from './commands/tag.ts';
import { run as handoff } from './commands/handoff.ts';
import { run as compare } from './commands/compare.ts';
import { run as docs } from './commands/docs.ts';
import { run as login } from './commands/login.ts';
import { run as logout } from './commands/logout.ts';

type Command = { usage: string; run: (argv: string[], ctx: Ctx) => Promise<ExitCode | void> };

const COMMANDS: Record<string, Command> = {
  publish: { usage: PUBLISH_USAGE, run: publish },
  check: { usage: CHECK_USAGE, run: check },
  handoff: { usage: HANDOFF_USAGE, run: handoff },
  compare: { usage: COMPARE_USAGE, run: compare },
  preview: { usage: PREVIEW_USAGE, run: preview },
  config: { usage: CONFIG_USAGE, run: config },
  init: { usage: INIT_USAGE, run: init },
  doctor: { usage: DOCTOR_USAGE, run: doctor },
  theme: { usage: THEME_USAGE, run: theme },
  skills: { usage: SKILLS_USAGE, run: skills },
  project: { usage: PROJECT_USAGE, run: project },
  tag: { usage: TAG_USAGE, run: tag },
  list: { usage: LIST_USAGE, run: list },
  show: { usage: SHOW_USAGE, run: show },
  share: { usage: SHARE_USAGE, run: share },
  pin: { usage: PIN_USAGE, run: pin },
  delete: { usage: DELETE_USAGE, run: remove },
  login: { usage: LOGIN_USAGE, run: login },
  logout: { usage: LOGOUT_USAGE, run: logout },
  // Kept out of the general help: the docs site runs it, a person rarely does.
  docs: { usage: DOCS_USAGE, run: docs },
};

function fail(err: unknown): ExitCode {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`rshow: ${message}\n`);
  if (err instanceof UsageError) return EXIT.usage;
  if (err instanceof CheckError) return EXIT.check;
  if (err instanceof BuildError) return EXIT.build;
  if (err instanceof AuthError) return EXIT.auth;
  if (err instanceof ApiError) return EXIT.api;
  return EXIT.api;
}

async function main(argv: string[]): Promise<ExitCode> {
  const wantsJson = argv.includes('--json');
  const args = argv.filter((arg) => arg !== '--json');
  const wantsVersion = args.includes('--version') || args.includes('-v');
  const wantsHelp = args.includes('--help') || args.includes('-h');
  const name = args.find((arg) => !arg.startsWith('-'));
  const spec = name === undefined ? undefined : COMMANDS[name];

  if (wantsVersion) {
    const suffix = (await isBinary()) ? ' (binary)' : '';
    process.stdout.write(`rshow ${VERSION}${suffix}\n`);
    return EXIT.ok;
  }
  if (wantsHelp) {
    process.stdout.write(`${spec === undefined ? GENERAL_USAGE : spec.usage}\n`);
    return EXIT.ok;
  }
  if (name === undefined) {
    process.stderr.write(`${GENERAL_USAGE}\n`);
    return EXIT.usage;
  }
  if (spec === undefined) {
    throw new UsageError(`unknown command: ${name} (try: rshow --help)`);
  }

  const index = args.indexOf(name);
  const rest = [...args.slice(0, index), ...args.slice(index + 1)];

  const configs = new Map<string, Promise<AppConfig>>();
  const clients = new Map<string, Client>();
  const keyOf = (dir: string | undefined): string => (dir === undefined ? '' : path.resolve(dir));
  const configFor = (dir: string | undefined): Promise<AppConfig> => {
    const key = keyOf(dir);
    let pending = configs.get(key);
    if (pending === undefined) {
      pending = loadConfig(process.env, dir);
      configs.set(key, pending);
    }
    return pending;
  };

  const ctx: Ctx = {
    config: configFor,
    api: async (dir) => {
      const key = keyOf(dir);
      const cached = clients.get(key);
      if (cached !== undefined) return cached;
      const settings = await configFor(dir);
      const url = requireUrl(settings);
      const client = new Client(url, await readToken(process.env, url));
      clients.set(key, client);
      return client;
    },
    out: new Output(wantsJson),
  };

  const code = await spec.run(rest, ctx);
  return code ?? EXIT.ok;
}

// No top-level await, so that the single executable build can bundle this file
// as CommonJS; the promise keeps the process alive either way.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.exitCode = fail(err);
  },
);
