import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import katex from 'katex';
import { makeTempDir, runCli } from './helpers.ts';

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const THEME = fileURLToPath(new URL('../../../themes/default/', import.meta.url));

function page(body: string[], head: string[] = []): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    VIEWPORT,
    '<title>Math</title>',
    ...head,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
  ].join('\n');
}

const MATH_LINKS = ['<link rel="stylesheet" href="math.css">', '<script defer src="math.js"></script>'];
const MATH_FILES = { 'math.css': '.math{color:inherit}\n', 'math.js': 'console.log(1);\n' };

test('check passes good LaTeX in a span and in a div', async () => {
  const dir = await makeTempDir({
    'index.html': page(
      [
        '<p>The cost <span class="math">\\tau_{l,k}</span> is per unit.</p>',
        '<div class="math">T = \\sum_l \\sum_k \\tau_{l,k} m_{l,k} + \\varepsilon</div>',
      ],
      MATH_LINKS,
    ),
    ...MATH_FILES,
  });

  const result = await runCli(['check', dir, '--offline'], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok /m);
});

test('check reports bad LaTeX at the line of the element', async () => {
  const dir = await makeTempDir({
    'index.html': page(
      ['<p>The cost <span class="math">\\frac{1}{</span> is per unit.</p>', '<p>Fine.</p>'],
      MATH_LINKS,
    ),
    ...MATH_FILES,
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 6);
  assert.match(result.stdout, /^index\.html:10: error: bad LaTeX: /m);
  assert.match(result.stdout, /^check: 1 error, 0 warnings /m);
});

test('check decodes entities inside LaTeX, so a less-than sign is fine', async () => {
  const dir = await makeTempDir({
    'index.html': page(
      [
        '<div class="math">a &lt; b</div>',
        '<div class="math">\\begin{aligned} x &amp;= 1 \\\\ y &amp;= 2 \\end{aligned}</div>',
      ],
      MATH_LINKS,
    ),
    ...MATH_FILES,
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok /m);
});

test('check reads a dollar price as text, not as math', async () => {
  const dir = await makeTempDir({
    'index.html': page(['<p>One seat costs $5 and two cost $9, which is no formula.</p>']),
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes('bad LaTeX'), false);
  assert.match(result.stdout, /^check: ok /m);
});

test('check warns on math without math.js, and only on that page', async () => {
  const missing = await makeTempDir({
    'index.html': page(
      ['<p>The cost <span class="math">\\tau_{l,k}</span> is per unit.</p>'],
      ['<link rel="stylesheet" href="math.css">'],
    ),
    'math.css': MATH_FILES['math.css'],
  });
  const warned = await runCli(['check', missing], {});
  assert.equal(warned.code, 0);
  assert.match(
    warned.stdout,
    /^index\.html:9: warning: math without math\.js: the LaTeX shows as plain text$/m,
  );
  assert.match(warned.stdout, /^check: 0 errors, 1 warning /m);

  const linked = await makeTempDir({ 'index.html': page(['<p><span class="math">x</span></p>'], MATH_LINKS), ...MATH_FILES });
  const quiet = await runCli(['check', linked], {});
  assert.equal(quiet.code, 0);
  assert.match(quiet.stdout, /^check: ok /m);
});

test('check warns on math without math.css, so the equation prints twice', async () => {
  const dir = await makeTempDir({
    'index.html': page(
      ['<p>The cost <span class="math">\\tau_{l,k}</span> is per unit.</p>'],
      ['<script defer src="math.js"></script>'],
    ),
    'math.js': MATH_FILES['math.js'],
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:9: warning: math without math\.css: the equation prints twice$/m);
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('check reads math.js and math.css only when the name starts the value or follows a /', async () => {
  const dir = await makeTempDir({
    'index.html': page(
      ['<p>The cost <span class="math">\\tau_{l,k}</span> is per unit.</p>'],
      ['<link rel="stylesheet" href="xmath.css">', '<script defer src="xmath.js"></script>'],
    ),
    'xmath.css': '.math{color:inherit}\n',
    'xmath.js': 'console.log(1);\n',
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:10: warning: math without math\.js: /m);
  assert.match(result.stdout, /^index\.html:10: warning: math without math\.css: /m);
  assert.match(result.stdout, /^check: 0 errors, 2 warnings /m);
});

test('check warns on an unescaped < in LaTeX, which the browser eats as a tag', async () => {
  const dir = await makeTempDir({
    'index.html': page(['<div class="math">a <b</div>'], MATH_LINKS),
    ...MATH_FILES,
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:10: warning: math holds a tag: write < as &lt;$/m);
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('check warns on an equation that is not LaTeX', async () => {
  const dir = await makeTempDir({
    'index.html': page(
      ['<div class="equation" id="eq-bytes">', '<span>bytes(n) = sum of |f| for f whose hash is new</span>', '</div>'],
      MATH_LINKS,
    ),
    ...MATH_FILES,
  });

  const result = await runCli(['check', dir], {});
  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /^index\.html:10: warning: equation without class math: write it in LaTeX$/m,
  );
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('the vendored math.js is the KaTeX that check renders with', async () => {
  const text = await readFile(path.join(THEME, 'math.js'), 'utf8');
  assert.ok(text.includes(`KaTeX ${katex.version}`), `math.js names KaTeX ${katex.version}`);
  assert.ok(text.includes('katex'), 'math.js holds the library');
});

test('the vendored math.css names only woff2 files, and they exist', async () => {
  const text = await readFile(path.join(THEME, 'math.css'), 'utf8');
  assert.equal(/\.woff\)/.test(text), false, 'no woff url');
  assert.equal(/\.ttf\)/.test(text), false, 'no ttf url');

  const named = [...text.matchAll(/url\(fonts\/katex\/([^)]+)\)/g)].map((match) => match[1] as string);
  assert.ok(named.length > 0, 'math.css names its fonts');
  for (const name of named) {
    assert.ok(name.endsWith('.woff2'), `${name} is a woff2 file`);
    const info = await stat(path.join(THEME, 'fonts', 'katex', name)).catch(() => undefined);
    assert.notEqual(info, undefined, `fonts/katex/${name} exists`);
  }
});

test('theme.json names the math addon', async () => {
  const json = JSON.parse(await readFile(path.join(THEME, 'theme.json'), 'utf8')) as {
    addons?: { math?: { css?: string[]; js?: string[]; example?: string } };
    layouts: Record<string, unknown>;
  };
  assert.deepEqual(json.addons, {
    math: { css: ['math.css'], js: ['math.js'], example: 'example/report.html' },
  });
  assert.equal('math' in json.layouts, false, 'math is an addon, not a layout');
});
