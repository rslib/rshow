import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Chrome, Page } from './cdp.ts';
import { UsageError } from './exit.ts';
import { MAP_FILE, mapPath, readMapFile, starterMap, writeMapFile } from './map.ts';
import type { RshowMap } from './map.ts';
import { networkDetail, readyNetwork } from './network.ts';
import { collectComponents, collectInfo, focusScreen, openHelpers, screenClip, setMode } from './page.ts';
import type { PageScreen, TokenArg } from './page.ts';
import { startPreview } from './serve.ts';
import { deriveSlug } from './slug.ts';
import type { HandoffSource, HandoffSpec, ScreenSpec, BaselineSpec } from './spec.ts';
import { cssFilesOfHtml, dtcgTokens, extractTokens, inlineStylesOfHtml } from './tokens.ts';
import type { TokenSets } from './tokens.ts';

export const HANDOFF_SCHEMA = 1;
const REMOTE_TARGET = /^([a-z0-9][a-z0-9-]{0,62})@v([0-9]+)$/;

export type HandoffTarget =
  | { kind: 'remote'; slug: string; version: number }
  | { kind: 'local'; dir: string; slug: string };

export type HandoffOptions = {
  out: string;
  widths: number[];
  modes: string[];
  art: string;
  fetchImpl?: typeof fetch;
  chrome?: string;
  onProgress?: (line: string) => void;
};

export type HandoffResult = {
  out: string;
  url: string;
  source: HandoffSource;
  spec: HandoffSpec;
  tokens: TokenSets;
  mapFile: string;
  mapWritten: boolean;
  screens: number;
  baselines: number;
};

export function parseTarget(input: string): HandoffTarget {
  const remote = REMOTE_TARGET.exec(input.trim());
  if (remote !== null) {
    return { kind: 'remote', slug: remote[1] as string, version: Number(remote[2]) };
  }
  const dir = path.resolve(input);
  return { kind: 'local', dir, slug: deriveSlug(path.basename(dir)) || 'handoff' };
}

export async function requireLocalDir(target: HandoffTarget): Promise<string> {
  if (target.kind !== 'local') throw new UsageError('expected a local folder');
  const info = await stat(target.dir).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) throw new UsageError(`no such folder: ${target.dir}`);
  const index = await stat(path.join(target.dir, 'index.html')).catch(() => undefined);
  if (index === undefined || !index.isFile()) throw new UsageError(`${target.dir} has no index.html`);
  return target.dir;
}

export function handoffDirName(slug: string, version: number | null): string {
  return version === null ? `handoff-${slug}` : `handoff-${slug}-v${version}`;
}

export function sourceUrl(art: string, slug: string, version: number | null): string {
  const base = art.replace(/\/+$/, '');
  return version === null ? `${base}/${slug}/` : `${base}/${slug}/v${version}/`;
}

export function viewportHeight(width: number): number {
  return width <= 500 ? 844 : 900;
}

export function safeName(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'screen' : cleaned;
}

export function displayPath(target: string): string {
  const resolved = path.resolve(target);
  const relative = path.relative(process.cwd(), resolved);
  if (relative === '') return '.';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return resolved;
  return relative;
}

export function baselineName(screen: string, state: string, width: number, mode: string): string {
  return `${safeName(screen)}__${safeName(state)}__${width}__${mode}.png`;
}

export function tokenArgs(tokens: TokenSets, mode: string): TokenArg[] {
  const list = mode === 'dark' && tokens.dark.length > 0 ? tokens.dark : tokens.light;
  return list.map((item) => ({ name: item.name, value: item.value }));
}

export async function collectStyleTexts(url: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let reply: Response;
  try {
    reply = await fetchImpl(url, { headers: { accept: 'text/html' } });
  } catch {
    return [];
  }
  if (!reply.ok) return [];
  const html = await reply.text();
  const texts = inlineStylesOfHtml(html);
  for (const href of cssFilesOfHtml(html)) {
    let target: string;
    try {
      target = new URL(href, url).toString();
    } catch {
      continue;
    }
    const css = await fetchImpl(target).catch(() => undefined);
    if (css === undefined || !css.ok) continue;
    texts.push(await css.text());
  }
  return texts;
}

