import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Env } from '../src/config.ts';
import { EXIT, UsageError } from '../src/exit.ts';
import {
  UpgradeFailure,
  compareVersions,
  parseVersion,
  releaseTagOf,
  reportOf,
  targetOf,
  upgrade,
} from '../src/upgrade.ts';
import type { Install, UpgradeOptions, UpgradeResult } from '../src/upgrade.ts';
import { targetSkillsDir } from '../src/skills.ts';
import { runCli, tempDir } from './helpers.ts';

const SKILLS = fileURLToPath(new URL('../../../skills', import.meta.url));
const TARGET = targetOf(process.platform, process.arch);
const NEW = '9.9.9';
const AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;

type Reply = { status?: number; headers?: Record<string, string>; body?: string | Buffer };

type Server = { url: string; paths: string[]; close: () => Promise<void> };

type Release = { version: string; name: string; tarball: Buffer; sums: string };

// Everything a test may change about the release it serves and the binary
// that is installed here already.
type Knobs = {
  current?: string;
  latest?: string;
  location?: string;
  version?: string;
  binary?: 'ok' | 'symlink';
  exitCode?: number;
  record?: string;
  tarball?: 'ok' | '404';
  sums?: 'ok' | 'wrong' | 'missing' | '404';
};

type Extra = {
  wanted?: string;
  check?: boolean;
  force?: boolean;
  install?: Install;
  env?: Record<string, string>;
};

type Fixture = {
  root: string;
  dest: string;
  home: string;
  env: Env;
  server: Server;
  release: Release;
  options: (extra?: Extra) => UpgradeOptions;
};

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (err) => (err === null ? resolve() : reject(err)));
  });
}

// The shell script that stands in for a binary: --version, and every other
// run writes its arguments to the file the fixture watches.
function scriptOf(fake: { version: string; exitCode?: number; record?: string }): string {
  const lines = ['#!/bin/sh'];
  if (fake.exitCode !== undefined) {
    lines.push(`exit ${fake.exitCode}`);
  } else {
    lines.push('if [ "$1" = "--version" ]; then', `  printf '%s\\n' 'rshow ${fake.version} (binary)'`, '  exit 0', 'fi');
    if (fake.record !== undefined) lines.push(`printf '%s\\n' "$*" >> '${fake.record}'`);
    lines.push('exit 0');
  }
  return `${lines.join('\n')}\n`;
}

async function startServer(handle: (url: string) => Reply | undefined): Promise<Server> {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    paths.push(url);
    const reply = handle(url) ?? { status: 404 };
    res.writeHead(reply.status ?? 200, reply.headers ?? {});
    res.end(reply.body ?? '');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    paths,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// The fetch the command makes, with every github.com url answered by the
// server of this test instead.
function fetchThrough(server: Server): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return fetch(`${server.url}${new URL(url).pathname}`, init);
  };
}

async function makeRelease(root: string, target: string, knobs: Knobs): Promise<Release> {
  const version = knobs.version ?? NEW;
  const folder = `rshow-${target}`;
  const stage = path.join(root, 'stage');
  const dir = path.join(stage, folder);
  await mkdir(path.join(dir, 'completions'), { recursive: true });
  await writeFile(path.join(dir, 'rshow'), scriptOf({ version, exitCode: knobs.exitCode, record: knobs.record }), {
    mode: 0o755,
  });
  await writeFile(path.join(dir, 'completions', 'rshow.bash'), '# tarball bash\n');
  await writeFile(path.join(dir, 'completions', '_rshow'), '# tarball zsh\n');
  await writeFile(path.join(dir, 'completions', 'rshow.fish'), '# tarball fish\n');
  if (knobs.binary === 'symlink') {
    await rename(path.join(dir, 'rshow'), path.join(stage, 'real'));
    await symlink(path.join(stage, 'real'), path.join(dir, 'rshow'));
  }
  const name = `${folder}.tar.gz`;
  const archive = path.join(stage, name);
  await run('tar', ['-czf', archive, '-C', stage, folder]);
  const tarball = await readFile(archive);
  const sha = createHash('sha256').update(tarball).digest('hex');
  const other = createHash('sha256').update('another file').digest('hex');
  const sums =
    knobs.sums === 'missing' ? `${sha}  rshow-other.tar.gz\n` : `${knobs.sums === 'wrong' ? other : sha}  ${name}\n`;
  return { version, name, tarball, sums };
}

