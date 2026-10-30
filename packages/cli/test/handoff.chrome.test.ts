import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { findChrome } from '../src/cdp.ts';
import { decodePng } from '../src/png.ts';
import { mapPath, readMapFile } from '../src/map.ts';
import { makeTempDir, runCli, startCli } from './helpers.ts';

function chromeBinary(): string | undefined {
  try {
    return findChrome();
  } catch {
    return undefined;
  }
}

const CHROME = chromeBinary();
const URL_PATTERN = /http:\/\/127\.0\.0\.1:[0-9]+/;

const FIXTURE: Record<string, string> = {
  'tokens.css': `:root{--bg:#ffffff;--fg:#161616;--accent:#0f62fe;--radius-2:2px;--text-16:16px}
:root[data-mode="dark"]{--bg:#161616;--fg:#f4f4f4}`,
  'skin.css': `.wf-button{display:inline-block;height:32px;padding:0 12px;border-radius:var(--radius-2);
  background:var(--accent);color:#ffffff;font:600 16px/32px "IBM Plex Sans",system-ui,sans-serif}
.artboard{position:relative;width:360px;padding:16px;background:var(--bg);color:var(--fg);
  font:16px/1.4 "IBM Plex Sans",system-ui,sans-serif}`,
  'index.html': `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Fixture</title><link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="skin.css"></head>
<body style="margin:0">
<main class="mockup" data-skin="wire">
  <section class="artboard" id="gallery" data-frame="browser" data-title="Gallery" data-states="empty">
    <h1 style="margin:0 0 16px;font-size:28px">Gallery</h1>
    <button class="wf-button" data-component="PrimaryButton" data-normative>Open</button>
  </section>
  <section class="artboard" id="share" data-frame="custom" data-title="Share">
    <h1 style="margin:0 0 16px;font-size:28px">Share</h1>
    <a class="wf-button" href="#gallery">Back</a>
  </section>
</main>
</body></html>`,
};

