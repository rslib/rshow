import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Chrome, Page, findChrome } from '../src/cdp.ts';
import { startPreview } from '../src/serve.ts';

function chromeBinary(): string | undefined {
  try {
    return findChrome();
  } catch {
    return undefined;
  }
}

const CHROME = chromeBinary();

// The theme as it ships, served as the preview root: example/index.html is the
// real deck runtime, not a copy of it.
const THEME = fileURLToPath(new URL('../../../themes/default/', import.meta.url));

const DECK = '/example/index.html';

const CURRENT = 'window.rshowDeck.current()';
const HASH = 'window.location.hash';
const SELECTION = 'String(window.getSelection())';

// The first line of the active slide title, in screen space.
const TITLE_LINE = `(function () {
  var title = document.querySelector('main.deck > .slide.is-active h1, main.deck > .slide.is-active h2');
  if (title === null) return null;
  var range = document.createRange();
  range.selectNodeContents(title);
  var rects = range.getClientRects();
  for (var i = 0; i < rects.length; i += 1) {
    if (rects[i].width > 8) {
      return { left: rects[i].left, right: rects[i].right, top: rects[i].top, bottom: rects[i].bottom };
    }
  }
  return null;
})()`;

// A point on a word of the active slide title, so a double click has something
// to select that is not a space.
const TITLE_WORD = `(function () {
  var title = document.querySelector('main.deck > .slide.is-active h1, main.deck > .slide.is-active h2');
  if (title === null) return null;
  var walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT, null, false);
  var node = walker.nextNode();
  while (node !== null) {
    var text = node.nodeValue || '';
    var found = /[A-Za-z]{4,}/.exec(text);
    if (found !== null) {
      var range = document.createRange();
      range.setStart(node, found.index);
      range.setEnd(node, found.index + found[0].length);
      var rects = range.getClientRects();
      if (rects.length > 0) {
        return {
          x: Math.round(rects[0].left + rects[0].width / 2),
          y: Math.round(rects[0].top + rects[0].height / 2),
          word: found[0]
        };
      }
    }
    node = walker.nextNode();
  }
  return null;
})()`;

// The same question deck.js asks before it treats a click as a key press: is
// there text under the point? Client rects are in screen space already, so the
// scale of the deck canvas needs no maths here either.
function onText(x: number, y: number): string {
  return `(function () {
    function onText(x, y) {
      try {
        var node = null;
        if (document.caretRangeFromPoint) {
          var caret = document.caretRangeFromPoint(x, y);
          node = caret === null ? null : caret.startContainer;
        } else if (document.caretPositionFromPoint) {
          var position = document.caretPositionFromPoint(x, y);
          node = position === null ? null : position.offsetNode;
        }
        if (node === null || node.nodeType !== 3) return false;
        var range = document.createRange();
        range.selectNodeContents(node);
        var rects = range.getClientRects();
        for (var i = 0; i < rects.length; i += 1) {
          if (x >= rects[i].left && x <= rects[i].right && y >= rects[i].top && y <= rects[i].bottom) return true;
        }
        return false;
      } catch (err) {
        return false;
      }
    }
    return onText(${x}, ${y});
  })()`;
}

// The empty corner of the active slide: 20px in from the bottom right, which is
// past the text blocks and clear of the page counter.
const EMPTY_POINT = `(function () {
  var slide = document.querySelector('main.deck > .slide.is-active');
  if (slide === null) return null;
  var box = slide.getBoundingClientRect();
  return { x: Math.round(box.right) - 20, y: Math.round(box.bottom) - 20 };
})()`;

type Rect = { left: number; right: number; top: number; bottom: number };
type Point = { x: number; y: number };
type KeySpec = { key: string; code: string; vk: number };

const ARROWS: Record<string, KeySpec> = {
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
};

async function press(page: Page, name: string): Promise<void> {
  const spec = ARROWS[name];
  assert.ok(spec !== undefined, `a key spec for ${name}`);
  const common = {
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk,
  };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

async function mouse(
  page: Page,
  type: string,
  point: Point,
  clickCount = 1,
): Promise<void> {
  await page.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount,
  });
}