function handlerOf(release: Release, knobs: Knobs): (url: string) => Reply | undefined {
  return (url) => {
    if (url === '/rslib/rshow/releases/latest') {
      const location =
        knobs.location ?? `https://github.com/rslib/rshow/releases/tag/v${knobs.latest ?? release.version}`;
      return { status: 302, headers: { location } };
    }
    const download = /^\/rslib\/rshow\/releases\/download\/v[0-9]+\.[0-9]+\.[0-9]+\//.test(url);
    const name = url.slice(url.lastIndexOf('/') + 1);
    // A mirror names no release, so its files sit at the root of the base.
    if (!download && name !== release.name && name !== 'SHA256SUMS') return undefined;
    if (name === 'SHA256SUMS') {
      return knobs.sums === '404' ? { status: 404 } : { body: release.sums };
    }
    if (name !== release.name) return undefined;
    return knobs.tarball === '404' ? { status: 404 } : { body: release.tarball };
  };
}

async function setup(t: TestContext, knobs: Knobs): Promise<Fixture> {
  const target = TARGET as string;
  const root = await tempDir('rshow-upgrade-');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const dest = path.join(bin, 'rshow');
  await mkdir(bin, { recursive: true });
  await mkdir(home, { recursive: true });
  const current = knobs.current ?? '0.0.8';
  await writeFile(dest, scriptOf({ version: current }), { mode: 0o755 });

  const release = await makeRelease(root, target, { ...knobs, record: path.join(root, 'skills.txt') });
  const server = await startServer(handlerOf(release, knobs));
  t.after(() => server.close());

  const base: Env = {
    HOME: home,
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    RSHOW_SYSTEM_CA: '0',
  };
  return {
    root,
    dest,
    home,
    env: base,
    server,
    release,
    options: (extra = {}) => ({
      current,
      wanted: extra.wanted,
      check: extra.check,
      force: extra.force,
      install: extra.install ?? { kind: 'binary', execPath: dest },
      fetch: fetchThrough(server),
      env: { ...base, ...(extra.env ?? {}) },
      home,
    }),
  };
}

