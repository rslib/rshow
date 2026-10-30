import process from 'node:process';

export function warn(message: string): void {
  process.stderr.write(`rshow: warning: ${message}\n`);
}
