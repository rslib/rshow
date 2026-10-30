import assert from 'node:assert/strict';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { modeList, widthList } from '../src/commands/handoff.ts';
import { ratioValue } from '../src/commands/compare.ts';
import { reportHtml } from '../src/compare.ts';
import type { ScreenResult } from '../src/compare.ts';
import {
  baselineName,
  displayPath,
  handoffDirName,
  handoffMarkdown,
  parseTarget,
  safeName,
  sourceUrl,
  viewportHeight,
} from '../src/handoff.ts';
import type { HandoffSpec, ScreenSpec } from '../src/spec.ts';
import { extractTokens } from '../src/tokens.ts';
import { makeTempDir, runCli, startFakeApi } from './helpers.ts';

const SCREEN: ScreenSpec = {
  id: 'gallery',
  title: 'Gallery',
  frame: 'browser',
  kind: 'artboard',
  width: 1440,
  height: 900,
  states: ['default', 'empty'],
  flows: [{ from: 'gallery', to: 'share' }],
  annotations: [{ text: 'Align to the grid', x: 120, y: 8 }],
  focus: [{ name: 'wf-button', role: 'button', text: 'Open' }],
  variants: [
    {
      state: 'default',
      mode: 'light',
      components: [
        {
          name: 'PrimaryButton',
          role: 'button',
          x: 24,
          y: 40,
          w: 120,
          h: 32,
          color: 'rgb(255, 255, 255)',
          background: 'rgb(15, 98, 254)',
          fontFamily: '"IBM Plex Sans", sans-serif',
          fontSize: '16px',
          fontWeight: '600',
          radius: '2px',
          normative: true,
          text: 'Open',
          tokens: { background: '--accent' },
        },
      ],
    },
  ],
};

const TOKENS = extractTokens([':root{--accent:#0f62fe;--bg:#ffffff}:root[data-mode=dark]{--bg:#161616}']);

test('a target is a published version or a local folder', () => {
  assert.deepEqual(parseTarget('gallery@v3'), { kind: 'remote', slug: 'gallery', version: 3 });
  assert.deepEqual(parseTarget('a@v12'), { kind: 'remote', slug: 'a', version: 12 });
  const local = parseTarget('/tmp/fix1');
  assert.equal(local.kind, 'local');
  assert.equal(local.slug, 'fix1');
  assert.equal(parseTarget('./Some Dir/').slug, 'some-dir');
});

test('names, urls and paths', () => {
  assert.equal(handoffDirName('gallery', 3), 'handoff-gallery-v3');
  assert.equal(handoffDirName('gallery', null), 'handoff-gallery');
  assert.equal(sourceUrl('https://art.example.com/', 'gallery', 3), 'https://art.example.com/gallery/v3/');
  assert.equal(sourceUrl('https://art.example.com', 'gallery', null), 'https://art.example.com/gallery/');
  assert.equal(baselineName('gallery', 'default', 1440, 'light'), 'gallery__default__1440__light.png');
  assert.equal(baselineName('a/b c', 'empty', 390, 'dark'), 'a-b-c__empty__390__dark.png');
  assert.equal(safeName(''), 'screen');
  assert.equal(viewportHeight(390), 844);
  assert.equal(viewportHeight(1440), 900);
  assert.equal(displayPath(path.join(process.cwd(), 'handoff-gallery-v3')), 'handoff-gallery-v3');
  assert.equal(displayPath('/tmp/elsewhere'), '/tmp/elsewhere');
});

test('widths and modes are validated', () => {
  assert.deepEqual(widthList(undefined), [1440, 390]);
  assert.deepEqual(widthList('1440,390'), [1440, 390]);
  assert.deepEqual(widthList('800, 800'), [800]);
  assert.throws(() => widthList('wide'), /invalid width: wide/);
  assert.throws(() => widthList('0'), /invalid width: 0/);
  assert.deepEqual(modeList(undefined), ['light', 'dark']);
  assert.deepEqual(modeList('dark'), ['dark']);
  assert.throws(() => modeList('sepia'), /invalid mode: sepia/);
});

test('thresholds stay between 0 and 1', () => {
  assert.equal(ratioValue(undefined, 'threshold', 0.1), 0.1);
  assert.equal(ratioValue('0.25', 'threshold', 0.1), 0.25);
  assert.throws(() => ratioValue('2', 'threshold', 0.1), /--threshold must be between 0 and 1/);
  assert.throws(() => ratioValue('x', 'max-diff-ratio', 0.02), /--max-diff-ratio/);
});

