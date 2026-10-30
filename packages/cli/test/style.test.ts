import assert from 'node:assert/strict';
import test from 'node:test';
import { stylePathSkipped } from '../src/style.ts';
import { makeTempDir, runCli } from './helpers.ts';
import type { CliResult } from './helpers.ts';

const HEAD = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Style</title>',
];

const FLAME = String.fromCodePoint(0x1f525);
const SPARKLE = String.fromCodePoint(0x2728);

function page(style: string, body = '<p>hi</p>'): string {
  return [...HEAD, `<style>${style}</style>`, '</head>', `<body>${body}</body>`, '</html>'].join('\n');
}

async function check(files: Record<string, string>, extra: string[] = []): Promise<CliResult> {
  const dir = await makeTempDir(files);
  return runCli(['check', dir, '--offline', ...extra], {});
}

test('style warns on uppercase eyebrow labels with wide letter-spacing', async () => {
  const flagged = await check({
    'index.html': page('.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; }'),
    'site.css': [
      '.eyebrow{text-transform:uppercase;letter-spacing:1px}',
      '.kicker { text-transform: uppercase }',
      '.tight { text-transform: uppercase; letter-spacing: 0.4px }',
      '.fine { text-transform: uppercase; letter-spacing: 0.02em }',
      '.plain { letter-spacing: 0.2em }',
    ].join('\n'),
  });
  assert.equal(flagged.code, 0);
  assert.match(
    flagged.stdout,
    /^index\.html:6: warning: eyebrow label: text-transform: uppercase with letter-spacing 0\.12em$/m,
  );
  assert.match(
    flagged.stdout,
    /^site\.css:1: warning: eyebrow label: text-transform: uppercase with letter-spacing 1px$/m,
  );
  assert.match(flagged.stdout, /^check: 0 errors, 2 warnings /m);
});

test('style warns on decorative zero-padded numbering at three elements', async () => {
  const numbered = await check({
    'index.html': page(
      'ol { list-style: none }',
      ['<ol>', '<li>01</li>', '<li>02</li>', '<li>03</li>', '</ol>'].join('\n'),
    ),
  });
  assert.equal(numbered.code, 0);
  assert.match(
    numbered.stdout,
    /^index\.html:9: warning: decorative numbering: 3 elements whose whole text is a zero-padded number$/m,
  );
  assert.match(numbered.stdout, /^check: 0 errors, 1 warning /m);

  const two = await check({
    'index.html': page('ol { list-style: none }', ['<ol>', '<li>01</li>', '<li>02</li>', '</ol>'].join('\n')),
  });
  assert.equal(two.code, 0);
  assert.match(two.stdout, /^check: ok /m);
});