export async function assertPublic(url: string, art: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  let reply: Response;
  await readyNetwork();
  try {
    reply = await fetchImpl(url, { headers: { accept: 'text/html' }, redirect: 'follow' });
  } catch (err) {
    throw new UsageError(`cannot reach ${url}: ${networkDetail(err, url)}`);
  }
  const host = new URL(art).host;
  const wandered = new URL(reply.url === '' ? url : reply.url).host !== host;
  if (reply.status === 401 || reply.status === 403 || reply.status === 404 || wandered) {
    throw new UsageError(
      `${url} is not public (HTTP ${reply.status})${wandered ? ' and redirects off the art host' : ''}; ` +
        'make the version public, or run rshow handoff on a local folder',
    );
  }
}

function logicalName(name: string, role: string): boolean {
  if (name === role) return false;
  return !/^[a-z][a-z0-9]*$/.test(name);
}

export function starterMapOf(spec: HandoffSpec, tokens: TokenSets): RshowMap {
  const components = new Set<string>();
  for (const screen of spec.screens) {
    for (const variant of screen.variants) {
      for (const component of variant.components) {
        if (logicalName(component.name, component.role)) components.add(component.name);
      }
    }
  }
  const names = [...tokens.light, ...tokens.dark].map((item) => item.name);
  return starterMap([...components].sort(), [...new Set(names)].sort(), spec.screens.map((screen) => screen.id));
}

function tableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export type HandoffDoc = {
  source: HandoffSource;
  out: string;
  widths: number[];
  modes: string[];
  screens: ScreenSpec[];
  tokens: TokenSets;
  createdAt: string;
  mapFile: string;
};

