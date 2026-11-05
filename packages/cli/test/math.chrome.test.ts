import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Chrome, Page, findChrome } from '../src/cdp.ts';
import { startPreview } from '../src/serve.ts';
import { makeTempDir } from './helpers.ts';

function chromeBinary(): string | undefined {
  try {
    return findChrome();
  } catch {
    return undefined;
  }
}

const CHROME = chromeBinary();

// The theme as it ships, served as the preview root: example/report.html is the
// real report runtime with the real vendored KaTeX, not a copy of it.
const THEME = fileURLToPath(new URL('../../../themes/default/', import.meta.url));

const REPORT = '/example/report.html';
const DECK = '/example/index.html';

const PHONE = { width: 390, height: 844 };

type EquationFacts = {
  rendered: boolean;
  family: string;
  monoFamily: string;
  number: string;
  visible: string;
  loaded: boolean;
};

const EQUATION = `(function () {
  var box = document.querySelector('.equation .math');
  if (box === null) return null;
  var node = box.querySelector('.katex');
  var html = box.querySelector('.katex-html');
  var number = document.querySelector('.equation .eq-num');
  return {
    rendered: node !== null,
    family: node === null ? '' : window.getComputedStyle(node).fontFamily,
    monoFamily: window.getComputedStyle(box).fontFamily,
    number: number === null ? '' : number.textContent,
    visible: html === null ? '' : html.textContent,
    loaded: document.fonts.check('20px KaTeX_Main')
  };
})()`;

// The copy handler of the MathML layer answers a copy with the LaTeX of the
// whole equation, so a reader pastes an equation and not its glyph soup.
const COPY = `(function () {
  var target = document.querySelector('.equation .math .katex');
  if (target === null) return null;
  var range = document.createRange();
  range.selectNodeContents(target);
  var selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  var data = new DataTransfer();
  target.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }));
  return data.getData('text/plain');
})()`;

const WIDTH = `(function () {
  return { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth };
})()`;

// The number of the slide that carries the equation, counted the way deck.js
// counts them: one per <section class="slide"> under main.deck, from 1.
const MATH_SLIDE = `(function () {
  var slides = document.querySelectorAll('main.deck > .slide');
  for (var i = 0; i < slides.length; i += 1) {
    if (slides[i].querySelector('.math') !== null) return i + 1;
  }
  return null;
})()`;

const ACTIVE_MATH = `(function () {
  var slide = document.querySelector('main.deck > .slide.is-active');
  if (slide === null) return null;
  var box = slide.querySelector('.math');
  return box === null ? null : box.querySelector('.katex') !== null;
})()`;

const NOTES = `(function () {
  var note = document.querySelector('aside.notes .math');
  var line = document.querySelector('p .math');
  return {
    slide: line === null ? null : line.querySelector('.katex') !== null,
    note: note === null ? null : note.querySelector('.katex') !== null,
    source: note === null ? '' : note.textContent
  };
})()`;

const NOTE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notes</title>
<link rel="stylesheet" href="math.css">
</head>
<body>
<p>The cost <span class="math">\\tau_{l,k}</span> is per unit.</p>
<aside class="notes"><p>Say that <span class="math">\\frac{1}{2}</span> of it is fixed cost.</p></aside>
<script defer src="math.js"></script>
</body></html>`;

// A root over a fraction is the tallest thing an equation holds, and it is put
// on a slide, where the equation takes the size of a heading.
const TALL_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tall</title>
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="math.css">
</head>
<body>
<main class="deck"><section class="slide bullets">
<h2>A square root over a fraction is taller than a line of text</h2>
<div class="math">\\hat{\\sigma} = \\sqrt{\\frac{1}{n-1}\\sum_{i=1}^{n}(x_i-\\bar{x})^2}</div>
</section></main>
<script defer src="math.js"></script>
</body></html>`;

const TALL = `(function () {
  var box = document.querySelector('div.math');
  if (box === null || box.querySelector('.katex') === null) return null;
  return { scroll: box.scrollHeight, client: box.clientHeight };
})()`;

// The size of the equation on the math slide of the deck, and the box of the
// text of its title, so the two can be compared at one canvas size.
const SLIDE_MATH = `(function () {
  var slides = document.querySelectorAll('main.deck > .slide');
  for (var i = 0; i < slides.length; i += 1) {
    var slide = slides[i];
    var box = slide.querySelector('div.math');
    var heading = slide.querySelector('h2');
    if (box === null || heading === null) continue;
    var html = box.querySelector('.katex-html');
    if (html === null) return null;
    var range = document.createRange();
    range.selectNodeContents(heading);
    return {
      size: parseFloat(window.getComputedStyle(box).fontSize),
      html: html.getBoundingClientRect().left,
      heading: range.getBoundingClientRect().left
    };
  }
  return null;
})()`;

