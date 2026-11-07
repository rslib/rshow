import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdtemp, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type { Env } from './config.ts';
import { EXIT, UsageError } from './exit.ts';
import type { ExitCode } from './exit.ts';
import { sendRequest } from './network.ts';
import { detectedTargets, homeDir, skillsSource, skillsStatus } from './skills.ts';
import type { SkillMode, SkillsSource, SkillStatus, SkillTarget } from './skills.ts';
import { warn } from './warn.ts';

const REPO = 'rslib/rshow';
const NPM_HINT = 'npm i -g rshow';
const INSTALLER_ELSEWHERE = `curl -fsSL https://rslib.github.io/rshow/install.sh | RSHOW_INSTALL_DIR=$HOME/.local/bin sh`;
const LATEST_URL = `https://github.com/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${REPO}/releases/download/v`;

// The only platforms the release workflow builds a single executable for.
const TARGETS = ['linux-x64', 'linux-arm64', 'darwin-arm64'] as const;

const VERSION_PATTERN = /^v?([0-9]+\.[0-9]+\.[0-9]+)$/;
const TAG_PATH = /\/tag\/v([0-9]+\.[0-9]+\.[0-9]+)$/;

const LOOKUP_TIMEOUT_MS = 15000;
// The tarball is 48 MB, so a slow link needs more than two minutes.
const DOWNLOAD_TIMEOUT_MS = 600000;
const UNPACK_TIMEOUT_MS = 120000;
const RUN_TIMEOUT_MS = 20000;
const NPM_TIMEOUT_MS = 300000;
const SKILLS_TIMEOUT_MS = 120000;

export type InstallKind = 'binary' | 'npm' | 'other';

export type Install = {
  kind: InstallKind;
  execPath: string;
  argv1?: string;
};

export type UpgradeOptions = {
  current: string;
  wanted?: string;
  check?: boolean;
  force?: boolean;
  install: Install;
  fetch: typeof fetch;
  env: Env;
  home: string;
  platform?: string;
  arch?: string;
};

export type UpgradeResult =
  | { status: 'check'; current: string; latest: string; upgrade: boolean }
  | { status: 'newer'; kind: InstallKind; current: string; latest: string }
  | { status: 'current'; kind: InstallKind; version: string }
  | { status: 'upgraded'; kind: InstallKind; previous: string; version: string };

export type Report = { data: unknown; lines: string[] };

// A step that failed, with the exit code rshow exits with: a failed npm runs
// its own code out through this.
export class UpgradeFailure extends Error {
  exit: ExitCode;

