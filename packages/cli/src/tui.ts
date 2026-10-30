import { spawn } from 'node:child_process';
import { ApiError } from './exit.ts';

export const ANSI_PATTERN =
  // CSI, OSC and the two byte escapes a terminal pane may carry.
  /[\u001b\u009b](?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[@-_])/g;

export type TuiRow = { row: number; expected: string; actual: string };
export type TuiDiff = { rows: number; differing: TuiRow[]; pass: boolean };

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export function trimTrailing(text: string): string {
  return text.replace(/[ \t]+$/gm, '');
}

export function compareGrid(expected: string, actual: string): TuiDiff {
  const left = trimTrailing(expected.replace(/\r\n/g, '\n')).split('\n');
  const right = trimTrailing(actual.replace(/\r\n/g, '\n')).split('\n');
  while (left.length > 0 && left[left.length - 1] === '') left.pop();
  while (right.length > 0 && right[right.length - 1] === '') right.pop();
  const rows = Math.max(left.length, right.length);
  const differing: TuiRow[] = [];
  for (let index = 0; index < rows; index += 1) {
    const before = left[index] ?? '';
    const after = right[index] ?? '';
    if (before === after) continue;
    differing.push({ row: index + 1, expected: before, actual: after });
  }
  return { rows, differing, pass: differing.length === 0 };
}

export function captureTmux(target: string, bin = 'tmux'): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ['capture-pane', '-p', '-e', '-t', target], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      reject(new ApiError(`cannot run ${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new ApiError(stderr.trim() === '' ? `${bin} exited ${code}` : stderr.trim()));
        return;
      }
      resolve(stdout);
    });
  });
}