function binaryTest(name: string, body: (make: (knobs?: Knobs) => Promise<Fixture>, t: TestContext) => Promise<void>): void {
  test(name, async (t) => {
    if (TARGET === undefined) {
      t.skip(`there is no rshow single executable for ${process.platform}-${process.arch}`);
      return;
    }
    await body((knobs = {}) => setup(t, knobs), t);
  });
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  return assert.fail('this upgrade should have failed');
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

binaryTest('a good upgrade replaces the file and leaves no folder behind', async (make) => {
  const fixture = await make();
  const before = await readFile(fixture.dest);

  const result = await upgrade(fixture.options());
  assert.equal(result.status, 'upgraded');
  assert.equal(result.version, NEW);
  assert.deepEqual(reportOf(result), {
    data: { previous: '0.0.8', version: NEW, upgraded: true, kind: 'binary' },
    lines: [`rshow: upgraded 0.0.8 -> ${NEW}`],
  });

  const after = await readFile(fixture.dest);
  assert.notDeepEqual(after, before);
  assert.match(after.toString(), new RegExp(`rshow ${NEW} \\(binary\\)`));
  assert.equal((await stat(fixture.dest)).mode & 0o777, 0o755);
  assert.deepEqual(await readdir(path.dirname(fixture.dest)), ['rshow']);
});

binaryTest('a symlink at the install path stays a symlink and its target is replaced', async (make) => {
  const fixture = await make();
  const real = path.join(fixture.root, 'real', 'rshow');
  await mkdir(path.dirname(real), { recursive: true });
  await rename(fixture.dest, real);
  await symlink(real, fixture.dest);

  const result = await upgrade(fixture.options({ install: { kind: 'binary', execPath: fixture.dest } }));
  assert.equal(result.status, 'upgraded');
  assert.equal((await lstat(fixture.dest)).isSymbolicLink(), true);
  assert.match((await readFile(real)).toString(), new RegExp(`rshow ${NEW}`));
  assert.deepEqual(await readdir(path.dirname(fixture.dest)), ['rshow']);
});

binaryTest('a failed step keeps the old binary and says what happened', async (make) => {
  const cases: { knobs: Knobs; match: RegExp }[] = [
    { knobs: { sums: 'wrong' }, match: /checksum mismatch for rshow-.*\.tar\.gz: SHA256SUMS says [0-9a-f]{64}, the download is [0-9a-f]{64}/ },
    { knobs: { sums: 'missing' }, match: /SHA256SUMS holds no line for rshow-.*\.tar\.gz/ },
    { knobs: { tarball: '404' }, match: /^this release has no rshow-.*\.tar\.gz \(.*\); a new release attaches its binaries a few minutes after it appears, so try again$/ },
    { knobs: { exitCode: 3 }, match: /the new rshow does not run \(exit 3\); the old rshow is still in place/ },
    { knobs: { latest: '9.9.9', version: '9.9.8' }, match: /printed rshow 9\.9\.8 \(binary\), not rshow 9\.9\.9; the old rshow is still in place/ },
  ];
  for (const one of cases) {
    const fixture = await make(one.knobs);
    const before = await readFile(fixture.dest);
    const err = await failure(upgrade(fixture.options()));
    assert.match(err.message, one.match);
    assert.deepEqual(await readFile(fixture.dest), before, `${JSON.stringify(one.knobs)} keeps the old binary`);
    assert.deepEqual(await readdir(path.dirname(fixture.dest)), ['rshow']);
  }
});

binaryTest('a named version with no tarball says to use the installer', async (make) => {
  const named = (version: string, name: string, url: string): string =>
    `release v${version} has no ${name} (${url}); it may not exist, and a release before 0.0.6 has no tarball, ` +
    `so use the installer with RSHOW_VERSION=${version}`;

  const fixture = await make({ tarball: '404' });
  const err = await failure(upgrade(fixture.options({ wanted: '0.0.5' })));
  const url = `https://github.com/rslib/rshow/releases/download/v0.0.5/${fixture.release.name}`;
  assert.equal(err.message, named('0.0.5', fixture.release.name, url));
  assert.ok(!fixture.server.paths.includes('/rslib/rshow/releases/latest'));

  // A mirror with --version says the same of its own url.
  const mirrored = await make({ tarball: '404' });
  const from = await failure(
    upgrade(
      mirrored.options({ wanted: '0.0.5', env: { RSHOW_DOWNLOAD_BASE: `${mirrored.server.url}/mirror` } }),
    ),
  );
  assert.equal(
    from.message,
    named('0.0.5', mirrored.release.name, `${mirrored.server.url}/mirror/${mirrored.release.name}`),
  );
});

binaryTest('a tarball whose rshow is a symlink is refused', async (make) => {
  const fixture = await make({ binary: 'symlink' });
  const before = await readFile(fixture.dest);
  const err = await failure(upgrade(fixture.options()));
  assert.match(err.message, /holds a rshow-.*\/rshow that is not a file; the old rshow is still in place/);
  assert.deepEqual(await readFile(fixture.dest), before);
});

binaryTest('a folder rshow cannot write says which one it is', async (make, t) => {
  if (AS_ROOT) {
    t.skip('as root, every folder is writable');
    return;
  }
  const fixture = await make();
  const dir = path.dirname(fixture.dest);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, 'rshow');
  await writeFile(dest, scriptOf({ version: '0.0.8' }), { mode: 0o755 });
  const real = await realpath(dir);
  await run('chmod', ['555', dir]);
  try {
    const err = await failure(upgrade({ ...fixture.options(), install: { kind: 'binary', execPath: dest } }));
    assert.match(err.message, new RegExp(`^${escapeRe(real)} is not writable`));
    assert.match(err.message, /RSHOW_INSTALL_DIR/);
  } finally {
    await run('chmod', ['755', dir]);
  }
});

