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

// The theme as it ships, served as the preview root: the example pages under it
// are the real theme runtime, not a copy of it.
const THEME = fileURLToPath(new URL('../../../themes/default/', import.meta.url));

// A phone held upright and the desktop the theme is drawn for. Both are the
// sizes the mobile audit runs at.
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

// Everything the theme ships that has to keep the width of a phone: the gallery
// index, every example page, and the example deck.
const PAGES = [
  '/',
  'example/page.html',
  'example/report.html',
  'example/poster.html',
  'example/dashboard.html',
  'example/project.html',
  'example/sketch.html',
  'example/mockup.html',
  'example/mockup-desktop.html',
  'example/mockup-platforms.html',
  'example/tui.html',
  'example/terminal.html',
  'example/index.html',
];

// The sideways scroll a phone must not have: the page as a whole, and anything
// that hangs past the right edge without a reason to. A reason is a box that
// scrolls sideways on purpose -- a code block, a table, the terminal grid, the
// recording inside it -- or the mockup stage, which pans by design.
const SIDEWAYS = `(function () {
  function scrollsSideways(node) {
    var up = node.parentElement;
    while (up !== null) {
      if (/auto|scroll/.test(window.getComputedStyle(up).overflowX)) return true;
      up = up.parentElement;
    }
    return false;
  }
  var found = [];
  var nodes = document.querySelectorAll('body *');
  for (var i = 0; i < nodes.length; i += 1) {
    var node = nodes[i];
    var box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    var style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (style.position === 'fixed') continue;
    if (box.right <= window.innerWidth + 1) continue;
    if (node.closest('.mk-stage') !== null) continue;
    if (scrollsSideways(node)) continue;
    found.push(node.tagName.toLowerCase() + '.' + node.className + ' right=' + Math.round(box.right));
  }
  return { width: window.innerWidth, scroll: document.documentElement.scrollWidth, found: found.slice(0, 6), total: found.length };
})()`;

type Sideways = { width: number; scroll: number; found: string[]; total: number };

// One browser for a whole test: the page goes before the browser it lives in, or
// its close waits on a devtools socket that is already gone.
async function open(
  t: { after: (fn: () => unknown) => void },
  viewport: { width: number; height: number } = PHONE,
): Promise<{ page: Page; url: string }> {
  const preview = await startPreview({ dir: THEME, theme: THEME, root: 'theme', port: 0, offline: true, reload: false });
  const chrome = await Chrome.launch({ binary: CHROME });
  const page = await Page.open(chrome);
  t.after(() => page.close());
  t.after(() => chrome.close());
  t.after(() => preview.close());
  await page.setViewport(viewport.width, viewport.height);
  return { page, url: preview.url };
}

async function assertHolds(url: string, name: string, page: Page): Promise<void> {
  await page.navigate(`${url}${name === '/' ? '/' : `/${name}`}`);
  await page.settle(1200);
  const box = await page.evaluate<Sideways>(SIDEWAYS);
  assert.equal(
    box.scroll <= box.width,
    true,
    `${name} keeps the width of the phone: documentElement.scrollWidth is ${box.scroll} at ${box.width}`,
  );
  assert.deepEqual(box.found, [], `${name} has nothing past the right edge: ${box.total} of them`);
}

test(
  'the phone pages keep the width of a phone',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 180000 },
  async (t) => {
    const { page, url } = await open(t);
    for (const name of PAGES) {
      await assertHolds(url, name, page);
    }
  },
);

