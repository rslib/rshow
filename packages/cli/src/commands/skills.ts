import path from 'node:path';
import process from 'node:process';
import { boolValue, parseCommandArgs } from '../args.ts';
import type { Ctx } from '../context.ts';
import { EXIT, UsageError } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import {
  detectedTargets,
  homeDir,
  installSkills,
  parseTargets,
  skillIsCurrent,
  skillsSource,
  skillsStatus,
  skillStateLabel,
  targetHint,
  uninstallSkills,
} from '../skills.ts';
import type { SkillEntry, SkillMode, SkillStatus, SkillTarget, SkillsSource } from '../skills.ts';
import {
  SKILLS_INSTALL_USAGE,
  SKILLS_STATUS_USAGE,
  SKILLS_UNINSTALL_USAGE,
  SKILLS_USAGE,
  usageLine,
} from '../usage.ts';
import { VERSION } from '../version.ts';
import { warn } from '../warn.ts';

const CHANGE_ACTIONS = new Set(['installed', 'updated', 'removed']);

async function sourceOf(): Promise<SkillsSource> {
  const source = await skillsSource(process.env);
  if (source === undefined) {
    throw new UsageError(`no skills folder next to rshow (set RSHOW_SKILLS_DIR to one)`);
  }
  return source;
}

async function targetsWithDetection(names: readonly string[], home: string): Promise<SkillTarget[]> {
  const chosen = parseTargets(names);
  if (chosen.length > 0) return chosen;
  return detectedTargets(home);
}

function noTargetsError(home: string): UsageError {
  return new UsageError(
    `no target detected (looked for ${path.join(home, '.claude')}, ${path.join(home, '.pi/agent')} and ` +
      `${path.join(home, '.codex')}); name one of ${targetHint()}`,
  );
}

function actionLine(entry: SkillEntry, dryRun: boolean): string {
  const would = dryRun && CHANGE_ACTIONS.has(entry.action) ? 'would ' : '';
  return `${would}${entry.action} ${entry.path}`;
}

function countOf(entries: readonly SkillEntry[]): number {
  return entries.filter((entry) => entry.action !== 'skip').length;
}

const DRY_RUN_VERB: Record<string, string> = { installed: 'install', removed: 'remove' };

function summaryLine(verb: string, entries: readonly SkillEntry[], targets: readonly SkillTarget[], dryRun: boolean): string {
  const phrase = dryRun ? `would ${DRY_RUN_VERB[verb] ?? verb}` : verb;
  return `${phrase} ${countOf(entries)} skills for ${targets.join(', ')}`;
}

async function install(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(
    argv,
    { link: { type: 'boolean' }, copy: { type: 'boolean' }, 'dry-run': { type: 'boolean' } },
    0,
    3,
    SKILLS_INSTALL_USAGE,
  );
  const link = boolValue(args, 'link');
  const copy = boolValue(args, 'copy');
  if (link && copy) throw new UsageError(`--link and --copy cannot be used together (try: ${usageLine(SKILLS_INSTALL_USAGE)})`);

  const home = homeDir(process.env);
  const targets = await targetsWithDetection(args.positionals, home);
  if (targets.length === 0) throw noTargetsError(home);

  const source = await sourceOf();
  const mode: SkillMode = link ? 'link' : copy ? 'copy' : source.mode;
  const dryRun = boolValue(args, 'dry-run');
  const entries = await installSkills({ home, source, targets, mode, dryRun, version: VERSION });

  ctx.out.data({ targets, actions: entries });
  const skipped: string[] = [];
  for (const entry of entries) {
    if (entry.action === 'skip') skipped.push(entry.path);
    else ctx.out.line(actionLine(entry, dryRun));
  }
  ctx.out.line(summaryLine('installed', entries, targets, dryRun));
  for (const dst of skipped) process.stderr.write(`skip ${dst}: exists and is not from rshow\n`);
  return skipped.length > 0 ? EXIT.check : EXIT.ok;
}

async function uninstall(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(argv, { 'dry-run': { type: 'boolean' } }, 0, 3, SKILLS_UNINSTALL_USAGE);
  const home = homeDir(process.env);
  const targets = await targetsWithDetection(args.positionals, home);
  if (targets.length === 0) return EXIT.ok;

  const source = await sourceOf();
  const dryRun = boolValue(args, 'dry-run');
  const entries = await uninstallSkills({ home, source, targets, dryRun });

  ctx.out.data({ targets, actions: entries });
  for (const entry of entries) ctx.out.line(actionLine(entry, dryRun));
  ctx.out.line(summaryLine('removed', entries, targets, dryRun));
  return EXIT.ok;
}

function actionOf(item: SkillStatus): { action: string; version?: string; link?: string } {
  if (item.state.kind === 'link') return { action: 'link', link: item.state.path };
  if (item.state.kind === 'copy') return { action: 'copy', version: item.state.version };
  return { action: item.state.kind };
}

async function status(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(argv, {}, 0, 3, SKILLS_STATUS_USAGE);
  const home = homeDir(process.env);
  const targets = await targetsWithDetection(args.positionals, home);
  if (targets.length === 0) return EXIT.ok;

  const source = await sourceOf();
  const list = await skillsStatus({ home, source, targets });
  const targetWidth = Math.max(...targets.map((target) => target.length));
  const skillWidth = Math.max(...source.skills.map((skill) => skill.length));

  ctx.out.data({
    targets,
    actions: list.map((item) => ({ target: item.target, skill: item.skill, path: item.path, ...actionOf(item) })),
  });
  for (const item of list) {
    const name = `${item.target.padEnd(targetWidth)}  ${item.skill.padEnd(skillWidth)}`;
    ctx.out.line(`${name}  ${skillStateLabel(item.state)}`);
    if (item.state.kind === 'copy' && !skillIsCurrent(item.state, VERSION)) {
      warn(`${item.path} is a copy of v${item.state.version}, this rshow is ${VERSION}: run rshow skills install`);
    }
  }
  return EXIT.ok;
}

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'install':
      return install(rest, ctx);
    case 'uninstall':
      return uninstall(rest, ctx);
    case 'status':
      return status(rest, ctx);
    default:
      throw new UsageError(`skills needs a subcommand (try: ${usageLine(SKILLS_USAGE)})`);
  }
}