test('the handoff summary names the source, the screens and the compare command', () => {
  const markdown = handoffMarkdown({
    source: {
      slug: 'gallery',
      version: 3,
      url: 'https://art.example.com/gallery/v3/',
      kind: 'mockup',
      skin: 'wire',
    },
    out: 'handoff-gallery-v3',
    widths: [1440, 390],
    modes: ['light', 'dark'],
    screens: [SCREEN],
    tokens: TOKENS,
    createdAt: '2026-01-01T00:00:00.000Z',
    mapFile: 'rshow.map.json',
  });
  assert.match(markdown, /^# Handoff: gallery v3$/m);
  assert.match(markdown, /^Immutable source: https:\/\/art\.example\.com\/gallery\/v3\/$/m);
  assert.match(markdown, /with the wire skin/);
  assert.match(markdown, /\| gallery \| Gallery \| browser \| default, empty \| 1440x900 \|/);
  assert.match(markdown, /^- gallery to share$/m);
  assert.match(markdown, /^- gallery at 120,8: Align to the grid$/m);
  assert.match(markdown, /\| gallery \| default \| light \| PrimaryButton \| button \| 24,40 120x32 \| background --accent \| yes \|/);
  assert.match(markdown, /2 tokens and 1 dark values/);
  assert.match(markdown, /rshow compare --against handoff-gallery-v3 --map rshow\.map\.json/);
  assert.match(markdown, /data-normative means the text, the box and the computed style must match/);
  assert.match(markdown, /placeholder/);
  assert.match(markdown, /Exit 0 means it matches, 7 means it does not/);
});

test('the report page shows each screen, its three images and its mismatches', () => {
  const spec: HandoffSpec = {
    schema: 1,
    generator: 'rshow handoff',
    createdAt: '2026-01-01T00:00:00.000Z',
    source: { slug: 'gallery', version: 3, url: 'https://art.example.com/gallery/v3/', kind: 'mockup', skin: 'wire' },
    widths: [1440],
    modes: ['light'],
    primaryWidth: 1440,
    screens: [SCREEN],
    baselines: [],
  };
  const results: ScreenResult[] = [
    {
      screen: 'gallery',
      state: 'default',
      mode: 'light',
      width: 1440,
      source: 'http://localhost:5173/',
      kind: 'browser',
      pass: false,
      diffRatio: 0.0321,
      images: {
        baseline: 'images/a-baseline.png',
        actual: 'images/a-actual.png',
        diff: 'images/a-diff.png',
      },
      mismatches: [
        {
          screen: 'gallery',
          state: 'default',
          mode: 'light',
          component: 'PrimaryButton',
          property: 'color',
          expected: '<#fff>',
          actual: 'rgb(0, 0, 0)',
        },
      ],
    },
  ];
  const html = reportHtml({
    spec,
    results,
    pass: false,
    generatedAt: '2026-01-01T00:00:00.000Z',
    threshold: 0.1,
    maxDiffRatio: 0.02,
  });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>rshow compare: gallery v3<\/title>/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /images\/a-baseline\.png/);
  assert.match(html, /images\/a-actual\.png/);
  assert.match(html, /images\/a-diff\.png/);
  assert.match(html, /0\.0321/);
  assert.match(html, /&lt;#fff&gt;/);
  assert.match(html, /1 failing/);
  assert.doesNotMatch(html, /<script/);
});

test('a version that is not public is a usage error before a browser starts', async (t) => {
  const art = await startFakeApi(() => ({ status: 404, body: { error: 'not found' } }));
  t.after(() => art.close());
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ url: 'https://api.test', art: art.url }),
  });

  const result = await runCli(['handoff', 'gallery@v3', '--out', path.join(home, 'nope')], {
    HOME: home,
    CHROME: '/nonexistent/chrome',
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /gallery\/v3\/ is not public \(HTTP 404\)/);
  assert.match(result.stderr, /make the version public, or run rshow handoff on a local folder/);
  assert.deepEqual(
    art.requests.map((req) => req.path),
    ['/gallery/v3/'],
  );
});

test('a public version is fetched from the art host in config', async (t) => {
  const art = await startFakeApi((req) => {
    if (req.path === '/gallery/v3/' || req.path === '/gallery/v3/index.html') {
      return { status: 200, text: '<!doctype html><html><head></head><body><h1>hi</h1></body></html>' };
    }
    return undefined;
  });
  t.after(() => art.close());
  const home = await makeTempDir({
    '.config/rshow/config.json': JSON.stringify({ url: 'https://api.test', art: art.url }),
  });

  const result = await runCli(['handoff', 'gallery@v3', '--out', path.join(home, 'out')], {
    HOME: home,
    CHROME: '/nonexistent/chrome',
  });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /cannot run chrome: spawn \/nonexistent\/chrome/);
  assert.equal(art.requests.length, 2);
});

test('a local folder needs an index.html', async () => {
  const dir = await makeTempDir({ 'readme.txt': 'nothing here' });
  const result = await runCli(['handoff', dir, '--out', path.join(dir, 'out')], { CHROME: '/nonexistent' });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /has no index\.html/);
});