test(
  'the mockup opens the first screen in focus on a phone and the canvas on a desktop',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, url } = await open(t);
    const view = 'document.querySelector(".mockup").getAttribute("data-view")';
    const current = 'document.querySelector(".mk-stage .is-current") !== null';

    await page.navigate(`${url}/example/mockup.html`);
    await page.settle();
    assert.equal(await page.evaluate<string>(view), 'focus');
    assert.equal(await page.evaluate<boolean>(current), true, 'a screen is current in focus view');

    // Every control in the toolbar is on the screen and big enough to press.
    const controls = await page.evaluate<{ name: string; right: number; height: number }[]>(`(function () {
      var out = [];
      var nodes = document.querySelectorAll('.mk-toolbar button, .mk-toolbar select');
      for (var i = 0; i < nodes.length; i += 1) {
        var box = nodes[i].getBoundingClientRect();
        out.push({
          name: (nodes[i].textContent || nodes[i].tagName).trim().slice(0, 12),
          right: Math.round(box.right),
          height: Math.round(box.height)
        });
      }
      return out;
    })()`);
    assert.ok(controls.length > 0, 'the toolbar has controls');
    for (const control of controls) {
      assert.ok(control.right <= PHONE.width, `the ${control.name} control is inside the phone: right edge ${control.right}`);
      assert.ok(control.height >= 32, `the ${control.name} control is at least 32px tall: ${control.height}`);
    }

    // The same page on a desktop is the canvas it always was.
    await page.setViewport(DESKTOP.width, DESKTOP.height);
    await page.navigate(`${url}/example/mockup.html`);
    await page.settle();
    assert.equal(await page.evaluate<string>(view), 'canvas');
  },
);

test(
  'the deck reads down the page on a phone and presents one slide elsewhere',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, url } = await open(t);
    const DECK = '/example/index.html';

    await page.navigate(`${url}${DECK}`);
    await page.settle();
    const phone = await page.evaluate<{
      reading: boolean;
      width: number;
      scroll: number;
      scrolls: boolean;
      stacked: boolean;
      notes: boolean;
      steps: number;
      present: string | null;
      bullet: number;
      heading: number;
    }>(`(function () {
      var deck = document.querySelector('main.deck');
      var slide = document.querySelector('main.deck > .slide');
      var notes = document.querySelector('aside.notes');
      var steps = document.querySelectorAll('.step');
      var revealed = 0;
      for (var i = 0; i < steps.length; i += 1) {
        if (steps[i].classList.contains('is-revealed')) revealed += 1;
      }
      var button = document.querySelector('.deck-present');
      function size(node) {
        return node === null ? 0 : parseFloat(window.getComputedStyle(node).fontSize);
      }
      return {
        reading: deck.classList.contains('is-reading'),
        width: window.innerWidth,
        scroll: document.documentElement.scrollWidth,
        scrolls: document.documentElement.scrollHeight > window.innerHeight,
        stacked: window.getComputedStyle(slide).transform === 'none',
        notes: notes !== null && window.getComputedStyle(notes).display !== 'none',
        steps: revealed,
        present: button === null || button.hidden ? null : button.textContent,
        bullet: size(document.querySelector('main.deck > .slide.bullets li')),
        heading: size(document.querySelector('main.deck > .slide h2'))
      };
    })()`);
    assert.equal(phone.reading, true, 'a phone held upright reads instead of presenting');
    // No scale in reading mode: a 1280x720 canvas shrunk to 390px sets the body
    // text near 9px, so the slides are reflowed and the stack keeps the width.
    assert.equal(phone.stacked, true, 'a reading slide is a block, not a scaled canvas');
    assert.ok(phone.scroll <= phone.width, `the stack keeps the width of the phone: scrollWidth is ${phone.scroll} at ${phone.width}`);
    assert.ok(phone.bullet >= 16, `a bullet is set at a size a phone reads: ${phone.bullet}px`);
    assert.ok(phone.heading >= 22, `a slide title is set at a size a phone reads: ${phone.heading}px`);
    assert.equal(phone.scrolls, true, 'the stack is longer than the window, so the page scrolls');
    assert.equal(phone.notes, false, 'the notes are hidden while reading');
    assert.ok(phone.steps > 0, 'the deck has steps to reveal');
    assert.equal(phone.present, 'Present', 'a Present button is there to switch back');

    // Every step is out, so nothing waits for a key.
    const late = await page.evaluate<number>(
      `(function () {
        var steps = document.querySelectorAll('.step');
        for (var i = 0; i < steps.length; i += 1) {
          if (!steps[i].classList.contains('is-revealed')) return i;
        }
        return -1;
      })()`,
    );
    assert.equal(late, -1, 'every step is revealed');

    // #n in the URL scrolls to slide n, on a load.
    await page.navigate(`${url}/example/page.html`);
    await page.settle();
    await page.navigate(`${url}${DECK}#4`);
    await page.settle();
    const at = await page.evaluate<number>(
      'document.querySelectorAll("main.deck > .slide")[3].getBoundingClientRect().top',
    );
    assert.ok(Math.abs(at) <= 2, `#4 brings slide 4 to the top: it sits at ${Math.round(at)}`);

    // The button presents one slide at a time, and Esc comes back here.
    await page.evaluate<string>('document.querySelector(".deck-present").click()');
    await page.settle();
    assert.equal(
      await page.evaluate<boolean>('document.querySelector("main.deck").classList.contains("is-reading")'),
      false,
      'Present leaves reading mode',
    );
    assert.equal(
      await page.evaluate<boolean>('document.documentElement.classList.contains("is-reading")'),
      false,
      'Present gives the page back its scrollbar',
    );

    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await page.settle();
    assert.equal(
      await page.evaluate<boolean>('document.querySelector("main.deck").classList.contains("is-reading")'),
      true,
      'Esc comes back to reading',
    );

    // A desktop keeps one slide at a time.
    await page.setViewport(DESKTOP.width, DESKTOP.height);
    await page.navigate(`${url}${DECK}`);
    await page.settle();
    assert.equal(
      await page.evaluate<boolean>('document.querySelector("main.deck").classList.contains("is-reading")'),
      false,
      'a desktop presents',
    );
    assert.equal(
      await page.evaluate<boolean>('document.querySelector(".deck-present") === null || document.querySelector(".deck-present").hidden'),
      true,
      'no Present button on a desktop',
    );
  },
);

