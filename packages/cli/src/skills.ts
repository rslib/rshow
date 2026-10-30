import { cp, lstat, mkdir, readFile, readdir, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Env } from './config.ts';
import { UsageError } from './exit.ts';
import { builtinSkillsDir } from './themes.ts';

export const SKILL_TARGETS = ['claude', 'pi', 'codex'] as const;
export type SkillTarget = (typeof SKILL_TARGETS)[number];

const SKILL_MARKER = '.rshow-skill';
const SKILL_SOURCE = 'rshow';

export type SkillMode = 'link' | 'copy';

// The three places an agent reads skills from, as install.sh has them.
const TARGET_SEGMENTS: Record<SkillTarget, readonly string[]> = {
  claude: ['.claude'],
  pi: ['.pi', 'agent'],
  codex: ['.codex'],
};

export type SkillState =
  | { kind: 'missing' }
  | { kind: 'link'; path: string; current: boolean }
  | { kind: 'copy'; version: string }
  | { kind: 'foreign' };

export type SkillAction = 'installed' | 'updated' | 'ok' | 'skip' | 'removed';

export type SkillEntry = { target: SkillTarget; skill: string; action: SkillAction; path: string };

export type SkillsSource = { dir: string; mode: SkillMode; skills: string[] };

export type SkillStatus = { target: SkillTarget; skill: string; state: SkillState; path: string };

type Marker = { version: string; source: string };

async function isDir(dir: string): Promise<boolean> {
  const info = await stat(dir).catch(() => undefined);
  return info !== undefined && info.isDirectory();
}

async function isFile(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => undefined);
  return info !== undefined && info.isFile();
}

function isUnder(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export function homeDir(env: Env): string {
  const home = (env.HOME ?? '').trim();
  return home !== '' ? home : homedir();
}

function targetParent(home: string, target: SkillTarget): string {
  return path.join(home, ...TARGET_SEGMENTS[target]);
}

export function targetSkillsDir(home: string, target: SkillTarget): string {
  return path.join(targetParent(home, target), 'skills');
}

export async function detectedTargets(home: string): Promise<SkillTarget[]> {
  const out: SkillTarget[] = [];
  for (const target of SKILL_TARGETS) {
    if (await isDir(targetParent(home, target))) out.push(target);
  }
  return out;
}

export function parseTargets(names: readonly string[]): SkillTarget[] {
  const out: SkillTarget[] = [];
  for (const name of names) {
    const target = SKILL_TARGETS.find((item) => item === name);
    if (target === undefined) {
      throw new UsageError(`unknown target: ${name} (use ${SKILL_TARGETS.join(', ')})`);
    }
    if (!out.includes(target)) out.push(target);
  }
  return out;
}

export function targetHint(): string {
  return SKILL_TARGETS.join(', ');
}

// npx unpacks into a cache folder npm may delete, so a link from there would
// dangle; that one case copies instead.
export function defaultModeOf(dir: string): SkillMode {
  return dir.split(path.sep).join('/').includes('/_npx/') ? 'copy' : 'link';
}

// RSHOW_SKILLS_DIR reads another skills folder, for a checkout that runs the
// CLI from elsewhere and for the tests.
export async function skillsSource(env: Env): Promise<SkillsSource | undefined> {
  const override = (env.RSHOW_SKILLS_DIR ?? '').trim();
  let dir: string | undefined;
  if (override !== '') {
    dir = path.resolve(override);
    if (!(await isDir(dir))) throw new UsageError(`RSHOW_SKILLS_DIR is not a folder: ${dir}`);
  } else {
    dir = await builtinSkillsDir();
  }
  if (dir === undefined) return undefined;
  const skills: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && (await isFile(path.join(dir, entry.name, 'SKILL.md')))) skills.push(entry.name);
  }
  skills.sort();
  return { dir, mode: defaultModeOf(dir), skills };
}

// A link counts as ours when it points into the skills folder this rshow reads
// from, or into any .../rshow/skills/ folder, which is where npm keeps them.
export function isOurLink(target: string, source: string): boolean {
  const resolved = path.resolve(target);
  if (isUnder(resolved, path.resolve(source))) return true;
  return /(^|\/)rshow\/skills\//.test(resolved.split(path.sep).join('/'));
}

async function linkTargetOf(dst: string): Promise<string> {
  const value = await readlink(dst);
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(dst), value);
}

