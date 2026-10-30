import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { runCompare } from '../src/compare.ts';
import { baselineName } from '../src/handoff.ts';
import {
  captureNative,
  captureWindow,
  checkPalette,
  deltaE76,
  extractPalette,
  isNative,
  labOf,
  normativeColors,
  parseCaptureSource,
  parseWindowList,
  pickWindowId,
} from '../src/native.ts';
import { blankImage, decodePng, encodePng, scaleImage, scaleToWidth } from '../src/png.ts';
import type { Image } from '../src/png.ts';
import { describeRelation, rubricMarkdown } from '../src/rubric.ts';
import type { HandoffSpec, ScreenSpec } from '../src/spec.ts';
import { makeTempDir, runCli } from './helpers.ts';

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const ACCENT: [number, number, number, number] = [15, 98, 254, 255];
const INK: [number, number, number, number] = [22, 22, 22, 255];

function fill(image: Image, x0: number, y0: number, x1: number, y1: number, rgba: readonly number[]): void {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const pos = (y * image.width + x) * 4;
      image.data[pos] = rgba[0] as number;
      image.data[pos + 1] = rgba[1] as number;
      image.data[pos + 2] = rgba[2] as number;
      image.data[pos + 3] = rgba[3] as number;
    }
  }
}

function pixel(image: Image, x: number, y: number): number[] {
  const pos = (y * image.width + x) * 4;
  return [...image.data.subarray(pos, pos + 4)];
}

function app(width: number, height: number, shift = 0): Image {
  const image = blankImage(width, height, WHITE);
  fill(image, 24 + shift, 4, 40, 20, ACCENT);
  return image;
}

function pngBuffer(image: Image): Buffer {
  return Buffer.from(encodePng(image));
}

test('the box filter averages a Retina 2x capture down to the baseline width', () => {
  const retina = scaleImage(app(40, 24), 80, 48, 'nearest');
  assert.deepEqual(pixel(retina, 50, 10), [...ACCENT]);
  const scaled = scaleToWidth(retina, 40);
  assert.equal(scaled.width, 40);
  assert.equal(scaled.height, 24);
  assert.deepEqual(pixel(scaled, 30, 10), [...ACCENT]);
  assert.deepEqual(pixel(scaled, 10, 10), [...WHITE]);
});

test('the box filter mixes a 2x2 block and nearest keeps one pixel', () => {
  const grid = blankImage(2, 2, WHITE);
  fill(grid, 0, 0, 1, 1, [0, 0, 0, 255]);
  fill(grid, 1, 1, 2, 2, [0, 0, 0, 255]);
  const box = scaleImage(grid, 1, 1, 'box');
  assert.deepEqual(pixel(box, 0, 0), [128, 128, 128, 255]);
  assert.deepEqual(pixel(scaleImage(grid, 1, 1, 'nearest'), 0, 0), [0, 0, 0, 255]);
  assert.equal(scaleToWidth(grid, 2), grid);
});

test('a palette is the dominant colours of the image, largest first', () => {
  const image = blankImage(40, 40, WHITE);
  fill(image, 0, 0, 40, 4, ACCENT);
  const swatches = extractPalette(image);
  assert.equal(swatches.length, 2);
  assert.deepEqual(swatches[0]?.color, { r: 255, g: 255, b: 255, a: 255 });
  assert.deepEqual(swatches[1]?.color, { r: 15, g: 98, b: 254, a: 255 });
  assert.ok(Math.abs((swatches[0]?.area ?? 0) - 0.9) < 0.01, `area ${swatches[0]?.area}`);
  assert.ok(Math.abs((swatches[1]?.area ?? 0) - 0.1) < 0.01, `area ${swatches[1]?.area}`);
  assert.deepEqual(extractPalette(blankImage(4, 4, ACCENT)).map((swatch) => swatch.color), [
    { r: 15, g: 98, b: 254, a: 255 },
  ]);
});

test('a palette is stable on a large image and drops transparent pixels', () => {
  const image = blankImage(600, 400, [0, 0, 0, 0]);
  fill(image, 0, 0, 600, 100, INK);
  fill(image, 0, 100, 600, 400, WHITE);
  const swatches = extractPalette(image, 8);
  assert.equal(swatches.length, 2);
  assert.deepEqual(swatches[0]?.color, { r: 255, g: 255, b: 255, a: 255 });
  assert.deepEqual(swatches[1]?.color, { r: 22, g: 22, b: 22, a: 255 });
});