export function handoffMarkdown(doc: HandoffDoc): string {
  const lines: string[] = [];
  const version = doc.source.version === null ? 'local' : `v${doc.source.version}`;
  lines.push(`# Handoff: ${doc.source.slug} ${version}`);
  lines.push('');
  lines.push(`Immutable source: ${doc.source.url}`);
  lines.push(`Generated by rshow handoff on ${doc.createdAt}, a ${doc.source.kind}${doc.source.skin === '' ? '' : ` with the ${doc.source.skin} skin`}.`);
  lines.push(`Screenshots: ${doc.widths.join(', ')} px wide in ${doc.modes.join(' and ')} mode.`);
  lines.push('');
  lines.push('Files: tokens.json (W3C DTCG 2025.10), spec.json (components, boxes, flows, annotations, focus order), baseline/ (one PNG per screen, state, width and mode) and this file.');
  lines.push('');
  lines.push('## Screens');
  lines.push('');
  lines.push('| screen | title | frame | states | size |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const screen of doc.screens) {
    lines.push(
      `| ${tableCell(screen.id)} | ${tableCell(screen.title)} | ${tableCell(screen.frame === '' ? '-' : screen.frame)} | ${tableCell(screen.states.join(', '))} | ${screen.width}x${screen.height} |`,
    );
  }
  lines.push('');
  const flows = doc.screens.flatMap((screen) => screen.flows);
  if (flows.length > 0) {
    lines.push('## Flows');
    lines.push('');
    for (const flow of flows) lines.push(`- ${flow.from} to ${flow.to}`);
    lines.push('');
  }
  const notes = doc.screens.flatMap((screen) => screen.annotations.map((note) => ({ screen: screen.id, note })));
  if (notes.length > 0) {
    lines.push('## Annotations');
    lines.push('');
    for (const item of notes) lines.push(`- ${item.screen} at ${item.note.x},${item.note.y}: ${item.note.text}`);
    lines.push('');
  }
  lines.push('## Components');
  lines.push('');
  lines.push('| screen | state | mode | component | role | box | tokens | must match |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const screen of doc.screens) {
    const seen = new Set<string>();
    for (const variant of screen.variants) {
      for (const component of variant.components) {
        if (!logicalName(component.name, component.role)) continue;
        const mark = `${variant.state}\n${component.name}\n${component.x},${component.y},${component.w},${component.h}`;
        if (seen.has(mark)) continue;
        seen.add(mark);
        const tokens = Object.entries(component.tokens ?? {})
          .map(([key, name]) => `${key} ${name}`)
          .join(', ');
        lines.push(
          `| ${tableCell(screen.id)} | ${tableCell(variant.state)} | ${variant.mode} | ${tableCell(component.name)} | ${component.role} | ${component.x},${component.y} ${component.w}x${component.h} | ${tableCell(tokens === '' ? '-' : tokens)} | ${component.normative ? 'yes' : 'placeholder'} |`,
        );
      }
    }
  }
  lines.push('');
  lines.push('## Tokens');
  lines.push('');
  const darkCount = doc.tokens.dark.length;
  lines.push(`tokens.json holds ${doc.tokens.light.length} tokens${darkCount === 0 ? '' : ` and ${darkCount} dark values as a dark group`}, grouped by name prefix and typed as color, dimension, fontFamily, fontWeight or number.`);
  lines.push('');
  lines.push('## Rules');
  lines.push('');
  lines.push(`- Use the component mapped in ${doc.mapFile} for every name in the table above. If a name has no target yet, map it before you style it; never invent a second look for it.`);
  lines.push('- Use the tokens from tokens.json, never raw values. A value that equals a token is right; a raw colour near a token colour is drift and rshow compare reports it.');
  lines.push('- data-normative means the text, the box and the computed style must match this handoff. Everything else is a placeholder: text, data and images are free to change.');
  lines.push('- Keep the flows and the focus order. Keep the sizes recorded for each screen and state.');
  lines.push('- baseline/<screen>__<state>__<width>__<mode>.png is the reference image for that screen, state, width and mode.');
  lines.push('');
  lines.push('## Compare');
  lines.push('');
  lines.push('Run this before you say the work is done:');
  lines.push('');
  lines.push('```');
  lines.push(`rshow compare --against ${doc.out} --map ${doc.mapFile}`);
  lines.push('```');
  lines.push('');
  lines.push('It screenshots your implementation at the same widths and modes, diffs it against baseline/, checks every normative component and reports drift. Exit 0 means it matches, 7 means it does not.');
  return `${lines.join('\n')}\n`;
}

async function capture(page: Page, screen: PageScreen): Promise<Uint8Array> {
  const clip = screen.kind === 'artboard' || screen.kind === 'slide' ? await screenClip(page, screen.id) : null;
  return page.screenshot(clip ?? undefined);
}