binaryTest('a location that is not a release tag is an error', async (make) => {
  for (const location of ['https://github.com/rslib/rshow/releases/tag/nightly', 'https://github.com/rslib/rshow']) {
    const fixture = await make({ location });
    const err = await failure(upgrade(fixture.options()));
    assert.match(err.message, /^https:\/\/github\.com\/rslib\/rshow\/releases\/latest did not name a release/);
    assert.match(err.message, new RegExp(escapeRe(location)));
    assert.deepEqual(await readdir(path.dirname(fixture.dest)), ['rshow']);
  }
});

binaryTest('the same version changes nothing, and --force downloads it again', async (make) => {
  const same = await make({ current: '9.9.9', latest: '9.9.9', version: '9.9.9' });
  const result = await upgrade(same.options());
  assert.equal(result.status, 'current');
  assert.deepEqual(reportOf(result), {
    data: { previous: '9.9.9', version: '9.9.9', upgraded: false, kind: 'binary' },
    lines: ['rshow: already at 9.9.9'],
  });
  assert.deepEqual(same.server.paths, ['/rslib/rshow/releases/latest']);

  const forced = await make({ current: '9.9.9', latest: '9.9.9', version: '9.9.9' });
  const again = await upgrade(forced.options({ force: true }));
  assert.equal(again.status, 'upgraded');
  assert.ok(forced.server.paths.some((one) => one.endsWith('/SHA256SUMS')));
});

binaryTest('a newest release older than the running one changes nothing', async (make) => {
  const fixture = await make({ current: '9.9.9', latest: '9.9.8', version: '9.9.8' });
  const before = await readFile(fixture.dest);
  const result = await upgrade(fixture.options());
  assert.equal(result.status, 'newer');
  assert.deepEqual(reportOf(result).lines, ['rshow: 9.9.9 is newer than the newest release, 9.9.8']);
  assert.deepEqual(fixture.server.paths, ['/rslib/rshow/releases/latest']);
  assert.deepEqual(await readFile(fixture.dest), before);
});

binaryTest('--version installs an older release, with no lookup', async (make) => {
  const fixture = await make({ current: '9.9.9', latest: '9.9.9', version: '0.0.1' });
  const result = await upgrade(fixture.options({ wanted: '0.0.1' }));
  assert.equal(result.status, 'upgraded');
  assert.equal(result.version, '0.0.1');
  assert.deepEqual(fixture.server.paths, [
    `/rslib/rshow/releases/download/v0.0.1/${fixture.release.name}`,
    '/rslib/rshow/releases/download/v0.0.1/SHA256SUMS',
  ]);
});

binaryTest('--check prints both versions and changes nothing', async (make) => {
  const fixture = await make();
  const before = await readFile(fixture.dest);
  const result = await upgrade(fixture.options({ check: true }));
  assert.equal(result.status, 'check');
  assert.deepEqual(reportOf(result), {
    data: { current: '0.0.8', latest: NEW, upgrade_available: true },
    lines: ['current: 0.0.8', `latest: ${NEW}`],
  });
  assert.deepEqual(fixture.server.paths, ['/rslib/rshow/releases/latest']);
  assert.deepEqual(await readFile(fixture.dest), before);
});

