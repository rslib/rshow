import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MAP_FILE, mapPath, readMapFile, sortMap, starterMap, writeMapFile } from '../src/map.ts';
import { starterMapOf } from '../src/handoff.ts';
import type { HandoffSpec } from '../src/spec.ts';
import { extractTokens } from '../src/tokens.ts';

const SPEC: HandoffSpec = {
  schema: 1,
  generator: 'rshow handoff',
  createdAt: '2026-01-01T00:00:00.000Z',
  source: { slug: 'gallery', version: 2, url: 'https://art.example.com/gallery/v2/', kind: 'mockup', skin: 'wire' },
  widths: [1440],
  modes: ['light'],
  primaryWidth: 1440,
  baselines: [],
  screens: [
    {
      id: 'gallery',
      title: 'Gallery',
      frame: 'browser',
      kind: 'artboard',
      width: 1440,
      height: 900,
      states: ['default'],
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
            },
            {
              name: 'button',
              role: 'button',
              x: 0,
              y: 0,
              w: 10,
              h: 10,
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
    },
    {
      id: 'share',
      title: 'Share',
      frame: 'custom',
      kind: 'artboard',
      width: 1440,
      height: 900,
      states: ['default'],
      flows: [],
      annotations: [],
      focus: [],
      variants: [],
    },
  ],
};

test('the starter map has every logical component, token and screen, with empty targets', () => {
  const tokens = extractTokens([':root{--accent:#0f62fe;--bg:#ffffff}:root[data-mode=dark]{--bg:#161616}']);
  const map = starterMapOf(SPEC, tokens);
  assert.deepEqual(Object.keys(map.components), ['PrimaryButton']);
  assert.deepEqual(map.components.PrimaryButton, '');
  assert.deepEqual(Object.keys(map.tokens), ['--accent', '--bg']);
  assert.deepEqual(map.tokens['--accent'], '');
  assert.deepEqual(Object.keys(map.screens), ['gallery', 'share']);
  assert.deepEqual(map.screens.share, '');
});

test('starterMap sorts and keeps empty strings', () => {
  const map = starterMap(['wf-input', 'wf-button'], ['--fg', '--accent'], ['b', 'a']);
  assert.deepEqual(map, {
    components: { 'wf-button': '', 'wf-input': '' },
    tokens: { '--accent': '', '--fg': '' },
    screens: { a: '', b: '' },
  });
  assert.deepEqual(sortMap(map), map);
});

test('the map file round trips and is written where asked', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rshow-map-'));
  const file = path.join(dir, MAP_FILE);
  assert.equal(await readMapFile(file), undefined);
  await writeMapFile(file, {
    components: { 'wf-button': 'src/ui/Button.tsx' },
    tokens: { '--accent': 'theme.colors.accent' },
    screens: { gallery: 'http://localhost:5173/', cli: 'tmux:mysession:0.1' },
  });
  const back = await readMapFile(file);
  assert.deepEqual(back, {
    components: { 'wf-button': 'src/ui/Button.tsx' },
    tokens: { '--accent': 'theme.colors.accent' },
    screens: { cli: 'tmux:mysession:0.1', gallery: 'http://localhost:5173/' },
  });
  const text = await readFile(file, 'utf8');
  assert.match(text, /"wf-button": "src\/ui\/Button\.tsx"/);
  assert.ok(text.endsWith('\n'));
  assert.equal(mapPath(dir), file);
});

test('a map file keeps a native screenshot and a window target as plain strings', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rshow-map-'));
  const file = path.join(dir, MAP_FILE);
  await writeMapFile(file, {
    components: {},
    tokens: {},
    screens: { desktop: 'file:shots/desktop.png', settings: 'window:My App', gallery: 'http://localhost:5173/' },
  });
  const back = await readMapFile(file);
  assert.deepEqual(back?.screens, {
    desktop: 'file:shots/desktop.png',
    gallery: 'http://localhost:5173/',
    settings: 'window:My App',
  });
});

test('a broken map file is a usage error', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rshow-map-'));
  const broken = path.join(dir, 'broken.json');
  await writeMapFile(broken, sortMap(starterMap([], [], [])));
  const { writeFile } = await import('node:fs/promises');
  await writeFile(broken, '{ nope');
  await assert.rejects(() => readMapFile(broken), /invalid JSON in/);

  const wrongShape = path.join(dir, 'wrong.json');
  await writeFile(wrongShape, JSON.stringify({ components: { a: 1 } }));
  await assert.rejects(() => readMapFile(wrongShape), /components\.a must be a string/);

  const notObject = path.join(dir, 'list.json');
  await writeFile(notObject, '[]');
  await assert.rejects(() => readMapFile(notObject), /must hold a JSON object/);
});