// One page, one browser. The page goes before the browser it lives in, or its
// close waits on a devtools socket that is already gone.
async function open(t: { after: (fn: () => unknown) => void }): Promise<Page> {
  const preview = await startPreview({ dir: THEME, theme: THEME, root: 'theme', port: 0, offline: true, reload: false });
  const chrome = await Chrome.launch({ binary: CHROME });
  const page = await Page.open(chrome);
  t.after(() => page.close());
  t.after(() => chrome.close());
  t.after(() => preview.close());
  await page.setViewport(1440, 900);
  await page.navigate(`${preview.url}${DECK}`);
  await page.settle();
  return page;
}

test(
  'a drag across the slide title selects text and stays on the slide',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    const line = await page.evaluate<Rect | null>(TITLE_LINE);
    assert.ok(line !== null, 'the active slide has a title');
    const y = Math.round((line.top + line.bottom) / 2);
    const start = { x: Math.round(line.left) + 2, y };
    const middle = { x: Math.round(line.left + (line.right - line.left) / 2), y };

    await mouse(page, 'mousePressed', start);
    await mouse(page, 'mouseMoved', { x: Math.round((start.x + middle.x) / 2), y });
    await mouse(page, 'mouseMoved', middle);
    await mouse(page, 'mouseReleased', middle, 1);
    await page.settle(200);

    assert.equal(await page.evaluate<number>(CURRENT), 1, 'a drag on text does not advance the slide');
    assert.notEqual(await page.evaluate<string>(SELECTION), '', 'the drag selected text to copy');
  },
);

test(
  'a double click on a word of the title selects it and stays on the slide',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    const word = await page.evaluate<Point & { word: string } | null>(TITLE_WORD);
    assert.ok(word !== null, 'the title has a word to double click');
    const point = { x: word.x, y: word.y };

    await mouse(page, 'mousePressed', point, 1);
    await mouse(page, 'mouseReleased', point, 1);
    await mouse(page, 'mousePressed', point, 2);
    await mouse(page, 'mouseReleased', point, 2);
    await page.settle(200);

    assert.equal(await page.evaluate<number>(CURRENT), 1, 'a double click on text does not advance the slide');
    assert.notEqual(await page.evaluate<string>(SELECTION), '', 'the double click selected a word to copy');
  },
);

test(
  'a click on empty slide space advances',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    const point = await page.evaluate<Point | null>(EMPTY_POINT);
    assert.ok(point !== null, 'the active slide has a box to click in');
    assert.equal(
      await page.evaluate<boolean>(onText(point.x, point.y)),
      false,
      `the point ${point.x},${point.y} is not on text`,
    );

    await mouse(page, 'mousePressed', point, 1);
    await mouse(page, 'mouseReleased', point, 1);
    await page.settle(200);

    assert.equal(await page.evaluate<number>(CURRENT), 2, 'a click on empty space advances the slide');
  },
);

test(
  'the hash follows quick presses instead of staying on an old slide',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    // Each immediate write is a call the browser counts, and past its limit it
    // drops them without a word: count the calls so a burst is one write.
    await page.evaluate<string>(`(function () {
      window.hashWrites = 0;
      var original = window.history.replaceState;
      window.history.replaceState = function () {
        window.hashWrites += 1;
        return original.apply(window.history, arguments);
      };
      return '';
    })()`);

    for (let k = 0; k < 60; k += 1) {
      await press(page, 'ArrowRight');
    }
    for (let k = 0; k < 60; k += 1) {
      await press(page, 'ArrowLeft');
    }
    for (let k = 0; k < 6; k += 1) {
      await press(page, 'ArrowRight');
    }
    await page.settle(600);

    const slide = await page.evaluate<number>(CURRENT);
    assert.equal(await page.evaluate<string>(HASH), `#${slide}`, `the hash names slide ${slide}`);
    const writes = await page.evaluate<number>('window.hashWrites');
    assert.ok(writes <= 2, `a burst of key presses is one history write, not ${writes}`);
  },
);
