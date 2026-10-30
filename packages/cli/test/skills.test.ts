import assert from 'node:assert/strict';
import { cp, lstat, mkdir, readFile, readlink, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.ts';
import { makeTempDir, runCli, tempDir } from './helpers.ts';

// The repo's own skills, which a run from src reads by default.
const SOURCE = fileURLToPath(new URL('../../../skills', import.meta.url));
const SKILLS = ['rshow', 'rshow-implement', 'rshow-slides'];

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A home that no test shares, so a skill folder on the machine that runs the
// tests cannot change their result.
async function makeHome(parents: string[] = []): Promise<string> {
  const home = await tempDir('rshow-skills-home-');
  for (const parent of parents) await mkdir(path.join(home, parent), { recursive: true });
  return home;
}

async function snapshot(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      out.push(`${rel} -> ${await readlink(path.join(dir, rel))}`);
    } else if (entry.isDirectory()) {
      out.push(`${rel}/`, ...(await snapshot(dir, rel)));
    } else {
      out.push(`${rel} ${String((await lstat(path.join(dir, rel))).size)}`);
    }
  }
  return out.sort();
}

function lines(stdout: string): string[] {
  return stdout.trim().split('\n').filter((line) => line !== '');
}

async function markerOf(dir: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, '.rshow-skill'), 'utf8'));
}

test('skills install links each skill into every detected target', async () => {
  const home = await makeHome(['.claude', '.pi/agent']);
  const result = await runCli(['skills', 'install'], { HOME: home });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  for (const parent of ['.claude', '.pi/agent']) {
    for (const skill of SKILLS) {
      const dst = path.join(home, parent, 'skills', skill);
      assert.equal(await readlink(dst), path.join(SOURCE, skill));
      assert.ok(result.stdout.includes(`installed ${dst}\n`), `installed ${dst}`);
    }
  }
  assert.match(result.stdout, /^installed 6 skills for claude, pi$/m);
});

test('skills install --copy copies the folder and writes the marker', async () => {
  const home = await makeHome(['.codex']);
  const result = await runCli(['skills', 'install', '--copy'], { HOME: home });

  assert.equal(result.code, 0, result.stderr);
  const dst = path.join(home, '.codex/skills/rshow');
  assert.equal((await lstat(dst)).isDirectory(), true);
  assert.equal((await lstat(dst)).isSymbolicLink(), false);
  assert.equal(await readFile(path.join(dst, 'SKILL.md'), 'utf8'), await readFile(path.join(SOURCE, 'rshow/SKILL.md'), 'utf8'));
  assert.deepEqual(await markerOf(dst), { version: VERSION, source: 'rshow' });
  assert.ok(result.stdout.includes(`installed ${dst}\n`));
  assert.match(result.stdout, /^installed 3 skills for codex$/m);
});

test('a second run is ok and changes nothing', async () => {
  const home = await makeHome(['.claude']);
  await runCli(['skills', 'install'], { HOME: home });
  const before = await snapshot(home);

  const again = await runCli(['skills', 'install'], { HOME: home });
  assert.equal(again.code, 0, again.stderr);
  assert.equal(again.stderr, '');
  assert.deepEqual(
    lines(again.stdout).map((line) => line.split(' ')[0]),
    ['ok', 'ok', 'ok', 'installed'],
  );
  assert.ok(again.stdout.includes(`ok ${path.join(home, '.claude/skills/rshow')}\n`));
  assert.deepEqual(await snapshot(home), before);
});

test('a copy of another version is replaced, and so is a link to another path', async () => {
  const home = await makeHome(['.claude']);
  await runCli(['skills', 'install', '--copy', 'claude'], { HOME: home });
  const dst = path.join(home, '.claude/skills/rshow');
  await writeFile(path.join(dst, '.rshow-skill'), JSON.stringify({ version: '0.0.0', source: 'rshow' }));
  await writeFile(path.join(dst, 'old.md'), 'old\n');

  const result = await runCli(['skills', 'install', '--copy', 'claude'], { HOME: home });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`updated ${dst}\n`));
  assert.deepEqual(await markerOf(dst), { version: VERSION, source: 'rshow' });
  await assert.rejects(lstat(path.join(dst, 'old.md')));

  const linked = path.join(home, '.claude/skills/rshow-slides');
  await rm(linked, { recursive: true, force: true });
  await symlink(path.join(SOURCE, 'rshow'), linked);
  const relinked = await runCli(['skills', 'install', 'claude'], { HOME: home });
  assert.equal(relinked.code, 0, relinked.stderr);
  assert.ok(relinked.stdout.includes(`updated ${linked}\n`));
  assert.equal(await readlink(linked), path.join(SOURCE, 'rshow-slides'));
});