test('delta E 76 in Lab is zero on a match and 100 from white to black', () => {
  assert.equal(deltaE76({ r: 15, g: 98, b: 254, a: 255 }, { r: 15, g: 98, b: 254, a: 255 }), 0);
  assert.ok(Math.abs(deltaE76({ r: 255, g: 255, b: 255, a: 255 }, { r: 0, g: 0, b: 0, a: 255 }) - 100) < 0.5);
  assert.ok(deltaE76({ r: 15, g: 98, b: 254, a: 255 }, { r: 255, g: 255, b: 255, a: 255 }) > 50);
  const gray = labOf({ r: 128, g: 128, b: 128, a: 255 });
  assert.ok(Math.abs(gray.l - 53.59) < 0.1, `L was ${gray.l}`);
  assert.ok(Math.abs(gray.a) < 0.01 && Math.abs(gray.b) < 0.01);
});

test('the palette check reports a missing token and a colour that drifts', () => {
  const swatches = extractPalette(blankImage(20, 20, [25, 88, 240, 255]));
  const report = checkPalette(swatches, [
    { name: '--accent', color: { r: 15, g: 98, b: 254, a: 255 } },
    { name: '--bg', color: { r: 255, g: 255, b: 255, a: 255 } },
  ]);
  assert.deepEqual(report.missing.map((finding) => finding.token), ['--bg']);
  assert.match(report.missing[0]?.actual ?? '', /rgb\(25, 88, 240\)/);
  assert.deepEqual(report.drift.map((finding) => finding.token), ['--accent']);
  assert.ok((report.drift[0]?.distance ?? 0) > 2 && (report.drift[0]?.distance ?? 0) < 10);
  assert.equal(report.drift[0]?.area, 1);
});

test('the palette check passes when the capture holds every token colour', () => {
  const image = blankImage(40, 40, WHITE);
  fill(image, 0, 0, 40, 4, ACCENT);
  const report = checkPalette(extractPalette(image), [
    { name: '--accent', color: { r: 15, g: 98, b: 254, a: 255 } },
    { name: '--bg', color: { r: 255, g: 255, b: 255, a: 255 } },
  ]);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.drift, []);
});

test('map.screens parses a url, a tmux target, a screenshot and a window', () => {
  assert.deepEqual(parseCaptureSource('http://localhost:5173/'), {
    kind: 'url',
    url: 'http://localhost:5173/',
  });
  assert.deepEqual(parseCaptureSource('tmux:mysession:0.1'), { kind: 'tmux', target: 'mysession:0.1' });
  assert.deepEqual(parseCaptureSource(' file:shots/app 1.png '), { kind: 'file', file: 'shots/app 1.png' });
  assert.deepEqual(parseCaptureSource('window:MyApp'), { kind: 'window', title: 'MyApp' });
  assert.equal(isNative(parseCaptureSource('file:a.png')), true);
  assert.equal(isNative(parseCaptureSource('window:MyApp')), true);
  assert.equal(isNative(parseCaptureSource('http://localhost:5173/')), false);
  assert.throws(() => parseCaptureSource('file:'), /file: needs a screenshot path/);
  assert.throws(() => parseCaptureSource('window: '), /window: needs an owner name or a window title/);
});

test('a file: screenshot is read relative to the map file', async () => {
  const dir = await makeTempDir({ 'shots/gallery.png': pngBuffer(app(40, 24)) });
  const bytes = await captureNative({ kind: 'file', file: 'shots/gallery.png' }, dir);
  assert.deepEqual(decodePng(bytes), app(40, 24));
  await assert.rejects(
    () => captureNative({ kind: 'file', file: 'shots/gone.png' }, dir),
    /no screenshot at shots\/gone\.png, which is relative to rshow\.map\.json/,
  );
});

test('the window list is parsed and matched by owner name or title', () => {
  const list = parseWindowList('4242\tMy App\tDocuments — My App\n7\tTerminal\tzsh\nnot a window');
  assert.deepEqual(list, [
    { id: 4242, owner: 'My App', title: 'Documents — My App' },
    { id: 7, owner: 'Terminal', title: 'zsh' },
  ]);
  assert.equal(pickWindowId(list, 'My App'), 4242);
  assert.equal(pickWindowId(list, 'documents'), 4242);
  assert.equal(pickWindowId(list, 'zsh'), 7);
  assert.equal(pickWindowId(list, 'terminal'), 7);
  assert.equal(pickWindowId(list, 'Notes'), undefined);
  assert.equal(pickWindowId(list, ''), undefined);
});