test('style warns on gradient text', async () => {
  const result = await check({
    'index.html': page([
      '.a { -webkit-background-clip: text; }',
      '.b { background-clip: text; }',
      '.c { background-clip: padding-box; }',
    ].join('\n')),
    'site.css': '.d{-webkit-background-clip:text}',
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:6: warning: gradient text: background-clip: text$/m);
  assert.match(result.stdout, /^index\.html:7: warning: gradient text: background-clip: text$/m);
  assert.match(result.stdout, /^site\.css:1: warning: gradient text: background-clip: text$/m);
  assert.match(result.stdout, /^check: 0 errors, 3 warnings /m);
});

test('style warns on the trendy default fonts', async () => {
  const result = await check({
    'site.css': [
      'a{font-family:Inter,sans-serif}',
      'b{font-family:"Space Grotesk",sans-serif}',
      'c{font-family:Geist}',
      'd{font-family:"Fraunces",serif}',
      'e{font-family:"Instrument Serif",serif}',
      'f{font-family:Poppins}',
      'g{font-family:"Montserrat",sans-serif}',
      'h{font-family:ui-serif,serif}',
    ].join('\n'),
    'index.html': page('body { color: #111 }'),
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^site\.css:1: warning: trendy default font: Inter$/m);
  assert.match(result.stdout, /^site\.css:2: warning: trendy default font: Space Grotesk$/m);
  assert.match(result.stdout, /^site\.css:3: warning: trendy default font: Geist$/m);
  assert.match(result.stdout, /^site\.css:4: warning: trendy default font: Fraunces$/m);
  assert.match(result.stdout, /^site\.css:5: warning: trendy default font: Instrument Serif$/m);
  assert.match(result.stdout, /^site\.css:6: warning: trendy default font: Poppins$/m);
  assert.match(result.stdout, /^site\.css:7: warning: trendy default font: Montserrat$/m);
  assert.match(result.stdout, /^check: 0 errors, 7 warnings /m);
});

test('style warns on a font-family name that nothing loads', async () => {
  const unused = check({ 'index.html': page('p { font-family: "Ghost Sans", serif; }') });
  const loose = await unused;
  assert.equal(loose.code, 0);
  assert.match(
    loose.stdout,
    /^index\.html:6: warning: font not loaded: Ghost Sans \(no @font-face, \/_themes\/ fonts or Google Fonts link\)$/m,
  );
  assert.match(loose.stdout, /^check: 0 errors, 1 warning /m);

  const face = await check({
    'index.html': page('p { font-family: "Ghost Sans", serif; }', '<p>hi</p>').replace(
      '<style>',
      '<link rel="stylesheet" href="fonts.css">\n<style>',
    ),
    'fonts.css': '@font-face{font-family:"Ghost Sans";src:url(ghost.woff2)}',
    'ghost.woff2': 'font',
  });
  assert.equal(face.code, 0);
  assert.match(face.stdout, /^check: ok /m);

  const google = await check({
    'index.html': page('p { font-family: "IBM Plex Sans", serif; }').replace(
      '<style>',
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans&display=swap">\n<style>',
    ),
  });
  assert.equal(google.code, 0);
  assert.match(google.stdout, /^check: ok /m);

  const theme = await check({
    'index.html': page('p { font-family: "IBM Plex Mono", monospace; }').replace(
      '<style>',
      '<link rel="stylesheet" href="/_themes/default@1/fonts.css">\n<style>',
    ),
  });
  assert.equal(theme.code, 0);
  assert.match(theme.stdout, /^check: ok /m);

  const generic = await check({
    'index.html': page('p { font-family: system-ui, ui-monospace, sans-serif } b { font-family: var(--font) }'),
  });
  assert.equal(generic.code, 0);
  assert.match(generic.stdout, /^check: ok /m);
});

test('style warns on a cream plus terracotta palette', async () => {
  const result = await check({
    'site.css': [
      'body { background: #fdf6ec }',
      '.a { border: 1px solid #c2410c }',
      '.b { color: #b4471f }',
    ].join('\n'),
    'index.html': page('body { color: #111 }'),
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^site\.css:1: warning: cream and terracotta palette: #fdf6ec background with #c2410c$/m);
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);

  const cool = await check({
    'site.css': 'body { background: #fdf6ec; color: #1f2937; border-color: #3b82f6 }',
    'index.html': page('body { color: #111 }'),
  });
  assert.equal(cool.code, 0);
  assert.match(cool.stdout, /^check: ok /m);

  const creamOnly = await check({
    'site.css': 'body { background: #fdf6ec }',
    'index.html': page('body { color: #111 }'),
  });
  assert.equal(creamOnly.code, 0);
  assert.match(creamOnly.stdout, /^check: ok /m);
});

test('style warns on emoji in visible text', async () => {
  const visible = await check({
    'index.html': page('p { color: #111 }', `<p>Ship it faster ${FLAME} and better ${SPARKLE}</p>`),
  });
  assert.equal(visible.code, 0);
  assert.match(
    visible.stdout,
    /^index\.html:8: warning: emoji in visible text: 2 emoji \(U\+1F525, U\+2728\)$/m,
  );
  assert.match(visible.stdout, /^check: 0 errors, 1 warning /m);

  const hidden = await check({
    'index.html': page(
      'p { color: #111 }',
      [
        `<!-- ${FLAME} -->`,
        `<img src="a.png" alt="${FLAME}">`,
        `<script>const label = '${FLAME}';</script>`,
      ].join('\n'),
    ),
    'a.png': 'png',
  });
  assert.equal(hidden.code, 0);
  assert.match(hidden.stdout, /^check: ok /m);
});

test('style warns on glass and heavy shadow', async () => {
  const result = await check({
    'site.css': [
      '.glass { backdrop-filter: blur(20px) }',
      '.heavy { box-shadow: 0 8px 40px rgba(0, 0, 0, 0.2) }',
      '.light { box-shadow: 0 1px 8px rgba(0, 0, 0, 0.1) }',
      '.inset { box-shadow: inset 0 2px 4px #0003 }',
    ].join('\n'),
    'index.html': page('body { color: #111 }'),
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^site\.css:1: warning: glass and heavy shadow: backdrop-filter: blur$/m);
  assert.match(result.stdout, /^site\.css:2: warning: glass and heavy shadow: box-shadow blur 40px$/m);
  assert.match(result.stdout, /^check: 0 errors, 2 warnings /m);
});

test('style warns on purple-blue gradients', async () => {
  const result = await check({
    'site.css': [
      '.a { background-image: linear-gradient(135deg, #7c3aed, #3b82f6) }',
      '.b { background-image: linear-gradient(135deg, #7c3aed, #f97316) }',
      '.c { background-image: linear-gradient(135deg, #3b82f6, #f97316) }',
    ].join('\n'),
    'index.html': page('body { color: #111 }'),
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^site\.css:1: warning: purple-blue gradient: #7c3aed to #3b82f6$/m);
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('style skips fonts/ and vendored min files', async () => {
  const result = await check({
    'index.html': page('body { color: #111 }'),
    'fonts/deck.css': '.eyebrow{text-transform:uppercase;letter-spacing:.4em}',
    'vendor.min.css': '.g{-webkit-background-clip:text}',
    'sub/app.min.css': 'p{font-family:"Ghost Sans"}',
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok /m);

  assert.equal(stylePathSkipped('fonts/a.css'), true);
  assert.equal(stylePathSkipped('sub/fonts/a.css'), true);
  assert.equal(stylePathSkipped('vendor.min.css'), true);
  assert.equal(stylePathSkipped('a/dep.min.js'), true);
  assert.equal(stylePathSkipped('site.css'), false);
});

test('style warnings keep the exit code and --no-style silences them', async () => {
  const files = {
    'index.html': page('.eyebrow { text-transform: uppercase; letter-spacing: 0.12em }'),
    'site.css': '.glass { backdrop-filter: blur(20px) }',
  };
  const warned = await check(files);
  assert.equal(warned.code, 0);
  assert.match(warned.stdout, /^check: 0 errors, 2 warnings /m);

  const skipped = await check(files, ['--no-style']);
  assert.equal(skipped.code, 0);
  assert.match(skipped.stdout, /^check: ok /m);
});

test('check help documents the style warnings', async () => {
  const dir = await makeTempDir({ 'index.html': page('body { color: #111 }') });
  const result = await runCli(['check', '--help'], {});
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Style warnings:$/m);
  assert.match(result.stdout, /--no-style skips all of them\./);
  assert.match(result.stdout, /^  purple-blue gradients: /m);
  assert.equal(dir.length > 0, true);
});