  constructor(message: string, exit: ExitCode = EXIT.api) {
    super(message);
    this.name = 'UpgradeFailure';
    this.exit = exit;
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function codeOf(err: unknown): string {
  const code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'number') return `exit ${code}`;
  if (typeof code === 'string' && code !== '') return code;
  return messageOf(err);
}

// A program run without a shell, with its stdout, or the error it ended on.
export function runProgram(file: string, args: readonly string[], options: { timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = { timeout: options.timeoutMs, maxBuffer: 16 * 1024 * 1024 };
    execFile(file, [...args], run, (err, stdout) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

// `1.2.3` or `v1.2.3`, which is what a release tag holds. The value goes into
// a url, so nothing else passes.
export function parseVersion(raw: string): string {
  const found = VERSION_PATTERN.exec(raw.trim());
  if (found === null) throw new UsageError(`--version needs x.y.z, got: ${raw}`);
  return found[1] as string;
}

export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function targetOf(platform: string, arch: string): string | undefined {
  const name = `${platform}-${arch}`;
  return (TARGETS as readonly string[]).includes(name) ? name : undefined;
}

// The tag of the release that `releases/latest` redirects to.
export function releaseTagOf(location: string | null): string | undefined {
  if (location === null || location.trim() === '') return undefined;
  let pathname: string;
  try {
    pathname = new URL(location, LATEST_URL).pathname;
  } catch {
    return undefined;
  }
  return TAG_PATH.exec(pathname)?.[1];
}

// The newest release, from the redirect of releases/latest: api.github.com
// allows too few requests a day to be the one a CLI asks.
export async function latestVersion(options: UpgradeOptions): Promise<string> {
  const reply = await sendRequest(
    options.fetch,
    LATEST_URL,
    { redirect: 'manual', signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) },
    options.env,
  );
  const location = reply.headers.get('location');
  const version = releaseTagOf(location);
  if (version === undefined) {
    throw new UpgradeFailure(`${LATEST_URL} did not name a release (location: ${location ?? 'none'})`);
  }
  return version;
}

// The mirror, without the trailing slash, or undefined for the release itself.
function mirrorOf(options: UpgradeOptions): string | undefined {
  const raw = (options.env.RSHOW_DOWNLOAD_BASE ?? '').trim();
  if (raw === '') return undefined;
  const base = raw.replace(/\/+$/, '');
  let protocol: string;
  try {
    protocol = new URL(base).protocol;
  } catch {
    throw new UsageError(`RSHOW_DOWNLOAD_BASE is not a url: ${raw}`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new UsageError(`RSHOW_DOWNLOAD_BASE needs an http or https url, got: ${raw}`);
  }
  return base;
}

function otherError(options: UpgradeOptions): UsageError {
  const from = options.install.argv1 ?? options.install.execPath;
  const version = options.wanted ?? '<version>';
  const where = from.split(path.sep).join('/');
  if (where.includes('/_npx/')) {
    return new UsageError(`rshow runs from ${from}, an npx cache that npm owns; run npx rshow@${version}`);
  }
  if (where.includes('/node_modules/')) {
    return new UsageError(
      `rshow runs from ${from}, a local dependency that npm owns; run npm install rshow@${version} to update it`,
    );
  }
  return new UsageError(`rshow runs from ${from}, a source checkout; update it with git pull and npm run build`);
}

function dataHome(env: Env): string {
  const xdg = (env.XDG_DATA_HOME ?? '').trim();
  return xdg !== '' ? xdg : path.join(homeDir(env), '.local', 'share');
}

function configHome(env: Env): string {
  const xdg = (env.XDG_CONFIG_HOME ?? '').trim();
  return xdg !== '' ? xdg : path.join(homeDir(env), '.config');
}

// The three files the installer writes, from the `completions` function of
// site/public/install.sh, each with the name the tarball carries it under.
function completionPaths(env: Env): { name: string; dst: string }[] {
  const data = dataHome(env);
  const config = configHome(env);
  return [
    { name: 'rshow.bash', dst: path.join(data, 'bash-completion', 'completions', 'rshow') },
    { name: '_rshow', dst: path.join(data, 'zsh', 'site-functions', '_rshow') },
    { name: 'rshow.fish', dst: path.join(config, 'fish', 'completions', 'rshow.fish') },
  ];
}

async function exists(file: string): Promise<boolean> {
  return (await stat(file).catch(() => undefined)) !== undefined;
}

// A 404 of the newest release is a release still settling, which a wait fixes,
// but a version someone named has no tarball before 0.0.6 and may not exist at
// all, so trying again there never helps.
function missingFile(name: string, url: string, named?: string): UpgradeFailure {
  if (named === undefined) {
    return new UpgradeFailure(
      `this release has no ${name} (${url}); a new release attaches its binaries a few minutes after it appears, so try again`,
    );
  }
  return new UpgradeFailure(
    `release v${named} has no ${name} (${url}); it may not exist, and a release before 0.0.6 has no tarball, so use the installer with RSHOW_VERSION=${named}`,
  );
}

// `named` is the version --version chose, or undefined for the newest release.
async function download(
  options: UpgradeOptions,
  url: string,
  file: string,
  name: string,
  named?: string,
): Promise<void> {
  const reply = await sendRequest(options.fetch, url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }, options.env);
  if (reply.status === 404) throw missingFile(name, url, named);
  if (reply.status !== 200 || reply.body === null) {
    throw new UpgradeFailure(`cannot download ${url}: HTTP ${reply.status}`);
  }
  try {
    await pipeline(Readable.fromWeb(reply.body as WebReadableStream<Uint8Array>), createWriteStream(file));
  } catch (err) {
    throw new UpgradeFailure(`cannot write ${file}: ${messageOf(err)}`);
  }
}

function sumOf(text: string, name: string): string | undefined {
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    if ((parts[1] as string).replace(/^\*/, '') === name) return parts[0];
  }
  return undefined;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function checkSum(file: string, name: string, sumsFile: string): Promise<void> {
  const expected = sumOf(await readFile(sumsFile, 'utf8'), name);
  const actual = await sha256Of(file);
  if (expected === undefined) {
    throw new UpgradeFailure(`SHA256SUMS holds no line for ${name}, and the download is ${actual}`);
  }
  if (expected !== actual) {
    throw new UpgradeFailure(`checksum mismatch for ${name}: SHA256SUMS says ${expected}, the download is ${actual}`);
  }
}

async function unpack(file: string, dir: string, tarball: string): Promise<void> {
  try {
    await runProgram('tar', ['-xzf', file, '-C', dir], { timeoutMs: UNPACK_TIMEOUT_MS });
  } catch (err) {
    throw new UpgradeFailure(`cannot unpack ${tarball}: ${codeOf(err)}`);
  }
}

async function printedVersion(file: string): Promise<string> {
  try {
    return (await runProgram(file, ['--version'], { timeoutMs: RUN_TIMEOUT_MS })).trim();
  } catch (err) {
    throw new UpgradeFailure(`the new rshow does not run (${codeOf(err)}); the old rshow is still in place`);
  }
}

// The completions of the tarball, over the ones a shell already reads, so an
// upgrade never leaves a script older than the binary.
async function replaceCompletions(options: UpgradeOptions, dir: string, target: string): Promise<void> {
  if ((options.env.RSHOW_NO_COMPLETIONS ?? '').trim() === '1') return;
  for (const entry of completionPaths(options.env)) {
    const src = path.join(dir, `rshow-${target}`, 'completions', entry.name);
    try {
      if (!(await exists(entry.dst)) || !(await exists(src))) continue;
      await copyFile(src, entry.dst);
    } catch (err) {
      warn(`cannot replace the completion ${entry.dst}: ${messageOf(err)}`);
    }
  }
}

// The mode a target holds: a copy anywhere wins, because a link would drop the
// marker of the copy, and a target with no rshow skill has no mode.
function modeOf(target: SkillTarget, statuses: readonly SkillStatus[]): SkillMode | undefined {
  const kinds = statuses.filter((entry) => entry.target === target).map((entry) => entry.state.kind);
  if (kinds.includes('copy')) return 'copy';
  if (kinds.includes('link')) return 'link';
  return undefined;
}

// The new rshow, spawned because this process still holds the old skills: a
// copy carries a version marker, and one from another version is stale.
async function refreshSkills(options: UpgradeOptions, file: string, prefix: readonly string[]): Promise<void> {
  const targets = await detectedTargets(options.home);
  if (targets.length === 0) return;
  let source: SkillsSource | undefined;
  try {
    source = await skillsSource(options.env);
  } catch {
    return;
  }
  if (source === undefined) return;
  const statuses = await skillsStatus({ home: options.home, source, targets });
  // The mode comes from what is there: a target that holds a copy must be
  // refreshed with --copy, or the default mode of the new rshow, a link on an
  // npm install, would turn the copy into one. One run per mode, because
  // `skills install` takes a single mode.
  const groups: Record<SkillMode, SkillTarget[]> = { copy: [], link: [] };
  for (const target of targets) {
    const mode = modeOf(target, statuses);
    if (mode !== undefined) groups[mode].push(target);
  }
  for (const mode of ['copy', 'link'] as const) {
    if (groups[mode].length === 0) continue;
    try {
      await runProgram(file, [...prefix, 'skills', 'install', `--${mode}`, ...groups[mode]], {
        timeoutMs: SKILLS_TIMEOUT_MS,
      });
    } catch (err) {
      warn(`the new rshow could not refresh the skills (${codeOf(err)}); run rshow skills install`);
    }
  }
}

type BinaryJob = {
  options: UpgradeOptions;
  base: string;
  target: string;
  version?: string;
  // The version --version named, which a 404 answers differently.
  named?: string;
  force: boolean;
};

type BinaryOutcome = { replaced: boolean; version: string };

function versionIn(printed: string): string | undefined {
  return /^rshow ([0-9]+\.[0-9]+\.[0-9]+)/.exec(printed)?.[1];
}

async function replaceBinary(job: BinaryJob, dest: string): Promise<BinaryOutcome> {
  const dir = path.dirname(dest);
  let tmp: string;
  try {
    tmp = await mkdtemp(path.join(dir, '.rshow-upgrade-'));
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new UpgradeFailure(`${dir} is not writable; install elsewhere instead: ${INSTALLER_ELSEWHERE}`);
    }
    throw new UpgradeFailure(`cannot write next to ${dest}: ${messageOf(err)}`);
  }

  try {
    const tarball = `rshow-${job.target}.tar.gz`;
    const file = path.join(tmp, tarball);
    const sums = path.join(tmp, 'SHA256SUMS');
    const url = `${job.base}/${tarball}`;
    // The wait has output, and one that --json prints nothing of.
    process.stderr.write(`rshow: downloading ${url}\n`);
    await download(job.options, url, file, tarball, job.named);
    await download(job.options, `${job.base}/SHA256SUMS`, sums, 'SHA256SUMS', job.named);
    await checkSum(file, tarball, sums);
    await unpack(file, tmp, tarball);

    const folder = `rshow-${job.target}`;
    const unpacked = path.join(tmp, folder, 'rshow');
    const info = await lstat(unpacked).catch(() => undefined);
    if (info === undefined) {
      throw new UpgradeFailure(`${tarball} holds no ${folder}/rshow; the old rshow is still in place`);
    }
    if (!info.isFile()) {
      throw new UpgradeFailure(`${tarball} holds a ${folder}/rshow that is not a file; the old rshow is still in place`);
    }
    await chmod(unpacked, 0o755);

    const printed = await printedVersion(unpacked);
    let version: string;
    if (job.version === undefined) {
      const found = versionIn(printed);
      if (found === undefined) {
        throw new UpgradeFailure(`the new rshow printed ${printed || 'no version'}; the old rshow is still in place`);
      }
      // A mirror names no version, so the tarball does, and one that holds the
      // running version leaves the file alone.
      if (!job.force && found === job.options.current) return { replaced: false, version: found };
      version = found;
    } else {
      if (!printed.startsWith(`rshow ${job.version}`)) {
        throw new UpgradeFailure(
          `the new rshow printed ${printed || 'no version'}, not rshow ${job.version}; the old rshow is still in place`,
        );
      }
      version = job.version;
    }

    await rename(unpacked, dest);
    await replaceCompletions(job.options, tmp, job.target);
    return { replaced: true, version };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// The file this rshow was started from, after any symlink, so that the link
// itself keeps pointing at what is replaced.
async function installPath(options: UpgradeOptions): Promise<string> {
  try {
    return await realpath(options.install.execPath);
  } catch (err) {
    throw new UpgradeFailure(`cannot read ${options.install.execPath}: ${messageOf(err)}`);
  }
}

function targetOrFail(options: UpgradeOptions): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = targetOf(platform, arch);
  if (target === undefined) {
    throw new UsageError(`no rshow single executable for ${platform}-${arch}; run ${NPM_HINT}`);
  }
  return target;
}

async function installBinary(job: BinaryJob): Promise<UpgradeResult> {
  const dest = await installPath(job.options);
  const outcome = await replaceBinary(job, dest);
  if (!outcome.replaced) return { status: 'current', kind: 'binary', version: outcome.version };
  await refreshSkills(job.options, dest, []);
  return { status: 'upgraded', kind: 'binary', previous: job.options.current, version: outcome.version };
}

// npm writes its own output to stderr, so a chatty install leaves --json clean,
// and a timeout ends it the way execFile did.
function runNpm(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', [...args], { stdio: ['ignore', 2, 2], timeout: NPM_TIMEOUT_MS });
    child.on('error', (err) => {
      // Node clears the timer behind `timeout` on exit alone, and a spawn that
      // failed never exits: without this, the error waits out NPM_TIMEOUT_MS.
      child.emit('exit', null, null);
      reject(err);
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (code !== null) {
        const err = Object.assign(new Error(`npm exited ${code}`), { code });
        reject(err);
        return;
      }
      reject(new Error(`npm stopped on ${signal ?? 'a timeout'}`));
    });
  });
}

async function npmInstall(version: string): Promise<void> {
  const command = `npm install -g rshow@${version}`;
  try {
    await runNpm(['install', '-g', `rshow@${version}`]);
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'number') throw new UpgradeFailure(`${command} failed (exit ${code})`, code as ExitCode);
    throw new UpgradeFailure(`cannot run npm (${codeOf(err)}); run ${command}`, EXIT.usage);
  }
}