async function readMarker(dir: string): Promise<Marker | undefined> {
  const text = await readFile(path.join(dir, SKILL_MARKER), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const doc = parsed as Record<string, unknown>;
  if (doc.source !== SKILL_SOURCE || typeof doc.version !== 'string' || doc.version === '') return undefined;
  return { version: doc.version, source: SKILL_SOURCE };
}

export async function inspectSkill(dst: string, source: string, skill: string): Promise<SkillState> {
  const info = await lstat(dst).catch(() => undefined);
  if (info === undefined) return { kind: 'missing' };
  if (info.isSymbolicLink()) {
    const link = await linkTargetOf(dst);
    if (!isOurLink(link, source)) return { kind: 'foreign' };
    return { kind: 'link', path: link, current: path.resolve(link) === path.join(path.resolve(source), skill) };
  }
  if (info.isDirectory()) {
    const marker = await readMarker(dst);
    return marker === undefined ? { kind: 'foreign' } : { kind: 'copy', version: marker.version };
  }
  return { kind: 'foreign' };
}

export function skillIsCurrent(state: SkillState, version: string): boolean {
  if (state.kind === 'link') return true;
  if (state.kind === 'copy') return state.version === version;
  return false;
}

export function skillStateLabel(state: SkillState): string {
  switch (state.kind) {
    case 'missing':
      return 'missing';
    case 'foreign':
      return 'foreign';
    case 'link':
      return `link -> ${state.path}`;
    case 'copy':
      return `copy v${state.version}`;
  }
}

function actionFor(state: SkillState, version: string): SkillAction {
  if (state.kind === 'missing') return 'installed';
  if (state.kind === 'foreign') return 'skip';
  if (state.kind === 'link') return state.current ? 'ok' : 'updated';
  return state.version === version ? 'ok' : 'updated';
}

async function writeSkill(dst: string, src: string, mode: SkillMode, version: string): Promise<void> {
  if (mode === 'link') {
    await symlink(src, dst);
    return;
  }
  await cp(src, dst, { recursive: true });
  const marker: Marker = { version, source: SKILL_SOURCE };
  await writeFile(path.join(dst, SKILL_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

export type InstallOptions = {
  home: string;
  source: SkillsSource;
  targets: readonly SkillTarget[];
  mode: SkillMode;
  dryRun: boolean;
  version: string;
};

export async function installSkills(options: InstallOptions): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  for (const target of options.targets) {
    const dir = targetSkillsDir(options.home, target);
    if (!options.dryRun) await mkdir(dir, { recursive: true });
    for (const skill of options.source.skills) {
      const dst = path.join(dir, skill);
      const src = path.join(options.source.dir, skill);
      const state = await inspectSkill(dst, options.source.dir, skill);
      const action = actionFor(state, options.version);
      if (!options.dryRun && (action === 'installed' || action === 'updated')) {
        if (action === 'updated') await rm(dst, { recursive: true, force: true });
        await writeSkill(dst, src, options.mode, options.version);
      }
      entries.push({ target, skill, action, path: dst });
    }
  }
  return entries;
}

export type UninstallOptions = {
  home: string;
  source: SkillsSource;
  targets: readonly SkillTarget[];
  dryRun: boolean;
};

// Every entry of the target folder is looked at, so a link to a skill that is
// gone from the source is removed too.
export async function uninstallSkills(options: UninstallOptions): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  for (const target of options.targets) {
    const dir = targetSkillsDir(options.home, target);
    for (const skill of (await readdir(dir).catch(() => [] as string[])).sort()) {
      const dst = path.join(dir, skill);
      const state = await inspectSkill(dst, options.source.dir, skill);
      if (state.kind !== 'link' && state.kind !== 'copy') continue;
      if (!options.dryRun) await rm(dst, { recursive: true, force: true });
      entries.push({ target, skill, action: 'removed', path: dst });
    }
  }
  return entries;
}

export type StatusOptions = {
  home: string;
  source: SkillsSource;
  targets: readonly SkillTarget[];
};

export async function skillsStatus(options: StatusOptions): Promise<SkillStatus[]> {
  const out: SkillStatus[] = [];
  for (const target of options.targets) {
    const dir = targetSkillsDir(options.home, target);
    for (const skill of options.source.skills) {
      const dst = path.join(dir, skill);
      out.push({ target, skill, state: await inspectSkill(dst, options.source.dir, skill), path: dst });
    }
  }
  return out;
}
