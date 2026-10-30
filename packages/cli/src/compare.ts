import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Chrome, Page } from './cdp.ts';
import { diffImages } from './diff.ts';
import { UsageError } from './exit.ts';
import { baselineName, displayPath, safeName, tokenArgs, viewportHeight } from './handoff.ts';
import { mapPath, readMapFile } from './map.ts';
import type { RshowMap } from './map.ts';
import { captureNative, checkPalette, extractPalette, isNative, normativeColors, parseCaptureSource } from './native.ts';
import type { NativeSource, PaletteFinding } from './native.ts';
import { collectComponents, focusScreen, openHelpers, screenClip, setMode } from './page.ts';
import type { PageInfo } from './page.ts';
import { cropImage, decodePng, encodePng, scaleToWidth } from './png.ts';
import type { Image } from './png.ts';
import { rubricMarkdown } from './rubric.ts';
import type { RubricShot } from './rubric.ts';
import { compareStructure, DEFAULT_COMPARE } from './spec.ts';
import type { BaselineSpec, ComponentSpec, HandoffSpec, ImplVariant, Mismatch } from './spec.ts';
import { flattenDtcg } from './tokens.ts';
import type { TokenSets } from './tokens.ts';
import { captureTmux, compareGrid, stripAnsi } from './tui.ts';

export type CompareOptions = {
  against: string;
  map?: string;
  threshold: number;
  maxDiffRatio: number;
  nativeMaxDiffRatio: number;
  tuiColors: boolean;
  chrome?: string;
  onProgress?: (line: string) => void;
};

export type ScreenResult = {
  screen: string;
  state: string;
  mode: string;
  width: number;
  source: string;
  kind: 'browser' | 'tui' | 'native';
  pass: boolean;
  status?: 'review';
  note?: string;
  diffRatio?: number;
  images?: { baseline: string; actual: string; diff: string };
  rubric?: string;
  palette?: { missing: PaletteFinding[]; drift: PaletteFinding[] };
  mismatches: Mismatch[];
};

export type CompareResult = {
  pass: boolean;
  results: ScreenResult[];
  checked: number;
  skipped: number;
  reportDir: string;
  spec: HandoffSpec;
};

export function nativeName(screen: string): string {
  return `rubric-${safeName(screen)}.md`;
}

function ratio(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function nativeScaleNote(capture: Image, width: number): string {
  const scale = capture.width / Math.max(1, width);
  const label = Math.abs(scale - 2) < 0.01 ? '2x Retina' : `${Math.round(scale * 100) / 100}x`;
  return `${label} capture ${capture.width}x${capture.height} scaled to ${width}px`;
}

const EMPTY_MAP: RshowMap = { components: {}, tokens: {}, screens: {} };

async function readJson(file: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new UsageError(`${what} is missing ${path.basename(file)} (run rshow handoff first)`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`invalid JSON in ${file}`);
  }
}