binaryTest('a download from a mirror needs no lookup, and says which version it wrote', async (make) => {
  const fixture = await make({ version: '9.9.9' });
  const result = await upgrade(fixture.options({ env: { RSHOW_DOWNLOAD_BASE: `${fixture.server.url}/` } }));
  assert.equal(result.status, 'upgraded');
  assert.equal(result.version, NEW);
  assert.ok(!fixture.server.paths.includes('/rslib/rshow/releases/latest'));
  assert.match((await readFile(fixture.dest)).toString(), new RegExp(`rshow ${NEW}`));

  const mirrored = await make({ version: '9.9.9' });
  const denied = await failure(
    upgrade(mirrored.options({ check: true, env: { RSHOW_DOWNLOAD_BASE: mirrored.server.url } })),
  );
  assert.ok(denied instanceof UsageError);
  assert.match(denied.message, /--check cannot be used with RSHOW_DOWNLOAD_BASE/);

  const wrong = await failure(upgrade(mirrored.options({ env: { RSHOW_DOWNLOAD_BASE: 'ftp://mirror.example' } })));
  assert.match(wrong.message, /needs an http or https url/);
});

binaryTest('a mirror that holds the running version leaves the file byte for byte', async (make, t) => {
  const fixture = await make({ current: '9.9.9', version: '9.9.9' });
  const before = await stat(fixture.dest);
  const bytes = await readFile(fixture.dest);

  const written: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array): boolean => {
    written.push(String(chunk));
    return true;
  });

  const result = await upgrade(fixture.options({ env: { RSHOW_DOWNLOAD_BASE: fixture.server.url } }));
  assert.equal(result.status, 'current');
  assert.deepEqual(reportOf(result), {
    data: { previous: '9.9.9', version: '9.9.9', upgraded: false, kind: 'binary' },
    lines: ['rshow: already at 9.9.9'],
  });
  assert.ok(!fixture.server.paths.includes('/rslib/rshow/releases/latest'));
  assert.ok(written.includes(`rshow: downloading ${fixture.server.url}/${fixture.release.name}\n`));
  assert.equal((await stat(fixture.dest)).ino, before.ino);
  assert.deepEqual(await readFile(fixture.dest), bytes);
  assert.deepEqual(await readdir(path.dirname(fixture.dest)), ['rshow']);

  const forced = await make({ current: '9.9.9', version: '9.9.9' });
  const again = await upgrade(
    forced.options({ force: true, env: { RSHOW_DOWNLOAD_BASE: forced.server.url } }),
  );
  assert.equal(again.status, 'upgraded');
  assert.equal(again.version, '9.9.9');
});

// The arguments of every run of the new binary, one line each.
async function runsOf(fixture: Fixture): Promise<string[]> {
  const text = await readFile(path.join(fixture.root, 'skills.txt'), 'utf8').catch(() => '');
  return text.split('\n').filter((line) => line !== '');
}

// A skill installed as a copy, which the marker of the version says.
async function copySkill(home: string, target: 'claude' | 'pi' | 'codex'): Promise<void> {
  const dir = path.join(targetSkillsDir(home, target), 'rshow');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, '.rshow-skill'), `${JSON.stringify({ version: '0.0.8', source: 'rshow' })}\n`);
}

binaryTest('skills are refreshed only for the targets that have them', async (make) => {
  const fixture = await make();
  await mkdir(path.join(fixture.home, '.claude', 'skills'), { recursive: true });
  await mkdir(path.join(fixture.home, '.codex'), { recursive: true });
  await symlink(path.join(SKILLS, 'rshow'), path.join(fixture.home, '.claude', 'skills', 'rshow'));

  const result = await upgrade(fixture.options());
  assert.equal(result.status, 'upgraded');
  assert.deepEqual(await runsOf(fixture), ['skills install --link claude']);
});

binaryTest('a target of copies is refreshed with --copy', async (make) => {
  const fixture = await make();
  await copySkill(fixture.home, 'claude');

  assert.equal((await upgrade(fixture.options())).status, 'upgraded');
  assert.deepEqual(await runsOf(fixture), ['skills install --copy claude']);
});

binaryTest('a target of links is refreshed with --link', async (make) => {
  const fixture = await make();
  await mkdir(targetSkillsDir(fixture.home, 'codex'), { recursive: true });
  await symlink(path.join(SKILLS, 'rshow'), path.join(targetSkillsDir(fixture.home, 'codex'), 'rshow'));

  assert.equal((await upgrade(fixture.options())).status, 'upgraded');
  assert.deepEqual(await runsOf(fixture), ['skills install --link codex']);
});

