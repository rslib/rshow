import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Node 26 runs test/index.js for `node --test test/`, which imports the files it
// lists, so one that is missing from the list runs nowhere.
test('every test file in this folder is imported by index.js', async () => {
  const index = await readFile(path.join(DIR, 'index.js'), 'utf8');
  const files = (await readdir(DIR)).filter((name) => name.endsWith('.test.ts')).sort();
  assert.ok(files.length > 0);
  const missing = files.filter((name) => !index.includes(`import './${name}';`));
  assert.deepEqual(missing, [], `index.js does not import: ${missing.join(', ')}`);
});