test('a window capture on macOS asks CGWindowList and then screencapture', async () => {
  const calls: string[][] = [];
  const shot = pngBuffer(app(40, 24));
  const bytes = await captureWindow('My App', {
    platform: 'darwin',
    runner: {
      run: async (bin, args) => {
        calls.push([bin, ...args]);
        if (bin === 'osascript') {
          assert.deepEqual(args.slice(0, 4), ['-l', 'JavaScript', '-e', args[3] as string]);
          assert.match(args[3] as string, /CGWindowListCopyWindowInfo/);
          return '11\tFinder\tDesktop\n4242\tMy App\tDocuments\n';
        }
        assert.equal(bin, 'screencapture');
        await writeFile(args[args.length - 1] as string, shot);
        return '';
      },
    },
  });
  assert.deepEqual(Buffer.from(bytes), shot);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.slice(0, 6), ['screencapture', '-x', '-o', '-l', '4242', '-t']);
});

test('a window capture on Linux uses xdotool and import', async () => {
  const calls: string[][] = [];
  await captureWindow('Notes', {
    platform: 'linux',
    runner: {
      run: async (bin, args) => {
        calls.push([bin, ...args]);
        if (bin === 'xdotool') return '12\n13\n';
        await writeFile((args[2] as string).replace(/^png:/, ''), pngBuffer(app(40, 24)));
        return '';
      },
    },
  });
  assert.deepEqual(calls[0], ['xdotool', 'search', '--name', 'Notes']);
  assert.deepEqual(calls[1]?.slice(0, 3), ['import', '-window', '13']);
});

test('a window that is missing or a platform that cannot capture asks for file:', async () => {
  await assert.rejects(
    () => captureWindow('Notes', { platform: 'darwin', runner: { run: async () => '5\tFinder\tDesktop\n' } }),
    /no window matches "Notes" \(on screen: Finder\); use window: with an owner name or a title, or take a screenshot and use file:/,
  );
  await assert.rejects(
    () => captureWindow('Notes', { platform: 'win32', runner: { run: async () => '' } }),
    /window: capture is not supported on win32; take a screenshot and use file:<path\.png> in map\.screens instead/,
  );
  await assert.rejects(
    () => captureWindow('Notes', { platform: 'linux', runner: { run: async () => '' } }),
    /no window matches "Notes"/,
  );
});

const SCREEN: ScreenSpec = {
  id: 'gallery',
  title: 'Gallery',
  frame: 'desktop',
  kind: 'page',
  width: 40,
  height: 24,
  states: ['default', 'empty'],
  flows: [],
  annotations: [{ text: 'Align to the grid', x: 120, y: 8 }],
  focus: [],
  variants: [
    {
      state: 'default',
      mode: 'light',
      components: [
        {
          name: 'wf-nav',
          role: 'nav',
          x: 16,
          y: 8,
          w: 10,
          h: 24,
          color: 'rgb(22, 22, 22)',
          background: 'rgba(0, 0, 0, 0)',
          fontFamily: '"IBM Plex Sans", sans-serif',
          fontSize: '16px',
          fontWeight: '400',
          radius: '0px',
          normative: true,
        },
        {
          name: 'PrimaryButton',
          role: 'button',
          x: 24,
          y: 4,
          w: 16,
          h: 16,
          color: 'rgb(255, 255, 255)',
          background: 'rgb(15, 98, 254)',
          fontFamily: '"IBM Plex Sans", sans-serif',
          fontSize: '16px',
          fontWeight: '600',
          radius: '2px',
          normative: true,
          text: 'Open',
          tokens: { color: '--fg', background: '--accent' },
        },
        {
          name: 'button',
          role: 'button',
          x: 0,
          y: 0,
          w: 2,
          h: 2,
          color: 'rgb(0, 0, 0)',
          background: 'rgba(0, 0, 0, 0)',
          fontFamily: 'sans-serif',
          fontSize: '16px',
          fontWeight: '400',
          radius: '0px',
          normative: false,
        },
      ],
    },
  ],
};

function handoff(): HandoffSpec {
  return {
    schema: 1,
    generator: 'rshow handoff',
    createdAt: '2026-01-01T00:00:00.000Z',
    source: { slug: 'gallery', version: 1, url: 'local:/design', kind: 'mockup', skin: '' },
    widths: [40],
    modes: ['light'],
    primaryWidth: 40,
    screens: [SCREEN],
    baselines: [{ screen: 'gallery', state: 'default', width: 40, mode: 'light', file: `baseline/${baselineName('gallery', 'default', 40, 'light')}` }],
  };
}