export async function readHandoff(dir: string): Promise<{ spec: HandoffSpec; tokens: TokenSets }> {
  const spec = (await readJson(path.join(dir, 'spec.json'), dir)) as HandoffSpec;
  if (spec === null || typeof spec !== 'object' || !Array.isArray(spec.screens)) {
    throw new UsageError(`${dir}/spec.json does not hold a handoff spec`);
  }
  let tokens: TokenSets = { light: [], dark: [] };
  try {
    tokens = flattenDtcg(JSON.parse(await readFile(path.join(dir, 'tokens.json'), 'utf8')));
  } catch {
    tokens = { light: [], dark: [] };
  }
  return { spec, tokens };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function implScreenId(info: PageInfo, wanted: string): string | undefined {
  const found = info.screens.find((screen) => screen.id === wanted);
  if (found !== undefined) return found.id;
  const page = info.screens.find((screen) => screen.id === 'page');
  if (page !== undefined) return page.id;
  return info.screens[0]?.id;
}

function clipOf(info: PageInfo, screenId: string): boolean {
  const screen = info.screens.find((item) => item.id === screenId);
  return screen !== undefined && (screen.kind === 'artboard' || screen.kind === 'slide');
}

export async function runCompare(opts: CompareOptions): Promise<CompareResult> {
  const say = opts.onProgress ?? ((): void => {});
  const dir = path.resolve(opts.against);
  const { spec, tokens } = await readHandoff(dir);
  const mapFile = opts.map === undefined ? mapPath() : path.resolve(opts.map);
  const map = (await readMapFile(mapFile)) ?? EMPTY_MAP;
  const mapDir = path.dirname(mapFile);
  const reportDir = path.join(dir, 'compare-report');
  const imagesDir = path.join(reportDir, 'images');
  await mkdir(imagesDir, { recursive: true });
  await mkdir(path.join(dir, 'diff'), { recursive: true });

  const results: ScreenResult[] = [];
  const collected: { screen: string; variants: ImplVariant[] }[] = [];
  let skipped = 0;

  const browser: BaselineSpec[] = [];
  const nativeItems: { baseline: BaselineSpec; source: NativeSource }[] = [];
  for (const baseline of spec.baselines ?? []) {
    const url = (map.screens[baseline.screen] ?? '').trim();
    if (url === '') {
      skipped += 1;
      results.push({
        screen: baseline.screen,
        state: baseline.state,
        mode: baseline.mode,
        width: baseline.width,
        source: '',
        kind: 'browser',
        pass: true,
        note: 'no url in rshow.map.json screens',
        mismatches: [],
      });
      continue;
    }
    const source = parseCaptureSource(url);
    if (source.kind === 'tmux') continue;
    if (isNative(source)) nativeItems.push({ baseline, source });
    else browser.push(baseline);
  }

  const tui = Object.entries(map.screens).filter(([, url]) => url.startsWith('tmux:'));
  for (const [screen, url] of tui) {
    const target = url.slice('tmux:'.length).trim();
    const captured = await captureTmux(target).catch((err) => {
      throw new UsageError(`tmux capture failed for ${target}: ${err instanceof Error ? err.message : String(err)}`);
    });
    const text = opts.tuiColors ? captured : stripAnsi(captured);
    const baselineFile = path.join(dir, 'baseline', `${safeName(screen)}.txt`);
    let expected: string | undefined;
    try {
      expected = await readFile(baselineFile, 'utf8');
    } catch {
      expected = undefined;
    }
    if (expected === undefined) {
      await mkdir(path.dirname(baselineFile), { recursive: true });
      await writeFile(baselineFile, text);
      results.push({
        screen,
        state: 'default',
        mode: 'tui',
        width: 0,
        source: target,
        kind: 'tui',
        pass: true,
        note: `baseline written to baseline/${safeName(screen)}.txt`,
        mismatches: [],
      });
      continue;
    }
    const grid = compareGrid(expected, text);
    results.push({
      screen,
      state: 'default',
      mode: 'tui',
      width: 0,
      source: target,
      kind: 'tui',
      pass: grid.pass,
      note: `${grid.rows} rows, ${grid.differing.length} differ`,
      mismatches: grid.differing.slice(0, 40).map((row) => ({
        screen,
        state: 'default',
        mode: 'tui',
        component: `row ${row.row}`,
        property: 'text',
        expected: row.expected,
        actual: row.actual,
      })),
    });
  }

  const nativeScreens = new Map<string, { source: NativeSource; list: BaselineSpec[] }>();
  for (const item of nativeItems) {
    const bucket = nativeScreens.get(item.baseline.screen) ?? { source: item.source, list: [] };
    bucket.list.push(item.baseline);
    nativeScreens.set(item.baseline.screen, bucket);
  }

  for (const [screen, group] of nativeScreens) {
    const raw = (map.screens[screen] ?? '').trim();
    say(`capture: ${raw}`);
    let capture: Image | undefined;
    let failure: string | undefined;
    try {
      capture = decodePng(await captureNative(group.source, mapDir));
    } catch (err) {
      if (err instanceof UsageError) throw err;
      failure = err instanceof Error ? err.message : String(err);
    }
    const screenSpec = spec.screens.find((item) => item.id === screen);
    const rubricFile = nativeName(screen);
    const shots: RubricShot[] = [];

    for (const baseline of group.list) {
      const stem = baselineName(baseline.screen, baseline.state, baseline.width, baseline.mode).replace(/\.png$/, '');
      const label = `${baseline.state} ${baseline.width} ${baseline.mode}`;
      const base: ScreenResult = {
        screen,
        state: baseline.state,
        mode: baseline.mode,
        width: baseline.width,
        source: raw,
        kind: 'native',
        pass: false,
        rubric: rubricFile,
        mismatches: [],
      };
      if (failure !== undefined || capture === undefined) {
        results.push({ ...base, note: `capture failed: ${failure ?? 'no pixels'}` });
        continue;
      }
      let expectedImage: Image;
      try {
        expectedImage = decodePng(new Uint8Array(await readFile(path.join(dir, baseline.file))));
      } catch {
        results.push({ ...base, note: `missing baseline ${baseline.file}` });
        continue;
      }

      const scaled = scaleToWidth(capture, baseline.width);
      const width = Math.min(expectedImage.width, scaled.width);
      const height = Math.min(expectedImage.height, scaled.height);
      const diff = diffImages(cropImage(expectedImage, width, height), cropImage(scaled, width, height), {
        threshold: opts.threshold,
      });
      const diffPng = encodePng(diff.image);
      await writeFile(path.join(imagesDir, `${stem}-diff.png`), diffPng);
      await writeFile(path.join(dir, 'diff', `${stem}.png`), diffPng);
      await writeFile(path.join(imagesDir, `${stem}-capture.png`), encodePng(scaled));
      await copyFile(path.join(dir, baseline.file), path.join(imagesDir, `${stem}-baseline.png`));

      const expected = screenSpec === undefined ? [] : normativeColors(screenSpec, tokens, baseline.state, baseline.mode);
      const palette = checkPalette(extractPalette(scaled), expected);
      const pixelOk = diff.ratio <= opts.nativeMaxDiffRatio;
      const pass = pixelOk && palette.missing.length === 0;
      const notes = [nativeScaleNote(capture, baseline.width)];
      if (expectedImage.height !== scaled.height) {
        notes.push(`height ${expectedImage.height} against ${scaled.height}`);
      }
      if (!pixelOk) notes.push(`pixels ${ratio(diff.ratio)} over native --native-max-diff-ratio ${opts.nativeMaxDiffRatio}`);
      if (palette.missing.length > 0) notes.push(`${palette.missing.length} token colour(s) missing`);
      if (palette.drift.length > 0) notes.push(`${palette.drift.length} colour(s) drifting`);
      notes.push(pass ? `review ${rubricFile} by eye` : 'fix the hard finding first');

      results.push({
        ...base,
        pass,
        status: pass ? 'review' : undefined,
        note: notes.join(', '),
        diffRatio: ratio(diff.ratio),
        images: {
          baseline: `images/${stem}-baseline.png`,
          actual: `images/${stem}-capture.png`,
          diff: `images/${stem}-diff.png`,
        },
        palette: { missing: palette.missing, drift: palette.drift },
        mismatches: palette.missing.map((finding) => ({
          screen,
          state: baseline.state,
          mode: baseline.mode,
          component: finding.token,
          property: 'palette',
          expected: finding.expected,
          actual: finding.actual,
        })),
      });
      shots.push({
        label,
        baseline: `images/${stem}-baseline.png`,
        capture: `images/${stem}-capture.png`,
        diff: `images/${stem}-diff.png`,
        expected,
        palette,
      });
    }

    if (screenSpec !== undefined) {
      await writeFile(path.join(reportDir, rubricFile), `${rubricMarkdown({ screen: screenSpec, shots })}\n`);
    }
  }

  const byUrl = new Map<string, BaselineSpec[]>();
  for (const baseline of browser) {
    const url = (map.screens[baseline.screen] ?? '').trim();
    const list = byUrl.get(url) ?? [];
    list.push(baseline);
    byUrl.set(url, list);
  }

  if (byUrl.size > 0) {
    const chrome = await Chrome.launch({ binary: opts.chrome });
    try {
      for (const [url, list] of byUrl) {
        say(`open: ${url}`);
        const page = await Page.open(chrome);
        const info = await openHelpers(page, url);
        const modes = [...new Set(list.map((item) => item.mode))];
        const widths = [...new Set(list.map((item) => item.width))];
        for (const mode of modes) {
          await setMode(page, mode);
          for (const width of widths) {
            await page.setViewport(width, viewportHeight(width));
            const batch = list.filter((item) => item.mode === mode && item.width === width);
            for (const baseline of batch) {
              const screenId = implScreenId(info, baseline.screen);
              const name = baselineName(baseline.screen, baseline.state, baseline.width, baseline.mode);
              const stem = name.replace(/\.png$/, '');
              if (screenId === undefined) {
                results.push({
                  screen: baseline.screen,
                  state: baseline.state,
                  mode,
                  width,
                  source: url,
                  kind: 'browser',
                  pass: false,
                  note: 'screen not found in the implementation',
                  mismatches: [],
                });
                continue;
              }
              await focusScreen(page, screenId, baseline.state);
              if (width === spec.primaryWidth) {
                const components: ComponentSpec[] = await collectComponents(
                  page,
                  screenId,
                  tokenArgs(tokens, mode),
                );
                const variant: ImplVariant = { state: baseline.state, mode, components };
                const bucket = collected.find((item) => item.screen === baseline.screen);
                if (bucket === undefined) collected.push({ screen: baseline.screen, variants: [variant] });
                else bucket.variants.push(variant);
              }
              const clip = clipOf(info, screenId) ? await screenClip(page, screenId) : null;
              const actual = await page.screenshot(clip ?? undefined);
              const actualFile = path.join(imagesDir, `${stem}-actual.png`);
              await writeFile(actualFile, actual);

              const baselineFile = path.join(dir, baseline.file);
              let expected: Uint8Array;
              try {
                expected = new Uint8Array(await readFile(baselineFile));
              } catch {
                results.push({
                  screen: baseline.screen,
                  state: baseline.state,
                  mode,
                  width,
                  source: url,
                  kind: 'browser',
                  pass: false,
                  note: `missing baseline ${baseline.file}`,
                  mismatches: [],
                });
                continue;
              }
              const baselineCopy = path.join(imagesDir, `${stem}-baseline.png`);
              await copyFile(baselineFile, baselineCopy);
              const left = decodePng(expected);
              const right = decodePng(actual);
              const diff = diffImages(left, right, { threshold: opts.threshold });
              const diffPng = encodePng(diff.image);
              await writeFile(path.join(imagesDir, `${stem}-diff.png`), diffPng);
              await writeFile(path.join(dir, 'diff', `${stem}.png`), diffPng);
              const note =
                left.width === right.width && left.height === right.height
                  ? undefined
                  : `size ${left.width}x${left.height} against ${right.width}x${right.height}`;
              results.push({
                screen: baseline.screen,
                state: baseline.state,
                mode,
                width,
                source: url,
                kind: 'browser',
                pass: diff.ratio <= opts.maxDiffRatio,
                diffRatio: Math.round(diff.ratio * 10000) / 10000,
                images: {
                  baseline: `images/${stem}-baseline.png`,
                  actual: `images/${stem}-actual.png`,
                  diff: `images/${stem}-diff.png`,
                },
                note,
                mismatches: [],
              });
            }
          }
        }
        await page.close();
      }
    } finally {
      await chrome.close();
    }
  }

  const comparedSpec: HandoffSpec = {
    ...spec,
    screens: spec.screens.filter((screen) => collected.some((item) => item.screen === screen.id)),
  };
  const structural = compareStructure(comparedSpec, collected, tokens, {
    threshold: opts.threshold,
    maxDiffRatio: opts.maxDiffRatio,
  });
  for (const mismatch of structural) {
    let result = results.find(
      (item) =>
        item.screen === mismatch.screen &&
        item.state === mismatch.state &&
        item.mode === mismatch.mode &&
        item.width === spec.primaryWidth,
    );
    if (result === undefined) {
      result = {
        screen: mismatch.screen,
        state: mismatch.state,
        mode: mismatch.mode,
        width: spec.primaryWidth,
        source: '',
        kind: 'browser',
        pass: false,
        note: 'structure only',
        mismatches: [],
      };
      results.push(result);
    }
    result.mismatches.push(mismatch);
  }
  for (const result of results) {
    if (result.mismatches.length > 0) result.pass = false;
  }

  results.sort((left, right) => {
    if (left.screen !== right.screen) return left.screen < right.screen ? -1 : 1;
    if (left.state !== right.state) return left.state < right.state ? -1 : 1;
    if (left.width !== right.width) return left.width - right.width;
    return left.mode < right.mode ? -1 : left.mode > right.mode ? 1 : 0;
  });

  const pass = results.every((item) => item.pass);
  const checked = results.filter((item) => item.source !== '').length;
  const review = results.filter((item) => item.status === 'review').length;
  const generatedAt = new Date().toISOString();
  await writeFile(
    path.join(reportDir, 'report.json'),
    `${JSON.stringify(
      {
        schema: 1,
        generatedAt,
        source: spec.source,
        against: displayPath(dir),
        threshold: opts.threshold,
        maxDiffRatio: opts.maxDiffRatio,
        nativeMaxDiffRatio: opts.nativeMaxDiffRatio,
        pass,
        checked,
        skipped,
        review,
        results: results.map((item) => ({
          screen: item.screen,
          state: item.state,
          mode: item.mode,
          width: item.width,
          kind: item.kind,
          source: item.source,
          pass: item.pass,
          status: item.status,
          note: item.note,
          diffRatio: item.diffRatio,
          images: item.images,
          rubric: item.rubric,
          palette: item.palette,
          mismatches: item.mismatches,
        })),
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(reportDir, 'index.html'),
    reportHtml({
      spec,
      results,
      pass,
      generatedAt,
      threshold: opts.threshold,
      maxDiffRatio: opts.maxDiffRatio,
      nativeMaxDiffRatio: opts.nativeMaxDiffRatio,
    }),
  );

  return { pass, results, checked, skipped, reportDir, spec };
}

export type ReportInput = {
  spec: HandoffSpec;
  results: ScreenResult[];
  pass: boolean;
  generatedAt: string;
  threshold: number;
  maxDiffRatio: number;
  nativeMaxDiffRatio?: number;
};

const REPORT_CSS = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #161616; --muted: #525252; --line: #e0e0e0;
  --ok: #0e6027; --bad: #a2191f; --accent: #0f62fe; --panel: #f4f4f4; }
:root[data-mode="dark"] { --bg: #161616; --fg: #f4f4f4; --muted: #c6c6c6; --line: #393939;
  --ok: #42be65; --bad: #ff8389; --accent: #78a9ff; --panel: #262626; }
@media (prefers-color-scheme: dark) {
  :root:not([data-mode="light"]) { --bg: #161616; --fg: #f4f4f4; --muted: #c6c6c6; --line: #393939;
    --ok: #42be65; --bad: #ff8389; --accent: #78a9ff; --panel: #262626; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 24px 96px; background: var(--bg); color: var(--fg);
  font: 16px/1.5 "IBM Plex Sans", system-ui, sans-serif; }
main { max-width: 1056px; margin: 0 auto; }
h1 { margin: 0 0 4px; font-size: 32px; font-weight: 400; }
h2 { margin: 40px 0 12px; font-size: 20px; font-weight: 600; }
h3 { margin: 32px 0 8px; font-size: 16px; font-weight: 600; }
p { margin: 0 0 12px; color: var(--muted); }
code, pre { font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 13px; }
pre { padding: 12px 16px; background: var(--panel); overflow: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; }
th { font-weight: 600; color: var(--muted); }
.pass { color: var(--ok); }
.fail { color: var(--bad); }
.review { color: var(--accent); }
.badge { display: inline-block; padding: 0 8px; border: 1px solid currentColor; border-radius: 0;
  font-size: 12px; font-weight: 600; }
.shots { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
figure { margin: 0; }
figure img { display: block; width: 100%; height: auto; border: 1px solid var(--line); background: var(--panel); }
figcaption { margin-top: 4px; font-size: 12px; color: var(--muted); }
`;

export function reportHtml(input: ReportInput): string {
  const { spec, results, pass } = input;
  const version = spec.source.version === null ? 'local' : `v${spec.source.version}`;
  const failed = results.filter((item) => !item.pass);
  const reviewing = results.filter((item) => item.status === 'review');
  const nativeLimit = input.nativeMaxDiffRatio ?? 0.15;
  const statusOf = (item: ScreenResult): string => item.status ?? (item.pass ? 'pass' : 'fail');
  const rows = results
    .map((item) => {
      const status = statusOf(item);
      const mark =
        status === 'pass'
          ? '<span class="pass">pass</span>'
          : status === 'review'
            ? '<span class="review">review</span>'
            : '<span class="fail">fail</span>';
      const ratio = item.diffRatio === undefined ? '-' : item.diffRatio.toFixed(4);
      const rubric = item.rubric === undefined ? '' : ` <a href="${escapeHtml(item.rubric)}">rubric</a>`;
      return `<tr><td>${escapeHtml(item.screen)}</td><td>${escapeHtml(item.state)}</td><td>${escapeHtml(item.mode)}</td><td>${item.width === 0 ? '-' : item.width}</td><td>${mark}</td><td>${ratio}</td><td>${item.mismatches.length}</td><td>${escapeHtml(item.note ?? '')}${rubric}</td></tr>`;
    })
    .join('\n');

  const sections = results
    .filter((item) => item.images !== undefined || item.mismatches.length > 0)
    .map((item) => {
      const status = statusOf(item);
      const badge = `<span class="badge ${status}">${status}</span>`;
      const captureCaption = item.kind === 'native' ? 'capture' : 'actual';
      const shots =
        item.images === undefined
          ? ''
          : `<div class="shots">
  <figure><img src="${escapeHtml(item.images.baseline)}" alt="baseline"><figcaption>baseline</figcaption></figure>
  <figure><img src="${escapeHtml(item.images.actual)}" alt="${captureCaption}"><figcaption>${captureCaption}</figcaption></figure>
  <figure><img src="${escapeHtml(item.images.diff)}" alt="diff"><figcaption>diff</figcaption></figure>
</div>`;
      const rubric =
        item.rubric === undefined
          ? ''
          : `<p><a href="${escapeHtml(item.rubric)}">${escapeHtml(item.rubric)}</a> lists what to look for in these two images. Open it beside them and tick it in.</p>`;
      const mismatches =
        item.mismatches.length === 0
          ? ''
          : `<table>
<thead><tr><th>component</th><th>property</th><th>expected</th><th>actual</th></tr></thead>
<tbody>
${item.mismatches
  .map(
    (mismatch) =>
      `<tr><td>${escapeHtml(mismatch.component)}</td><td>${escapeHtml(mismatch.property)}</td><td><code>${escapeHtml(mismatch.expected)}</code></td><td><code>${escapeHtml(mismatch.actual)}</code></td></tr>`,
  )
  .join('\n')}
</tbody>
</table>`;
      return `<h3>${escapeHtml(item.screen)} / ${escapeHtml(item.state)} / ${escapeHtml(item.mode)}${item.width === 0 ? '' : ` / ${item.width}px`} ${badge}</h3>
${shots}
${rubric}
${mismatches}`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rshow compare: ${escapeHtml(spec.source.slug)} ${version}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>
<h1>Compare: ${escapeHtml(spec.source.slug)} ${version}</h1>
<p>${escapeHtml(input.generatedAt)} against ${results.length} screen(s), threshold ${input.threshold}, max diff ratio ${input.maxDiffRatio} (native ${nativeLimit}). ${pass ? `<span class="pass">all pass</span>` : `<span class="fail">${failed.length} failing</span>`}${reviewing.length === 0 ? '' : `, <span class="review">${reviewing.length} for review</span>`}.</p>
<p>Source: <code>${escapeHtml(spec.source.url)}</code></p>
<h2>Screens</h2>
<table>
<thead><tr><th>screen</th><th>state</th><th>mode</th><th>width</th><th>result</th><th>diff ratio</th><th>mismatches</th><th>note</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${sections === '' ? '' : `<h2>Images and mismatches</h2>\n${sections}`}
</body>
</html>
`;
}