test(
  'handoff writes a folder and compare passes, then fails on drift',
  { skip: CHROME === undefined ? 'no Chrome or Chromium found' : false, timeout: 240000 },
  async (t) => {
    const dir = await makeTempDir(FIXTURE);
    const work = await makeTempDir({});
    const out = path.join(work, 'handoff-fixture-v0');
    const env = { CHROME: CHROME as string, RSHOW_ART: 'https://art.example.com' };

    const handoff = await runCli(
      ['handoff', dir, '--out', out, '--widths', '760', '--modes', 'light'],
      env,
      { cwd: work },
    );
    assert.equal(handoff.stderr, '');
    assert.equal(handoff.code, 0);
    assert.match(handoff.stdout, /^page: mockup \(wire\), 2 screen\(s\)$/m);
    assert.match(handoff.stdout, /^tokens: 5 \(2 dark\)$/m);
    assert.match(handoff.stdout, /^screens: 2, baselines: 3$/m);
    assert.match(handoff.stdout, /^map: rshow\.map\.json \(starter written\)$/m);

    const tokens = JSON.parse(await readFile(path.join(out, 'tokens.json'), 'utf8'));
    assert.equal(tokens.base.accent.$value, '#0f62fe');
    assert.equal(tokens.base.accent.$type, 'color');
    assert.equal(tokens.dark.base.bg.$value, '#161616');

    const spec = JSON.parse(await readFile(path.join(out, 'spec.json'), 'utf8'));
    assert.equal(spec.schema, 1);
    assert.deepEqual(spec.widths, [760]);
    assert.deepEqual(spec.modes, ['light']);
    assert.deepEqual(
      spec.screens.map((screen: { id: string }) => screen.id),
      ['gallery', 'share'],
    );
    const gallery = spec.screens[0];
    assert.deepEqual(gallery.states, ['default', 'empty']);
    assert.deepEqual(gallery.flows, []);
    assert.deepEqual(spec.screens[1].flows, [{ from: 'share', to: 'gallery' }]);
    assert.deepEqual(gallery.focus.map((item: { name: string }) => item.name), ['PrimaryButton']);
    const variant = gallery.variants.find((item: { state: string }) => item.state === 'default');
    const button = variant.components.find((item: { name: string }) => item.name === 'PrimaryButton');
    assert.equal(button.role, 'button');
    assert.equal(button.normative, true);
    assert.equal(button.text, 'Open');
    assert.equal(button.fontSize, '16px');
    assert.equal(button.radius, '2px');
    assert.deepEqual(button.tokens, {
      color: '--bg',
      background: '--accent',
      fontSize: '--text-16',
      radius: '--radius-2',
    });
    assert.equal(spec.baselines.length, 3);
    assert.deepEqual(
      spec.baselines.map((item: { file: string }) => item.file).sort(),
      [
        'baseline/gallery__default__760__light.png',
        'baseline/gallery__empty__760__light.png',
        'baseline/share__default__760__light.png',
      ],
    );

    const png = await readFile(path.join(out, 'baseline', 'gallery__default__760__light.png'));
    const image = decodePng(new Uint8Array(png));
    assert.ok(image.width > 100 && image.height > 40, `${image.width}x${image.height}`);

    const markdown = await readFile(path.join(out, 'HANDOFF.md'), 'utf8');
    assert.match(markdown, /^# Handoff: rshow-[A-Za-z0-9]+ local$/m);
    assert.match(markdown, /^rshow compare --against .*handoff-fixture-v0 --map rshow\.map\.json$/m);
    assert.match(markdown, /PrimaryButton/);

    const starter = await readMapFile(mapPath(work));
    assert.deepEqual(starter?.components, { PrimaryButton: '', 'wf-button': '' });
    assert.deepEqual(Object.keys(starter?.screens ?? {}), ['gallery', 'share']);
    assert.equal(starter?.screens.gallery, '');

    const preview = startCli(['preview', dir, '--port', '0'], {}, { cwd: work });
    t.after(() => preview.stop());
    const url = await preview.waitFor(URL_PATTERN);
    await writeFile(
      mapPath(work),
      `${JSON.stringify({ components: {}, tokens: {}, screens: { gallery: url, share: url } }, null, 2)}\n`,
    );

    const passing = await runCli(['compare', '--against', out], {}, { cwd: work });
    assert.equal(passing.stderr, '');
    assert.equal(passing.code, 0);
    assert.match(passing.stdout, /^pass gallery default light 760 diff 0\.0000$/m);
    assert.match(passing.stdout, /^compare: ok \(3 checked, 0 without a url\)$/m);
    const report = JSON.parse(await readFile(path.join(out, 'compare-report', 'report.json'), 'utf8'));
    assert.equal(report.pass, true);
    assert.equal(report.results.length, 3);
    const images = await readdir(path.join(out, 'compare-report', 'images'));
    assert.equal(images.length, 9);
    assert.ok((await readdir(path.join(out, 'diff'))).length === 3);

    await writeFile(
      path.join(dir, 'skin.css'),
      (FIXTURE['skin.css'] as string)
        .replace('background:var(--accent)', 'background:#0f62ff')
        .replace('height:32px', 'height:40px'),
    );

    const failing = await runCli(['compare', '--against', out], {}, { cwd: work });
    assert.equal(failing.code, 7, failing.stdout + failing.stderr);
    assert.match(failing.stdout, /^fail gallery default light 760 diff /m);
    assert.match(failing.stdout, /mismatch gallery default PrimaryButton: box expected /);
    assert.match(failing.stdout, /mismatch gallery default PrimaryButton: raw-background expected --accent/);
    assert.match(failing.stdout, /^compare: 3 failing of 3 checked \(0 without a url\)$/m);

    const failedReport = JSON.parse(await readFile(path.join(out, 'compare-report', 'report.json'), 'utf8'));
    assert.equal(failedReport.pass, false);
    assert.ok(
      failedReport.results.some((item: { mismatches: unknown[] }) => item.mismatches.length > 0),
      'the report holds the mismatches',
    );
    const html = await readFile(path.join(out, 'compare-report', 'index.html'), 'utf8');
    assert.match(html, /PrimaryButton/);
    assert.match(html, /images\/gallery__default__760__light-diff\.png/);

    const missing = await runCli(['compare', '--against', await makeTempDir({})], {}, { cwd: work });
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /is missing spec\.json/);
  },
);