binaryTest('two targets of different modes are two runs, and no target is in both', async (make) => {
  const fixture = await make();
  await copySkill(fixture.home, 'claude');
  await mkdir(targetSkillsDir(fixture.home, 'pi'), { recursive: true });
  await symlink(path.join(SKILLS, 'rshow'), path.join(targetSkillsDir(fixture.home, 'pi'), 'rshow'));
  await mkdir(path.join(fixture.home, '.codex'), { recursive: true });

  assert.equal((await upgrade(fixture.options())).status, 'upgraded');
  const runs = await runsOf(fixture);
  assert.deepEqual(runs, ['skills install --copy claude', 'skills install --link pi']);
  const named = runs.flatMap((run) => run.split(' ').slice(3));
  assert.deepEqual(named, ['claude', 'pi']);
});

binaryTest('a completion file is replaced only if it is there already', async (make) => {
  const fixture = await make();
  const data = fixture.env.XDG_DATA_HOME as string;
  const bash = path.join(data, 'bash-completion', 'completions', 'rshow');
  const zsh = path.join(data, 'zsh', 'site-functions', '_rshow');
  const fish = path.join(fixture.env.XDG_CONFIG_HOME as string, 'fish', 'completions', 'rshow.fish');
  await mkdir(path.dirname(bash), { recursive: true });
  await writeFile(bash, '# old bash\n');

  assert.equal((await upgrade(fixture.options())).status, 'upgraded');
  assert.equal(await readFile(bash, 'utf8'), '# tarball bash\n');
  await assert.rejects(stat(zsh));
  await assert.rejects(stat(fish));

  const kept = await make();
  const keptBash = path.join(kept.env.XDG_DATA_HOME as string, 'bash-completion', 'completions', 'rshow');
  await mkdir(path.dirname(keptBash), { recursive: true });
  await writeFile(keptBash, '# old bash\n');
  await upgrade(kept.options({ env: { RSHOW_NO_COMPLETIONS: '1' } }));
  assert.equal(await readFile(keptBash, 'utf8'), '# old bash\n');
});

test('an install rshow does not own is named and left alone', async () => {
  const dir = await tempDir('rshow-upgrade-');
  const calls: string[] = [];
  const net: typeof fetch = (input) => {
    calls.push(String(input));
    throw new Error('this test needs no network');
  };
  const checkout = path.join(dir, 'main.ts');
  const other = await failure(
    upgrade({ current: '0.0.8', install: { kind: 'other', execPath: '/usr/bin/node', argv1: checkout }, fetch: net, env: {}, home: dir }),
  );
  assert.ok(other instanceof UsageError);
  assert.match(other.message, new RegExp(`rshow runs from ${escapeRe(checkout)}`));

  const cached = path.join(dir, '_npx', 'abc123', 'node_modules', 'rshow', 'dist', 'main.js');
  const npx = await failure(
    upgrade({
      current: '0.0.8',
      install: { kind: 'other', execPath: '/usr/bin/node', argv1: cached },
      fetch: net,
      env: {},
      home: dir,
    }),
  );
  assert.match(npx.message, /an npx cache that npm owns; run npx rshow@/);

  const local = path.join(dir, 'app', 'node_modules', 'rshow', 'dist', 'main.js');
  const dependency = await failure(
    upgrade({
      current: '0.0.8',
      install: { kind: 'other', execPath: '/usr/bin/node', argv1: local },
      fetch: net,
      env: {},
      home: dir,
    }),
  );
  assert.match(dependency.message, /npm install rshow@<version>/);
  assert.deepEqual(calls, []);

  const redirect: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { location: 'https://github.com/rslib/rshow/releases/tag/v9.9.9' } });
  const found = await upgrade({
    current: '0.0.8',
    check: true,
    install: { kind: 'other', execPath: '/usr/bin/node', argv1: checkout },
    fetch: redirect,
    env: { RSHOW_SYSTEM_CA: '0' },
    home: dir,
  });
  assert.equal(found.status, 'check');
  assert.equal(found.latest, '9.9.9');
  assert.equal((found as { upgrade: boolean }).upgrade, true);
});