export async function runHandoff(target: HandoffTarget, opts: HandoffOptions): Promise<HandoffResult> {
  const say = opts.onProgress ?? ((): void => {});
  const fetchImpl = opts.fetchImpl ?? fetch;
  const art = opts.art.replace(/\/+$/, '');
  const version = target.kind === 'remote' ? target.version : null;
  const slug = target.slug;
  const url = target.kind === 'remote' ? `${art}/${slug}/v${version}/` : '';
  const out = path.resolve(opts.out);

  let closePreview: (() => Promise<void>) | undefined;
  let pageUrl = url;
  if (target.kind === 'remote') {
    await assertPublic(url, art, fetchImpl);
  } else {
    const dir = await requireLocalDir(target);
    // No live reload: the page must not reload while it is being shot.
    const preview = await startPreview({ dir, art, port: 0, reload: false });
    closePreview = preview.close;
    pageUrl = `${preview.url}/`;
  }

  say(`source: ${pageUrl}`);
  const styleTexts = await collectStyleTexts(pageUrl, fetchImpl);
  const tokens = extractTokens(styleTexts);
  say(`tokens: ${tokens.light.length} light, ${tokens.dark.length} dark`);

  await mkdir(path.join(out, 'baseline'), { recursive: true });
  await writeFile(path.join(out, 'tokens.json'), `${JSON.stringify(dtcgTokens(tokens), null, 2)}\n`);

  const screens: ScreenSpec[] = [];
  const baselines: BaselineSpec[] = [];
  let pageKind = 'page';
  let pageSkin = '';
  const chrome = await Chrome.launch({ binary: opts.chrome });
  try {
    const page = await Page.open(chrome);
    const primary = opts.widths[0] as number;
    await page.setViewport(primary, viewportHeight(primary));
    const info = await openHelpers(page, pageUrl);
    pageKind = info.kind;
    pageSkin = info.skin;
    say(`page: ${info.kind}${info.skin === '' ? '' : ` (${info.skin})`}, ${info.screens.length} screen(s)`);

    for (const screen of info.screens) {
      screens.push({
        id: screen.id,
        title: screen.title,
        frame: screen.frame,
        kind: screen.kind,
        width: screen.width,
        height: screen.height,
        states: screen.states,
        flows: [],
        annotations: [],
        focus: [],
        variants: [],
      });
    }

    for (const mode of opts.modes) {
      await setMode(page, mode);
      for (const width of opts.widths) {
        await page.setViewport(width, viewportHeight(width));
        for (const screen of info.screens) {
          const targetScreen = screens.find((item) => item.id === screen.id) as ScreenSpec;
          for (const state of screen.states) {
            const focused = await focusScreen(page, screen.id, state);
            if (!focused) continue;
            if (width === primary) {
              const detail = await collectInfo(page, screen.id);
              if (detail !== null && mode === opts.modes[0]) {
                targetScreen.flows = detail.flows;
                targetScreen.annotations = detail.annotations;
                targetScreen.focus = detail.focus;
              }
              const components = await collectComponents(page, screen.id, tokenArgs(tokens, mode));
              targetScreen.variants.push({ state, mode, components });
            }
            const png = await capture(page, screen);
            const name = baselineName(screen.id, state, width, mode);
            await writeFile(path.join(out, 'baseline', name), png);
            baselines.push({ screen: screen.id, state, width, mode, file: `baseline/${name}` });
          }
        }
      }
    }
  } finally {
    await chrome.close();
    if (closePreview !== undefined) await closePreview();
  }

  const handoffSource: HandoffSource = {
    slug,
    version,
    url: target.kind === 'remote' ? url : `local:${(target as { dir: string }).dir}`,
    kind: pageKind,
    skin: pageSkin,
  };

  const createdAt = new Date().toISOString();
  const spec: HandoffSpec = {
    schema: HANDOFF_SCHEMA,
    generator: 'rshow handoff',
    createdAt,
    source: handoffSource,
    widths: opts.widths,
    modes: opts.modes,
    primaryWidth: opts.widths[0] as number,
    screens,
    baselines,
  };
  await writeFile(path.join(out, 'spec.json'), `${JSON.stringify(spec, null, 2)}\n`);

  const mapFile = MAP_FILE;
  let mapWritten = false;
  const existing = await readMapFile(mapPath());
  if (existing === undefined) {
    await writeMapFile(mapPath(), starterMapOf(spec, tokens));
    mapWritten = true;
  }

  const markdown = handoffMarkdown({
    source: handoffSource,
    out: displayPath(out),
    widths: opts.widths,
    modes: opts.modes,
    screens,
    tokens,
    createdAt,
    mapFile,
  });
  await writeFile(path.join(out, 'HANDOFF.md'), markdown);

  return {
    out,
    url: pageUrl,
    source: handoffSource,
    spec,
    tokens,
    mapFile,
    mapWritten,
    screens: screens.length,
    baselines: baselines.length,
  };
}
