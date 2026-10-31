import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { SHELLS, script, specs } from '../src/commands/completion.ts';
import type { Shell } from '../src/commands/completion.ts';
import { runCli, tempDir } from './helpers.ts';

const SCRIPTS = new Map<Shell, string>();

// The script of a shell, written once per run into a temp folder.
async function scriptFile(shell: Shell): Promise<string> {
  const cached = SCRIPTS.get(shell);
  if (cached !== undefined) return cached;
  const file = path.join(await tempDir('rshow-completion-'), `rshow.${shell}`);
  await writeFile(file, `${script(shell)}\n`);
  SCRIPTS.set(shell, file);
  return file;
}

// Whether the shell is on this machine at all: a syntax check skips the shells
// that are not, such as fish on a CI image that has only bash.
function installed(shell: string): boolean {
  return spawnSync(shell, ['--version'], { encoding: 'utf8' }).error === undefined;
}

function runShell(shell: string, args: string[]): { status: number | null; output: string } {
  const result = spawnSync(shell, args, { encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('every shell prints a script that names every command and no docs', async () => {
  for (const shell of SHELLS) {
    const result = await runCli(['completion', shell]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, '', `${shell} writes nothing on stderr`);
    for (const spec of specs()) {
      const name = spec.words[spec.words.length - 1] as string;
      assert.ok(result.stdout.includes(name), `the ${shell} script completes ${spec.words.join(' ')}`);
    }
    assert.ok(!result.stdout.includes('docs'), `the ${shell} script keeps the hidden docs command out`);
    const global = shell === 'fish' ? '-l json' : '--json';
    assert.ok(result.stdout.includes(global), `the ${shell} script holds the global flags`);
  }
});

test('the bash script parses', async (t) => {
  if (!installed('bash')) return t.skip('no bash on this machine');
  const file = await scriptFile('bash');
  const { status, output } = runShell('bash', ['-n', file]);
  assert.equal(status, 0, output);
});

test('the zsh script parses', async (t) => {
  if (!installed('zsh')) return t.skip('no zsh on this machine');
  const file = await scriptFile('zsh');
  assert.match(script('zsh'), /^#compdef rshow$/m);
  const { status, output } = runShell('zsh', ['-n', file]);
  assert.equal(status, 0, output);
});

test('the fish script parses', async (t) => {
  if (!installed('fish')) return t.skip('no fish on this machine');
  const file = await scriptFile('fish');
  const { status, output } = runShell('fish', ['-n', file]);
  assert.equal(status, 0, output);
});

test('bash completes a command, a subcommand and its options', async (t) => {
  if (!installed('bash')) return t.skip('no bash on this machine');
  const file = await scriptFile('bash');

  // What readline would see: COMP_WORDS as typed, and the word under the cursor.
  const complete = (words: string[], cword: number): string[] => {
    const list = words.map((word) => `'${word}'`).join(' ');
    const code = `source "$1"; COMP_WORDS=(${list}); COMP_CWORD=${cword}; _rshow; printf '%s\\n' "\${COMPREPLY[@]}"`;
    const { status, output } = runShell('bash', ['--norc', '--noprofile', '-c', code, '_rshow', file]);
    assert.equal(status, 0, output);
    return output.split('\n').filter((line) => line !== '');
  };

  assert.ok(complete(['rshow', 'th'], 1).includes('theme'), 'rshow th completes theme');
  assert.ok(complete(['rshow', 'theme', ''], 2).includes('publish'), 'rshow theme completes publish');
  assert.ok(complete(['rshow', 'publish', '--'], 2).includes('--slug'), 'rshow publish -- completes --slug');
  assert.ok(complete(['rshow', 'completion', ''], 2).includes('fish'), 'rshow completion completes fish');
});

test('completion needs bash, zsh or fish and prints its usage', async () => {
  const missing = await runCli(['completion']);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^rshow: completion needs a shell: bash, zsh or fish \(try: usage: rshow completion/m);
  assert.equal(missing.stdout, '');

  const unknown = await runCli(['completion', 'tcsh']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /^rshow: unknown shell: tcsh \(use bash, zsh or fish\)$/m);

  const help = await runCli(['completion', '--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^usage: rshow completion <bash\|zsh\|fish>$/m);
});
