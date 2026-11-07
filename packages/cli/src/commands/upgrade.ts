import { realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { boolValue, parseCommandArgs, stringValue } from '../args.ts';
import { isBinary } from '../binary.ts';
import type { Ctx } from '../context.ts';
import { EXIT } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import { homeDir } from '../skills.ts';
import { UpgradeFailure, parseVersion, reportOf, runProgram, upgrade } from '../upgrade.ts';
import type { Install, UpgradeResult } from '../upgrade.ts';
import { UPGRADE_USAGE } from '../usage.ts';
import { VERSION } from '../version.ts';

const TIMEOUT_MS = 60000;

function isUnder(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function npmRoot(): Promise<string | undefined> {
  try {
    const root = (await runProgram('npm', ['root', '-g'], { timeoutMs: TIMEOUT_MS })).trim();
    return root === '' ? undefined : await realpath(root);
  } catch {
    return undefined;
  }
}

// How this rshow was installed decides what an upgrade may do: a single
// executable is a file, an npm global install is npm's, and anything else
// belongs to another tool.
async function installKind(): Promise<Install> {
  if (await isBinary()) return { kind: 'binary', execPath: process.execPath };
  const argv1 = process.argv[1];
  const root = await npmRoot();
  if (root !== undefined && argv1 !== undefined) {
    const script = await realpath(argv1).catch(() => undefined);
    if (script !== undefined && isUnder(script, root)) {
      return { kind: 'npm', execPath: process.execPath, argv1: script };
    }
  }
  return { kind: 'other', execPath: process.execPath, argv1 };
}

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(
    argv,
    { check: { type: 'boolean' }, version: { type: 'string' }, force: { type: 'boolean' } },
    0,
    0,
    UPGRADE_USAGE,
  );
  const raw = stringValue(args, 'version');
  const wanted = raw === undefined ? undefined : parseVersion(raw);
  const env = process.env;

  let result: UpgradeResult;
  try {
    result = await upgrade({
      current: VERSION,
      wanted,
      check: boolValue(args, 'check'),
      force: boolValue(args, 'force'),
      install: await installKind(),
      fetch,
      env,
      home: homeDir(env),
    });
  } catch (err) {
    if (!(err instanceof UpgradeFailure)) throw err;
    process.stderr.write(`rshow: ${err.message}\n`);
    return err.exit;
  }

  const report = reportOf(result);
  ctx.out.data(report.data);
  for (const line of report.lines) ctx.out.line(line);
  return EXIT.ok;
}