// One browser, one page, two previews: the theme as it ships and a page of its
// own that keeps the math out of the notes. The page goes before the browser it
// lives in, or its close waits on a devtools socket that is already gone.
async function open(t: { after: (fn: () => unknown) => void }): Promise<{ page: Page; theme: string; notes: string }> {
  const theme = await startPreview({ dir: THEME, theme: THEME, root: 'theme', port: 0, offline: true, reload: false });
  const copy = await makeTempDir({
    'index.html': NOTE_PAGE,
    'tall.html': TALL_PAGE,
    'tokens.css': await readFile(path.join(THEME, 'tokens.css'), 'utf8'),
    'math.css': await readFile(path.join(THEME, 'math.css'), 'utf8'),
    'math.js': await readFile(path.join(THEME, 'math.js'), 'utf8'),
  });
  const notes = await startPreview({ dir: copy, port: 0, offline: true, reload: false });
  const chrome = await Chrome.launch({ binary: CHROME });
  const page = await Page.open(chrome);
  t.after(() => page.close());
  t.after(() => chrome.close());
  t.after(() => notes.close());
  t.after(() => theme.close());
  await page.setViewport(1440, 900);
  return { page, theme: theme.url, notes: notes.url };
}

test(
  'the report sets its equation in KaTeX, in its own serif and not in mono',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, theme } = await open(t);
    await page.navigate(`${theme}${REPORT}`);

    const facts = await page.evaluate<EquationFacts | null>(EQUATION);
    assert.ok(facts !== null, 'the report has an equation');
    assert.equal(facts.rendered, true, 'the equation holds a .katex element');
    assert.ok(facts.family.startsWith('KaTeX_Main'), `the equation is set in ${facts.family}`);
    assert.equal(facts.monoFamily.includes('Mono'), false, `the equation is not mono: ${facts.monoFamily}`);
    assert.equal(facts.number, '(1)', 'report.js numbers the equation');
    assert.equal(facts.visible.includes('\\'), false, `the rendered equation has no raw LaTeX: ${facts.visible}`);
    assert.ok(facts.visible.includes('bytes'), 'the rendered equation reads bytes');
    assert.equal(facts.loaded, true, 'the KaTeX_Main font is loaded');
  },
);

test(
  'a copy of the equation gives its LaTeX',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, theme } = await open(t);
    await page.navigate(`${theme}${REPORT}`);

    const text = await page.evaluate<string | null>(COPY);
    assert.ok(text !== null, 'the report has an equation to copy');
    assert.ok(text.includes('\\sum'), `the clipboard holds the LaTeX: ${text}`);
  },
);

test(
  'the report has no sideways scroll on a phone',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, theme } = await open(t);
    await page.setViewport(PHONE.width, PHONE.height);
    await page.navigate(`${theme}${REPORT}`);
    await page.settle(600);

    const box = await page.evaluate<{ scroll: number; client: number }>(WIDTH);
    assert.ok(
      box.scroll <= box.client,
      `the report keeps the width of the phone: scrollWidth is ${box.scroll} at ${box.client}`,
    );
  },
);

test(
  'the deck renders the math slide and keeps the notes as words',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, theme, notes } = await open(t);
    await page.navigate(`${theme}${DECK}`);
    await page.settle(600);

    const slide = await page.evaluate<number | null>(MATH_SLIDE);
    assert.ok(slide !== null, 'the deck has a slide with math');

    // A hash on the same document is no page load, so the page is left and
    // opened again at the slide, which is what a reader's link does.
    await page.navigate('about:blank');
    await page.navigate(`${theme}${DECK}#${slide}`);
    await page.settle(600);
    assert.equal(await page.evaluate<boolean | null>(ACTIVE_MATH), true, `slide ${slide} renders its equation`);

    await page.navigate(notes);
    await page.settle(600);
    const facts = await page.evaluate<{ slide: boolean | null; note: boolean | null; source: string }>(NOTES);
    assert.equal(facts.slide, true, 'the slide math is rendered');
    assert.equal(facts.note, false, 'a note is left as the LaTeX its speaker wrote');
    assert.equal(facts.source, '\\frac{1}{2}', 'the note keeps its source text');
  },
);

test(
  'the deck sets its equation at the size of a heading, flush left under the title',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, theme } = await open(t);
    await page.setViewport(1280, 720);
    await page.navigate(`${theme}${DECK}`);
    await page.settle(600);

    const facts = await page.evaluate<{ size: number; html: number; heading: number } | null>(SLIDE_MATH);
    assert.ok(facts !== null, 'the deck has a slide with a title and an equation');
    assert.equal(facts.size, 32, `the equation is set at 32px, not ${facts.size}px`);
    assert.ok(
      Math.abs(facts.html - facts.heading) <= 2,
      `the equation starts under the title: ${facts.html} against ${facts.heading}`,
    );
  },
);

test(
  'a square root over a fraction is not clipped by its box',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, notes } = await open(t);
    await page.setViewport(1280, 720);
    await page.navigate(`${notes}/tall.html`);
    await page.settle(600);

    const box = await page.evaluate<{ scroll: number; client: number } | null>(TALL);
    assert.ok(box !== null, 'the page renders the square root over the fraction');
    assert.ok(
      box.scroll <= box.client,
      `the equation fits its box: scrollHeight ${box.scroll} against clientHeight ${box.client}`,
    );
  },
);
