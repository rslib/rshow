import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../src/cdp.ts';
import { makeTempDir, tempDir } from './helpers.ts';

function chromeBinary(): string | undefined {
  try {
    return findChrome();
  } catch {
    return undefined;
  }
}

const CHROME = chromeBinary();
const CDP_URL = pathToFileURL(fileURLToPath(new URL('../src/cdp.ts', import.meta.url))).href;

// Launches a browser exactly as handoff/compare do, tells the test which
// process and profile it owns, then sits there until it is interrupted.
const HOLDER = `
import { Chrome } from ${JSON.stringify(CDP_URL)};

const binary = process.env.CHROME;
const chrome = await Chrome.launch({ binary: binary === undefined || binary === '' ? undefined : binary });
process.stdout.write('pid: ' + chrome.child.pid + '\\n');
process.stdout.write('profile: ' + chrome.profile + '\\n');
setInterval(() => undefined, 1000);
`;

test(
  'an interrupted CLI kills its headless Chrome and removes the profile',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const dir = await makeTempDir({ 'hold.mjs': HOLDER });
    const child = spawn(process.execPath, [path.join(dir, 'hold.mjs')], {
      env: {
        PATH: process.env.PATH ?? '',
        HOME: await tempDir('rshow-home-'),
        CHROME: CHROME as string,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', () => {});
    const closed = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });

    const waitFor = async (pattern: RegExp): Promise<RegExpExecArray> => {
      const deadline = Date.now() + 90000;
      for (;;) {
        const found = pattern.exec(stdout);
        if (found !== null) return found;
        if (child.exitCode !== null) {
          throw new Error(`script exited ${child.exitCode}: ${stdout} ${stderr}`);
        }
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${pattern}: ${stdout} ${stderr}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    const pid = Number((await waitFor(/^pid: ([0-9]+)$/m))[1]);
    const profile = (await waitFor(/^profile: (.+)$/m))[1] as string;
    assert.ok(Number.isInteger(pid) && pid > 0, `chrome pid: ${pid}`);
    assert.equal(existsSync(profile), true, `the profile exists while chrome runs: ${profile}`);

    child.kill('SIGINT');
    assert.equal(await closed, 130, `${stdout}${stderr}`);
    assert.equal(existsSync(profile), false, `the profile is gone after the interrupt: ${profile}`);

    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        process.kill(pid, 0);
      } catch (err) {
        assert.equal((err as NodeJS.ErrnoException).code, 'ESRCH', (err as Error).message);
        return;
      }
      if (Date.now() > deadline) assert.fail(`chrome ${pid} is still running after the interrupt`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  },
);