test('a folder or link that is not from rshow is skipped and the run exits 6', async () => {
  const home = await makeHome(['.claude/skills', '.pi/agent/skills']);
  const dir = path.join(home, '.claude/skills');
  await mkdir(path.join(dir, 'rshow'), { recursive: true });
  await writeFile(path.join(dir, 'rshow/SKILL.md'), 'mine\n');
  const elsewhere = path.join(home, 'elsewhere');
  await mkdir(elsewhere, { recursive: true });
  await symlink(elsewhere, path.join(home, '.pi/agent/skills/rshow'));

  const result = await runCli(['skills', 'install'], { HOME: home });
  assert.equal(result.code, 6);
  assert.match(result.stderr, new RegExp(`^skip ${escapeRe(path.join(dir, 'rshow'))}: exists and is not from rshow$`, 'm'));
  assert.match(
    result.stderr,
    new RegExp(`^skip ${escapeRe(path.join(home, '.pi/agent/skills/rshow'))}: exists and is not from rshow$`, 'm'),
  );
  assert.equal(await readFile(path.join(dir, 'rshow/SKILL.md'), 'utf8'), 'mine\n');
  assert.equal((await lstat(path.join(dir, 'rshow'))).isSymbolicLink(), false);
  assert.equal(await readlink(path.join(home, '.pi/agent/skills/rshow')), elsewhere);
  assert.equal(await readlink(path.join(dir, 'rshow-slides')), path.join(SOURCE, 'rshow-slides'));
  assert.match(result.stdout, /^installed 4 skills for claude, pi$/m);
});

test('--dry-run prints what would happen and changes nothing', async () => {
  const home = await makeHome(['.claude']);
  const before = await snapshot(home);

  const result = await runCli(['skills', 'install', '--dry-run'], { HOME: home });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`would installed ${path.join(home, '.claude/skills/rshow')}\n`));
  assert.match(result.stdout, /^would install 3 skills for claude$/m);
  assert.deepEqual(await snapshot(home), before);
});

test('uninstall removes our links and copies and leaves anything else', async () => {
  const home = await makeHome(['.claude', '.codex']);
  await runCli(['skills', 'install', 'claude'], { HOME: home });
  await runCli(['skills', 'install', 'codex', '--copy'], { HOME: home });
  const dir = path.join(home, '.claude/skills');
  const mine = path.join(home, 'mine');
  await mkdir(mine, { recursive: true });
  await symlink(mine, path.join(dir, 'foreign'));
  await writeFile(path.join(dir, 'note.md'), 'note\n');

  const result = await runCli(['skills', 'uninstall'], { HOME: home });
  assert.equal(result.code, 0, result.stderr);
  for (const skill of SKILLS) {
    for (const parent of ['.claude', '.codex']) {
      const dst = path.join(home, parent, 'skills', skill);
      await assert.rejects(lstat(dst));
      assert.ok(result.stdout.includes(`removed ${dst}\n`), `removed ${dst}`);
    }
  }
  assert.match(result.stdout, /^removed 6 skills for claude, codex$/m);
  assert.equal(await readlink(path.join(dir, 'foreign')), mine);
  assert.equal(await readFile(path.join(dir, 'note.md'), 'utf8'), 'note\n');
});

test('uninstall --dry-run says would removed and keeps the links', async () => {
  const home = await makeHome(['.claude']);
  await runCli(['skills', 'install'], { HOME: home });
  const before = await snapshot(home);

  const result = await runCli(['skills', 'uninstall', '--dry-run'], { HOME: home });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(result.stdout.includes(`would removed ${path.join(home, '.claude/skills/rshow')}\n`));
  assert.deepEqual(await snapshot(home), before);
});

test('skills status prints a line per target and skill', async () => {
  const home = await makeHome(['.claude', '.pi/agent']);
  await runCli(['skills', 'install', 'claude'], { HOME: home });
  await runCli(['skills', 'install', 'pi', '--copy'], { HOME: home });
  await writeFile(
    path.join(home, '.pi/agent/skills/rshow-slides/.rshow-skill'),
    JSON.stringify({ version: '0.0.0', source: 'rshow' }),
  );
  await mkdir(path.join(home, '.pi/agent/skills/rshow-implement/extra'), { recursive: true });
  await writeFile(path.join(home, '.pi/agent/skills/rshow-implement/.rshow-skill'), 'not json\n');

  const result = await runCli(['skills', 'status', 'claude', 'pi', 'codex'], { HOME: home });
  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    new RegExp(`^claude {2}rshow +link -> ${escapeRe(path.join(SOURCE, 'rshow'))}$`, 'm'),
  );
  assert.match(result.stdout, new RegExp(`^pi +rshow +copy v${escapeRe(VERSION)}$`, 'm'));
  assert.match(result.stdout, /^pi +rshow-implement +foreign$/m);
  assert.match(result.stdout, /^pi +rshow-slides +copy v0\.0\.0$/m);
  assert.match(result.stdout, /^codex +rshow +missing$/m);
  assert.match(result.stderr, /warning: .*rshow-slides is a copy of v0\.0\.0/);
});

