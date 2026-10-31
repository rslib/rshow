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
    <div data-state="approval">Approved.</div>
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

test(
  'a state button above the screen takes a click in canvas view',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 120000 },
  async (t) => {
    const dir = await makeTempDir({ 'index.html': PAGE });
    const preview = await startPreview({ dir, port: 0, offline: true, reload: false });
    const chrome = await Chrome.launch({ binary: CHROME });
    const page = await Page.open(chrome);
    // The page goes before the browser it lives in, or its close waits on a
    // devtools socket that is already gone.
    t.after(() => page.close());
    t.after(() => chrome.close());
    t.after(() => preview.close());
    await page.setViewport(1440, 900);
    await page.navigate(`${preview.url}/`);

    assert.equal(await page.evaluate<string>('document.querySelector(".mockup").getAttribute("data-view")'), 'canvas');
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