test(
  'the terminal keeps the width of a phone and scrolls its grid inside the frame',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const { page, url } = await open(t);
    await page.navigate(`${url}/example/terminal.html`);
    await page.settle(2000);
    const frames = await page.evaluate<{ right: number; grid: number; gridBox: number; cast: number; castBox: number }>(`(function () {
      var bodies = document.querySelectorAll('.terminal-body');
      var player = bodies[1].querySelector('.ap-player');
      return {
        right: document.querySelector('.terminal-window').getBoundingClientRect().right,
        grid: bodies[0].scrollWidth,
        gridBox: bodies[0].clientWidth,
        cast: player === null ? 0 : player.scrollWidth,
        castBox: player === null ? 0 : player.clientWidth
      };
    })()`);
    assert.ok(frames.right <= PHONE.width + 1, `the frame keeps the width of the phone: ${Math.round(frames.right)}`);
    assert.ok(frames.grid > frames.gridBox, `the capture scrolls inside its frame: ${frames.grid} in ${frames.gridBox}`);
    assert.ok(frames.cast > frames.castBox, `the recording scrolls inside its frame: ${frames.cast} in ${frames.castBox}`);

    // Neither is fitted down to a font nobody can read: the capture is a hundred
    // columns, and a hundred of them would be five pixels wide.
    const small = await page.evaluate<string[]>(`(function () {
      var found = [];
      var bodies = document.querySelectorAll('.terminal-body');
      for (var b = 0; b < bodies.length; b += 1) {
        var nodes = bodies[b].querySelectorAll('pre, span, textarea');
        for (var i = 0; i < nodes.length; i += 1) {
          var size = parseFloat(window.getComputedStyle(nodes[i]).fontSize);
          if (size > 0 && size < 9) found.push(nodes[i].tagName.toLowerCase() + ' ' + size + 'px');
        }
      }
      return found.slice(0, 4);
    })()`);
    assert.deepEqual(small, [], 'no terminal text is under 9px');
  },
);