test('skills status --json prints the states', async () => {
  const home = await makeHome(['.claude']);
  await runCli(['skills', 'install', '--copy'], { HOME: home });

  const result = await runCli(['--json', 'skills', 'status'], { HOME: home });
  assert.equal(result.code, 0);
  const body = JSON.parse(result.stdout) as {
    targets: string[];
    actions: { target: string; skill: string; action: string; path: string; version?: string }[];
  };
  assert.deepEqual(body.targets, ['claude']);
  assert.deepEqual(
    body.actions.map((item) => `${item.target} ${item.skill} ${item.action} v${item.version}`),
    SKILLS.map((skill) => `claude ${skill} copy v${VERSION}`),
  );
  assert.equal(body.actions[0]?.path, path.join(home, '.claude/skills/rshow'));
});

test('skills install --json prints targets and actions', async () => {
  const home = await makeHome(['.codex']);
  const result = await runCli(['--json', 'skills', 'install'], { HOME: home });

  assert.equal(result.code, 0, result.stderr);
  const body = JSON.parse(result.stdout) as {
    targets: string[];
    actions: { target: string; skill: string; action: string; path: string }[];
  };
  assert.deepEqual(body.targets, ['codex']);
  assert.deepEqual(
    body.actions.map((item) => `${item.target} ${item.skill} ${item.action}`),
    ['codex rshow installed', 'codex rshow-implement installed', 'codex rshow-slides installed'],
  );
  assert.deepEqual(body.actions.map((item) => item.path), SKILLS.map((skill) => path.join(home, '.codex/skills', skill)));
});

test('a skills source in an npx cache is copied by default', async () => {
  const cache = await tempDir('rshow-npx-');
  const source = path.join(cache, '_npx', 'abc123', 'node_modules', 'rshow', 'skills');
  await mkdir(source, { recursive: true });
  for (const skill of SKILLS) await cp(path.join(SOURCE, skill), path.join(source, skill), { recursive: true });
  const home = await makeHome(['.claude']);

  const result = await runCli(['skills', 'install'], { HOME: home, RSHOW_SKILLS_DIR: source });
  assert.equal(result.code, 0, result.stderr);
  const dst = path.join(home, '.claude/skills/rshow');
  assert.equal((await lstat(dst)).isSymbolicLink(), false);
  assert.deepEqual(await markerOf(dst), { version: VERSION, source: 'rshow' });

  const forced = await makeHome(['.claude']);
  const linked = await runCli(['skills', 'install', '--link'], { HOME: forced, RSHOW_SKILLS_DIR: source });
  assert.equal(linked.code, 0, linked.stderr);
  assert.equal(await readlink(path.join(forced, '.claude/skills/rshow')), path.join(source, 'rshow'));
});

test('skills needs a subcommand and names the targets it looked for', async () => {
  const home = await makeHome();

  const none = await runCli(['skills', 'install'], { HOME: home });
  assert.equal(none.code, 2);
  assert.match(none.stderr, /^rshow: no target detected \(looked for .*\); name one of claude, pi, codex$/m);

  const missing = await runCli(['skills'], { HOME: home });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^rshow: skills needs a subcommand \(try: usage: rshow skills </m);

  const unknown = await runCli(['skills', 'install', 'nope'], { HOME: home });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^rshow: unknown target: nope \(use claude, pi, codex\)$/m);

  const both = await runCli(['skills', 'install', '--link', '--copy'], { HOME: home });
  assert.equal(both.code, 2);
  assert.match(both.stderr, /^rshow: --link and --copy cannot be used together/m);

  const help = await runCli(['skills', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: rshow skills <install\|uninstall\|status>/m);
});

test('uninstall and status print nothing when no target is detected', async () => {
  const home = await makeHome();

  const removed = await runCli(['skills', 'uninstall'], { HOME: home });
  assert.equal(removed.code, 0, removed.stderr);
  assert.equal(removed.stdout, '');
  assert.equal(removed.stderr, '');

  const status = await runCli(['skills', 'status'], { HOME: home });
  assert.equal(status.code, 0, status.stderr);
  assert.equal(status.stdout, '');
});

test('doctor reports skills as ok, and warns without failing on a stale copy', async () => {
  const xdg = await makeTempDir({});
  const home = await makeHome(['.claude']);
  await runCli(['skills', 'install', '--copy'], { HOME: home });

  const ok = await runCli(['doctor'], { HOME: home, XDG_CONFIG_HOME: xdg });
  assert.match(ok.stdout, /^ok {2}skills {2}claude$/m);

  for (const skill of SKILLS) {
    await writeFile(
      path.join(home, '.claude/skills', skill, '.rshow-skill'),
      JSON.stringify({ version: '0.0.0', source: 'rshow' }),
    );
  }
  const stale = await runCli(['doctor'], { HOME: home, XDG_CONFIG_HOME: xdg });
  assert.match(
    stale.stdout,
    /^warn {2}skills {2}claude: rshow copy v0\.0\.0, rshow-implement copy v0\.0\.0, rshow-slides copy v0\.0\.0 \(run rshow skills install\)$/m,
  );
  assert.doesNotMatch(stale.stdout, /^fail {2}skills/m);
  assert.equal(stale.code, ok.code);
});
