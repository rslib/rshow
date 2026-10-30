import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

declare const __RSHOW_VERSION__: string;

function versionFromPackage(): string {
  try {
    const file = fileURLToPath(new URL('../package.json', import.meta.url));
    const body = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// The bundle replaces __RSHOW_VERSION__ at build time; running from src reads
// packages/cli/package.json instead, which sits one folder above both src/ and
// dist/.
export const VERSION: string = typeof __RSHOW_VERSION__ === 'string' ? __RSHOW_VERSION__ : versionFromPackage();