test('--version takes three numbers and nothing that could move a url', () => {
  assert.equal(parseVersion('1.2.3'), '1.2.3');
  assert.equal(parseVersion('v1.2.3'), '1.2.3');
  for (const bad of ['1.2', '../x', '1.2.3/evil', '', 'v1.2.3.4', '1.2.3-rc1']) {
    assert.throws(() => parseVersion(bad), UsageError, `${JSON.stringify(bad)} is refused`);
  }
});

test('a version compares as three numbers', () => {
  assert.ok(compareVersions('0.0.10', '0.0.9') > 0);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('0.0.8', '0.0.9') < 0);
});

test('a release tag comes from the path of the redirect only', () => {
  assert.equal(releaseTagOf('https://github.com/rslib/rshow/releases/tag/v0.0.9'), '0.0.9');
  assert.equal(releaseTagOf('/rslib/rshow/releases/tag/v1.2.3'), '1.2.3');
  assert.equal(releaseTagOf('https://github.com/rslib/rshow'), undefined);
  assert.equal(releaseTagOf('https://github.com/rslib/rshow/releases/tag/nightly'), undefined);
  assert.equal(releaseTagOf(null), undefined);
});

test('a failing npm gives its exit code, and a missing one says how to run the command', async (t) => {
  const dir = await tempDir('rshow-upgrade-');
  const bin = path.join(dir, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(path.join(bin, 'npm'), '#!/bin/sh\nprintf \'npm says no\\n\'\nexit 5\n', { mode: 0o755 });
  const options: UpgradeOptions = {
    current: '0.0.8',
    wanted: '9.9.9',
    install: { kind: 'npm', execPath: process.execPath },
    fetch: () => {
      throw new Error('this test needs no network');
    },
    env: {},
    home: dir,
  };
  const saved = process.env.PATH ?? '';
  t.after(() => {
    process.env.PATH = saved;
  });

  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  const failed = await failure(upgrade(options));
  assert.ok(failed instanceof UpgradeFailure);
  assert.equal(failed.message, 'npm install -g rshow@9.9.9 failed (exit 5)');
  assert.equal(failed.exit, 5);

  process.env.PATH = dir;
  const missing = await failure(upgrade(options));
  assert.ok(missing instanceof UpgradeFailure);
  assert.equal(missing.message, 'cannot run npm (ENOENT); run npm install -g rshow@9.9.9');
  assert.equal(missing.exit, EXIT.usage);
});

test('upgrade is in the help, the completion and the usage line', async () => {
  const help = await runCli(['upgrade', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: rshow upgrade \[--check\] \[--version <x\.y\.z>\] \[--force\]$/m);
  assert.match(help.stdout, /curl -fsSL https:\/\/rslib\.github\.io\/rshow\/install\.sh \| sh/);

  const general = await runCli(['--help']);
  assert.match(general.stdout, /^ {2}upgrade \[--check\] +update rshow to the newest release$/m);

  for (const shell of ['bash', 'zsh', 'fish']) {
    const done = await runCli(['completion', shell]);
    assert.equal(done.code, 0);
    assert.ok(done.stdout.includes('upgrade'), `the ${shell} script completes upgrade`);
    assert.ok(done.stdout.includes('force'), `the ${shell} script completes --force`);
  }
});

test('the command refuses an install it cannot update, and a bad --version', async () => {
  const refused = await runCli(['upgrade']);
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /^rshow: rshow runs from .*main\.ts,/m);

  const bad = await runCli(['upgrade', '--version', '1.2']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^rshow: --version needs x\.y\.z, got: 1\.2$/m);

  const slash = await runCli(['upgrade', '--version', '1.2.3/evil']);
  assert.equal(slash.code, 2);
});
