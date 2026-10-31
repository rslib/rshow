import assert from 'node:assert/strict';
import test from 'node:test';
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

// The theme files are served from the repo through the preview's /_themes/
// route, so the page under test is the real mockup runtime.
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Mockup</title>
<link rel="stylesheet" href="/_themes/default@3/tokens.css">
<link rel="stylesheet" href="/_themes/default@3/mockup.css">
<link rel="stylesheet" href="/_themes/default@3/skins/wire.css">
</head>
<body style="margin:0">
<main class="mockup" data-skin="wire">
  <section class="artboard" id="approve" data-frame="browser" data-title="Approve" data-states="approval">
    <p>Review the request.</p>
    <input id="field" aria-label="Message">
    <div data-state="approval">Approved.</div>
  </section>
  <section class="artboard" id="done" data-frame="browser" data-title="Done">
    <p>Every request is settled.</p>
  </section>
</main>
<script src="/_themes/default@3/mode.js"></script>
<script src="/_themes/default@3/mockup.js"></script>
</body></html>`;

type Box = { x: number; y: number; width: number; height: number };

const BUTTON_BOX = `(function () {
  var all = document.querySelectorAll('.mk-state');
  for (var i = 0; i < all.length; i += 1) {
    if (all[i].textContent === 'approval') {
      var rect = all[i].getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        width: rect.width,
        height: rect.height
      };
    }
  }
  return null;
})()`;

const PRESSED = `(function () {
  var all = document.querySelectorAll('.mk-state');
  for (var i = 0; i < all.length; i += 1) {
    if (all[i].textContent === 'approval') return all[i].getAttribute('aria-pressed');
  }
  return null;
})()`;

// Which artboard carries the selection, in `boards` order.
const SELECTED = `Array.prototype.map.call(document.querySelectorAll('.artboard'), function (board) {
  return board.id + ':' + board.classList.contains('is-selected');
}).join(',')`;

// The canvas pan and zoom, as [tx, ty, zoom] out of the inline transform.
const TRANSFORM = `(function () {
  var world = document.querySelector('.mk-world');
  var found = /translate\\((-?[0-9.]+)px,\\s*(-?[0-9.]+)px\\)\\s*scale\\(([0-9.]+)\\)/.exec(world.style.transform);
  return found === null ? null : [Number(found[1]), Number(found[2]), Number(found[3])];
})()`;

const VIEW = 'document.querySelector(".mockup").getAttribute("data-view")';

type KeySpec = { key: string; code: string; vk: number; shift?: boolean; text?: string };

const KEYS: Record<string, KeySpec> = {
  ']': { key: ']', code: 'BracketRight', vk: 221 },
  '[': { key: '[', code: 'BracketLeft', vk: 219 },
  d: { key: 'd', code: 'KeyD', vk: 68 },
  a: { key: 'a', code: 'KeyA', vk: 65 },
  z: { key: 'z', code: 'KeyZ', vk: 90 },
  '?': { key: '?', code: 'Slash', vk: 191, shift: true, text: '?' },
  '2': { key: '2', code: 'Digit2', vk: 50, text: '2' },
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
};

async function press(page: Page, name: string): Promise<void> {
  const spec = KEYS[name];
  assert.ok(spec !== undefined, `a key spec for ${name}`);
  const common = {
    modifiers: spec.shift === true ? 8 : 0,
    key: spec.key,
    code: spec.code,
    windowsVirtualKeyCode: spec.vk,
    nativeVirtualKeyCode: spec.vk,
  };
  const typed = spec.text === undefined ? {} : { text: spec.text, unmodifiedText: spec.text };
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', ...common, ...typed });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

// One page, one browser. The page goes before the browser it lives in, or its
// close waits on a devtools socket that is already gone.
async function open(t: { after: (fn: () => unknown) => void }): Promise<Page> {
  const dir = await makeTempDir({ 'index.html': PAGE });
  const preview = await startPreview({ dir, port: 0, offline: true, reload: false });
  const chrome = await Chrome.launch({ binary: CHROME });
  const page = await Page.open(chrome);
  t.after(() => page.close());
  t.after(() => chrome.close());
  t.after(() => preview.close());
  await page.setViewport(1440, 900);
  await page.navigate(`${preview.url}/`);
  return page;
}

test(
  'a state button above the screen takes a click in canvas view',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    assert.equal(await page.evaluate<string>(VIEW), 'canvas');
    assert.equal(await page.evaluate<string>(PRESSED), 'false');

    const box = await page.evaluate<Box | null>(BUTTON_BOX);
    assert.ok(box !== null, 'the approval state button is on the page');
    assert.ok(box.x > 0 && box.x < 1440 && box.y > 0 && box.y < 900, `the button is in view: ${JSON.stringify(box)}`);

    await page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: box.x,
      y: box.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: box.x,
      y: box.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await page.settle();

    assert.equal(await page.evaluate<string>(PRESSED), 'true');
  },
);

test(
  'the keys select a screen, pan the canvas and open one',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    assert.equal(await page.evaluate<string>(SELECTED), 'approve:false,done:false');
    await press(page, ']');
    assert.equal(await page.evaluate<string>(SELECTED), 'approve:true,done:false');
    await press(page, ']');
    assert.equal(await page.evaluate<string>(SELECTED), 'approve:false,done:true');
    await press(page, '[');
    assert.equal(await page.evaluate<string>(SELECTED), 'approve:true,done:false');

    // 100% first, so the canvas is wider than the stage and can move at all.
    await press(page, 'z');
    await page.settle();
    const before = await page.evaluate<number[] | null>(TRANSFORM);
    assert.ok(before !== null, 'the world carries a transform');
    await press(page, 'd');
    await page.settle();
    const after = await page.evaluate<number[] | null>(TRANSFORM);
    assert.ok(after !== null, 'the world carries a transform');
    assert.ok(after[0] < before[0], `d moves the canvas left: ${before[0]} to ${after[0]}`);
    assert.equal(after[2], before[2], 'a pan keeps the zoom');

    await press(page, 'Enter');
    await page.settle();
    assert.equal(await page.evaluate<string>(VIEW), 'focus');
    assert.equal(await page.evaluate<string>('document.querySelector(".artboard.is-current").id'), 'approve');

    await press(page, 'ArrowRight');
    await page.settle();
    assert.equal(await page.evaluate<string>('document.querySelector(".artboard.is-current").id'), 'done');

    await press(page, 'Escape');
    await page.settle();
    assert.equal(await page.evaluate<string>(VIEW), 'canvas');
    assert.equal(await page.evaluate<string>(SELECTED), 'approve:false,done:true');
  },
);

test(
  'the keys pick a state, list themselves and leave a field alone',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const page = await open(t);

    await press(page, ']');
    assert.equal(await page.evaluate<string>(SELECTED), 'approve:true,done:false');
    await press(page, '2');
    await page.settle();
    assert.equal(await page.evaluate<string>(PRESSED), 'true');

    assert.equal(await page.evaluate<boolean>('document.querySelector(".mk-keys").hidden'), true);
    await press(page, '?');
    await page.settle();
    assert.equal(await page.evaluate<boolean>('document.querySelector(".mk-keys").hidden'), false);
    assert.equal(await page.evaluate<string>('document.querySelector(".mk-keys").getAttribute("role")'), 'dialog');
    assert.ok((await page.evaluate<number>('document.querySelectorAll(".mk-keys dt").length')) > 0, 'the list has keys');
    await press(page, 'Escape');
    await page.settle();
    assert.equal(await page.evaluate<boolean>('document.querySelector(".mk-keys").hidden'), true);
    assert.equal(await page.evaluate<string>(VIEW), 'canvas');

    // A field keeps its own keys: 100% first, so a pan would be visible.
    await press(page, 'z');
    await page.settle();
    await page.evaluate<string>('document.getElementById("field").focus()');
    const before = await page.evaluate<number[] | null>(TRANSFORM);
    assert.ok(before !== null, 'the world carries a transform');
    await press(page, 'd');
    await press(page, 'a');
    await press(page, 'ArrowRight');
    await page.settle();
    const after = await page.evaluate<number[] | null>(TRANSFORM);
    assert.ok(after !== null, 'the world carries a transform');
    assert.deepEqual(after, before, 'a key typed in a field does not pan');
  },
);