export async function upgrade(options: UpgradeOptions): Promise<UpgradeResult> {
  const mirror = mirrorOf(options);
  const force = options.force === true;
  const kind = options.install.kind;

  if (options.check === true) {
    if (mirror !== undefined) {
      throw new UsageError(`--check cannot be used with RSHOW_DOWNLOAD_BASE (${mirror}), which names no release`);
    }
    const latest = options.wanted ?? (await latestVersion(options));
    return {
      status: 'check',
      current: options.current,
      latest,
      upgrade: compareVersions(latest, options.current) > 0,
    };
  }

  if (kind === 'other') throw otherError(options);

  // A mirror names no release, so the version comes from the binary itself
  // unless --version says which one to fetch.
  if (kind === 'binary' && mirror !== undefined && options.wanted === undefined) {
    return installBinary({ options, base: mirror, target: targetOrFail(options), force });
  }

  let version = options.wanted;
  if (version === undefined) {
    const latest = await latestVersion(options);
    if (compareVersions(latest, options.current) < 0) {
      return { status: 'newer', kind, current: options.current, latest };
    }
    version = latest;
  }
  if (version === options.current && !force) {
    return { status: 'current', kind, version };
  }

  if (kind === 'binary') {
    const base = mirror ?? `${RELEASES}${version}`;
    return installBinary({ options, base, target: targetOrFail(options), version, named: options.wanted, force });
  }

  await npmInstall(version);
  const argv1 = options.install.argv1;
  if (argv1 !== undefined) await refreshSkills(options, process.execPath, [argv1]);
  return { status: 'upgraded', kind: 'npm', previous: options.current, version };
}

// The line and the JSON a result prints, in one place so that --json and the
// text never tell different stories.
export function reportOf(result: UpgradeResult): Report {
  if (result.status === 'check') {
    return {
      data: { current: result.current, latest: result.latest, upgrade_available: result.upgrade },
      lines: [`current: ${result.current}`, `latest: ${result.latest}`],
    };
  }
  if (result.status === 'newer') {
    return {
      data: { previous: result.current, version: result.current, upgraded: false, kind: result.kind },
      lines: [`rshow: ${result.current} is newer than the newest release, ${result.latest}`],
    };
  }
  if (result.status === 'current') {
    return {
      data: { previous: result.version, version: result.version, upgraded: false, kind: result.kind },
      lines: [`rshow: already at ${result.version}`],
    };
  }
  return {
    data: { previous: result.previous, version: result.version, upgraded: true, kind: result.kind },
    lines: [`rshow: upgraded ${result.previous} -> ${result.version}`],
  };
}