const TOKENS = JSON.stringify({
  base: {
    accent: { $value: '#0f62fe', $type: 'color' },
    fg: { $value: '#ffffff', $type: 'color' },
  },
});

test('a relation reads the size and the place against the sibling before it', () => {
  const [nav, button] = SCREEN.variants[0]?.components ?? [];
  assert.deepEqual(describeRelation(button as NonNullable<typeof button>, undefined), {
    size: '16x16, the first element in reading order',
    place: 'top left corner at 24,4',
  });
  assert.deepEqual(describeRelation(nav as NonNullable<typeof nav>, button), {
    size: '10x24 while PrimaryButton is 16x16',
    place: '8px left of PrimaryButton on the same row',
  });
});

test('the rubric lists the states, the normative components, the notes and the palette', () => {
  const expected = normativeColors(SCREEN, { light: [{ name: '--accent', value: '#0f62fe' }, { name: '--fg', value: '#ffffff' }], dark: [] }, 'default', 'light');
  assert.deepEqual(expected.map((token) => token.name), ['--fg', '--accent']);
  const markdown = rubricMarkdown({
    screen: SCREEN,
    shots: [
      {
        label: 'default 40 light',
        baseline: 'images/gallery-baseline.png',
        capture: 'images/gallery-capture.png',
        diff: 'images/gallery-diff.png',
        expected,
        palette: checkPalette(extractPalette(app(40, 24)), expected),
      },
    ],
  });
  assert.match(markdown, /^# Rubric: Gallery$/m);
  assert.match(markdown, /^\| default 40 light \| images\/gallery-baseline\.png \|/m);
  assert.match(markdown, /^- \[ \] `default`: /m);
  assert.match(markdown, /^- \[ \] `empty`: /m);
  assert.match(markdown, /^### default \/ light$/m);
  assert.match(markdown, /^- \[ \] \*\*wf-nav\*\* \(nav\) at 16,8$/m);
  assert.match(markdown, /- \[ \] the text reads "Open"/);
  assert.match(markdown, /- \[ \] the colour is rgb\(255, 255, 255\) on rgb\(15, 98, 254\), tokens color --fg, background --accent/);
  assert.match(markdown, /- \[ \] the size is 16x16, the first element in reading order/);
  assert.match(markdown, /- \[ \] the place is 8px left of PrimaryButton on the same row/);
  assert.match(markdown, /- \[ \] the type is "IBM Plex Sans", sans-serif 16px 600 and the radius is 2px/);
  assert.match(markdown, /- \[ \] the note at 120,8 holds: Align to the grid/);
  assert.match(markdown, /^- \[ \] `--accent` rgb\(15, 98, 254\) is in the capture$/m);
  assert.match(markdown, /- \[ \] no token colour is missing and no large area drifts/);
  assert.doesNotMatch(markdown, /\*\*button\*\*/);
});

test('a native screen diffs a screenshot, writes a rubric and reports review', async () => {
  const spec = handoff();
  const dir = await makeTempDir({
    'spec.json': JSON.stringify(spec),
    'tokens.json': TOKENS,
    [spec.baselines[0]?.file as string]: pngBuffer(app(40, 24)),
    'shots/gallery.png': pngBuffer(scaleImage(app(40, 24), 80, 48, 'nearest')),
  });
  const mapFile = path.join(dir, 'rshow.map.json');
  await writeFile(mapFile, JSON.stringify({ components: {}, tokens: {}, screens: { gallery: 'file:shots/gallery.png' } }));

  const result = await runCompare({
    against: dir,
    map: mapFile,
    threshold: 0.1,
    maxDiffRatio: 0.02,
    nativeMaxDiffRatio: 0.15,
    tuiColors: false,
  });
  assert.equal(result.pass, true);
  assert.equal(result.checked, 1);
  const row = result.results[0];
  assert.equal(row?.kind, 'native');
  assert.equal(row?.status, 'review');
  assert.equal(row?.pass, true);
  assert.equal(row?.diffRatio, 0);
  assert.match(row?.note ?? '', /2x Retina capture 80x48 scaled to 40px, review rubric-gallery\.md by eye/);
  assert.deepEqual(row?.images, {
    baseline: 'images/gallery__default__40__light-baseline.png',
    actual: 'images/gallery__default__40__light-capture.png',
    diff: 'images/gallery__default__40__light-diff.png',
  });

  const rubric = await readFile(path.join(dir, 'compare-report', 'rubric-gallery.md'), 'utf8');
  assert.match(rubric, /^- \[ \] \*\*PrimaryButton\*\* \(button\) at 24,4$/m);
  assert.match(rubric, /- \[ \] the text reads "Open"/);
  const html = await readFile(path.join(dir, 'compare-report', 'index.html'), 'utf8');
  assert.match(html, /<a href="rubric-gallery\.md">rubric-gallery\.md<\/a>/);
  assert.match(html, /<span class="review">review<\/span>/);
  assert.match(html, /<figcaption>capture<\/figcaption>/);
  const report = JSON.parse(await readFile(path.join(dir, 'compare-report', 'report.json'), 'utf8'));
  assert.equal(report.nativeMaxDiffRatio, 0.15);
  assert.equal(report.review, 1);
  assert.equal(report.results[0].kind, 'native');
  await readFile(path.join(dir, 'diff', 'gallery__default__40__light.png'));
});

test('a native screen passes a looser pixel limit and fails a token that never lands', async () => {
  const spec = handoff();
  const moved = app(40, 24, -3);
  const shifted = await makeTempDir({
    'spec.json': JSON.stringify(spec),
    'tokens.json': TOKENS,
    [spec.baselines[0]?.file as string]: pngBuffer(app(40, 24)),
    'shots/gallery.png': pngBuffer(moved),
  });
  const base = {
    against: shifted,
    map: path.join(shifted, 'rshow.map.json'),
    threshold: 0.1,
    maxDiffRatio: 0.02,
    tuiColors: false,
  };
  const source = JSON.stringify({ components: {}, tokens: {}, screens: { gallery: 'file:shots/gallery.png' } });
  await writeFile(base.map, source);
  const loose = await runCompare({ ...base, nativeMaxDiffRatio: 0.15 });
  assert.equal(loose.pass, true, JSON.stringify(loose.results));
  assert.equal(loose.results[0]?.status, 'review');
  assert.ok((loose.results[0]?.diffRatio ?? 0) > 0.02);

  const strict = await runCompare({ ...base, nativeMaxDiffRatio: 0.02 });
  assert.equal(strict.pass, false);
  assert.equal(strict.results[0]?.status, undefined);
  assert.match(strict.results[0]?.note ?? '', /pixels 0\.\d+ over native --native-max-diff-ratio 0\.02/);
});

test('a native screen without a matching token colour fails hard and names it', async () => {
  const spec = handoff();
  const dir = await makeTempDir({
    'spec.json': JSON.stringify(spec),
    'tokens.json': TOKENS,
    [spec.baselines[0]?.file as string]: pngBuffer(blankImage(40, 24, [255, 0, 0, 255])),
    'shots/gallery.png': pngBuffer(blankImage(40, 24, [255, 0, 0, 255])),
  });
  await writeFile(
    path.join(dir, 'rshow.map.json'),
    JSON.stringify({ components: {}, tokens: {}, screens: { gallery: 'file:shots/gallery.png' } }),
  );
  const result = await runCompare({
    against: dir,
    map: path.join(dir, 'rshow.map.json'),
    threshold: 0.1,
    maxDiffRatio: 0.02,
    nativeMaxDiffRatio: 0.15,
    tuiColors: false,
  });
  assert.equal(result.pass, false);
  const row = result.results[0];
  assert.equal(row?.pass, false);
  assert.equal(row?.status, undefined);
  assert.equal(row?.mismatches.length, 2);
  assert.deepEqual(row?.mismatches.map((mismatch) => [mismatch.component, mismatch.property]), [
    ['--fg', 'palette'],
    ['--accent', 'palette'],
  ]);
});

test('rshow compare finds a file: map entry and prints review', async () => {
  const spec = handoff();
  const dir = await makeTempDir({
    'design/spec.json': JSON.stringify(spec),
    'design/tokens.json': TOKENS,
    [`design/${spec.baselines[0]?.file as string}`]: pngBuffer(app(40, 24)),
    'shots/gallery.png': pngBuffer(app(40, 24)),
    'rshow.map.json': JSON.stringify({ components: {}, tokens: {}, screens: { gallery: 'file:shots/gallery.png' } }),
  });
  const result = await runCli(['compare', '--against', path.join(dir, 'design')], {}, { cwd: dir });
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^review gallery default light 40 diff 0\.0000 /m);
  assert.match(result.stdout, /^compare: ok \(1 checked, 0 without a url\)$/m);
  assert.match(result.stdout, /^review: 1 native screen\(s\) pass the hard checks and need a rubric pass in /m);
  assert.match(result.stdout, /^report: .*compare-report\/index\.html$/m);
});
