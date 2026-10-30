import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTempDir, runCli } from './helpers.ts';
import type { CliResult } from './helpers.ts';

const HEAD = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Mockup</title>',
  '</head>',
];

function page(body: string[]): string {
  return [...HEAD, '<body>', ...body, '</body>', '</html>'].join('\n');
}

async function check(body: string[]): Promise<CliResult> {
  const dir = await makeTempDir({ 'index.html': page(body) });
  return runCli(['check', dir, '--offline'], {});
}

test('mockup warns on a flow that names no artboard in the same file', async () => {
  const result = await check([
    '<main class="mockup">',
    '<section class="artboard" id="gallery" data-title="Gallery">',
    '<a href="#artifact">next</a>',
    '<a href="#gone">lost</a>',
    '<span data-goto="missing">x</span>',
    '<span data-goto="gallery">back</span>',
    '</section>',
    '<section class="artboard" id="artifact" data-title="Artifact">',
    '<a href="#gallery">back</a>',
    '</section>',
    '</main>',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:11: warning: flow to #gone is not an artboard id in this file$/m);
  assert.match(result.stdout, /^index\.html:12: warning: flow to #missing is not an artboard id in this file$/m);
  assert.match(result.stdout, /^check: 0 errors, 2 warnings /m);
});

test('mockup warns on two artboards with the same id and on a missing title', async () => {
  const result = await check([
    '<main class="mockup">',
    '<section class="artboard" id="gallery" data-title="Gallery"></section>',
    '<section class="artboard" id="gallery" data-title="Again"></section>',
    '<section class="artboard" id="plain"></section>',
    '</main>',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:10: warning: duplicate artboard id: gallery$/m);
  assert.match(result.stdout, /^index\.html:11: warning: artboard #plain has no data-title$/m);
  assert.match(result.stdout, /^check: 0 errors, 2 warnings /m);
});

test('mockup warns on a block state the artboard does not list', async () => {
  const result = await check([
    '<main class="mockup">',
    '<section class="artboard" id="gallery" data-title="Gallery" data-states="empty">',
    '<div data-state="default">d</div>',
    '<div data-state="empty">e</div>',
    '<div data-state="error,loading">x</div>',
    '<div data-state="empty"><span data-state="nested">n</span></div>',
    '</section>',
    '</main>',
  ]);
  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /^index\.html:12: warning: block data-state "error,loading" is not in the artboard data-states$/m,
  );
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('mockup warns on a state in data-states that no block uses', async () => {
  const result = await check([
    '<main class="mockup">',
    '<section class="artboard" id="gallery" data-title="Gallery" data-states="default,empty,loading">',
    '<div data-state="empty">e</div>',
    '</section>',
    '</main>',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:9: warning: artboard #gallery lists state "loading" that no block uses$/m);
  assert.match(result.stdout, /^check: 0 errors, 1 warning /m);
});

test('mockup warns when a tui is below the 80x24 minimum', async () => {
  const result = await check([
    '<div class="tui" data-cols="60" data-rows="20"></div>',
    '<div class="tui" data-cols="40" data-rows="10" data-allow-small></div>',
    '<div class="tui" data-cols="100" data-rows="27"></div>',
    '<div class="tui" data-rows="30"></div>',
    '<div class="tui" data-cols="79"></div>',
  ]);
  assert.equal(result.code, 0);
  assert.match(
    result.stdout,
    /^index\.html:8: warning: tui below the 80x24 minimum \(60x20\), or mark it with data-allow-small$/m,
  );
  assert.match(
    result.stdout,
    /^index\.html:12: warning: tui below the 80x24 minimum \(79x24\), or mark it with data-allow-small$/m,
  );
  assert.match(result.stdout, /^check: 0 errors, 2 warnings /m);
});

test('mockup warns on a key hint that binds a terminal key', async () => {
  const result = await check([
    '<!-- Ctrl+C in a comment is not a key hint -->',
    '<div class="tui">',
    '<div class="tui-keys"><kbd>Ctrl</kbd>+<kbd>C</kbd> quit</div>',
    '<div class="tui-keys"><kbd>^</kbd><kbd>Z</kbd> suspend</div>',
    '<div class="tui-statusbar">c-c quit</div>',
    '<div class="tui-dialog"><span class="tui-line">^C interrupt</span></div>',
    '<div class="tui-keys"><kbd>q</kbd> quit</div>',
    '<span class="note-pin" data-note="Ctrl+C belongs to the terminal">1</span>',
    '</div>',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^index\.html:10: warning: key hint binds the terminal's key: Ctrl\+C$/m);
  assert.match(result.stdout, /^index\.html:11: warning: key hint binds the terminal's key: \^Z$/m);
  assert.match(result.stdout, /^index\.html:12: warning: key hint binds the terminal's key: c-c$/m);
  assert.match(result.stdout, /^index\.html:13: warning: key hint binds the terminal's key: \^C$/m);
  assert.match(result.stdout, /^check: 0 errors, 4 warnings /m);
});

test('mockup leaves a well-formed mockup quiet', async () => {
  const result = await check([
    '<main class="mockup" data-skin="wire" data-name="rshow admin">',
    '<section class="artboard" id="gallery" data-frame="browser" data-title="Gallery"',
    '         data-states="default,empty,error">',
    '<div data-state="default,error">rows</div>',
    '<div data-state="empty">nothing here</div>',
    '<a href="#share">Share</a>',
    '</section>',
    '<section class="artboard" id="share" data-title="Share dialog">',
    '<span class="wf-button" data-goto="gallery">Done</span>',
    '<div class="tui" data-cols="100" data-rows="27">',
    '<div class="tui-keys"><kbd>q</kbd> quit</div>',
    '</div>',
    '</section>',
    '</main>',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok \(1 file, [0-9.]+ [KMG]?i?B\)$/m);
});

test('mockup rules need a main element and artboards, not a loose class', async () => {
  const result = await check([
    '<div class="mockup">',
    '<section class="artboard" id="gallery"></section>',
    '<section class="artboard" id="gallery"></section>',
    '<a href="#gone">lost</a>',
    '</div>',
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^check: ok \(1 file, [0-9.]+ [KMG]?i?B\)$/m);
});
