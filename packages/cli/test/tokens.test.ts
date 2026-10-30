import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cssFilesOfHtml,
  dtcgTokens,
  extractTokens,
  flattenDtcg,
  groupOf,
  inferType,
  inlineStylesOfHtml,
  nearestTokenColor,
  tokenIndex,
  tokenValueOf,
} from '../src/tokens.ts';

const TOKENS_CSS = `/* the light values sit on :root */
:root {
  --bg: #ffffff;
  --fg: #161616;
  --accent: #0f62fe;
  --layer-01: #f4f4f4;
  --space-02: 8px;
  --text-16: 16px;
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-weight-600: 600;
  --line-height-140: 1.4;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-mode="light"]) {
    --bg: #161616;
    --fg: #f4f4f4;
  }
}

:root[data-mode="dark"] {
  --bg: #161616;
  --fg: #f4f4f4;
  --accent: #78a9ff;
}

.wf-button { --not-a-token: 1px; color: #123456; }
`;

test('tokens come from :root only, dark values split out', () => {
  const sets = extractTokens([TOKENS_CSS]);
  assert.deepEqual(
    sets.light.map((token) => token.name),
    [
      '--bg',
      '--fg',
      '--accent',
      '--layer-01',
      '--space-02',
      '--text-16',
      '--font-sans',
      '--font-weight-600',
      '--line-height-140',
    ],
  );
  assert.deepEqual(sets.dark, [
    { name: '--bg', value: '#161616' },
    { name: '--fg', value: '#f4f4f4' },
    { name: '--accent', value: '#78a9ff' },
  ]);
});

test('a later definition wins and the media query is dark, not light', () => {
  const sets = extractTokens([':root{--bg:#fff}:root{--bg:#eee}', ':root[data-mode=dark]{--bg:#111}']);
  assert.deepEqual(sets.light, [{ name: '--bg', value: '#eee' }]);
  assert.deepEqual(sets.dark, [{ name: '--bg', value: '#111' }]);
});

test('tokens are grouped by prefix and typed', () => {
  const dtcg = dtcgTokens(extractTokens([TOKENS_CSS]));
  assert.equal(typeof dtcg.$description, 'string');
  assert.deepEqual(dtcg.base, {
    accent: { $value: '#0f62fe', $type: 'color' },
    bg: { $value: '#ffffff', $type: 'color' },
    fg: { $value: '#161616', $type: 'color' },
  });
  assert.deepEqual(dtcg.layer, { '01': { $value: '#f4f4f4', $type: 'color' } });
  assert.deepEqual(dtcg.space, { '02': { $value: '8px', $type: 'dimension' } });
  assert.deepEqual(dtcg.text, { '16': { $value: '16px', $type: 'dimension' } });
  assert.deepEqual(dtcg.font, {
    sans: { $value: '"IBM Plex Sans", system-ui, sans-serif', $type: 'fontFamily' },
    'weight-600': { $value: '600', $type: 'fontWeight' },
  });
  assert.deepEqual(dtcg.line, { 'height-140': { $value: '1.4', $type: 'number' } });
  assert.deepEqual(dtcg.dark, {
    base: {
      accent: { $value: '#78a9ff', $type: 'color' },
      bg: { $value: '#161616', $type: 'color' },
      fg: { $value: '#f4f4f4', $type: 'color' },
    },
  });
});

test('dtcg round trips back to the same names and values', () => {
  const sets = extractTokens([TOKENS_CSS]);
  const sort = (list: { name: string }[]) => [...list].sort((a, b) => (a.name < b.name ? -1 : 1));
  const back = flattenDtcg(dtcgTokens(sets));
  assert.deepEqual(sort(back.light), sort(sets.light));
  assert.deepEqual(sort(back.dark), sort(sets.dark));
});

test('group and type helpers', () => {
  assert.deepEqual(groupOf('--accent'), { group: 'base', key: 'accent' });
  assert.deepEqual(groupOf('--space-02'), { group: 'space', key: '02' });
  assert.deepEqual(groupOf('--font-weight-600'), { group: 'font', key: 'weight-600' });
  assert.equal(inferType('--accent', '#0f62fe'), 'color');
  assert.equal(inferType('--space-02', '8px'), 'dimension');
  assert.equal(inferType('--font-sans', 'A, sans-serif'), 'fontFamily');
  assert.equal(inferType('--font-weight-600', '600'), 'fontWeight');
  assert.equal(inferType('--line-height-140', '1.4'), 'number');
});

test('the token index matches colours and sizes', () => {
  const sets = extractTokens([TOKENS_CSS]);
  const index = tokenIndex(sets);
  assert.equal(nearestTokenColor(index, { r: 15, g: 98, b: 254, a: 255 }, 0.01)?.name, '--accent');
  assert.equal(nearestTokenColor(index, { r: 16, g: 98, b: 254, a: 255 }, 0.001), undefined);
  assert.equal(
    nearestTokenColor(index, { r: 16, g: 98, b: 254, a: 255 }, 0.05)?.name,
    '--accent',
  );
  assert.equal(tokenValueOf(sets, '--bg', 'light'), '#ffffff');
  assert.equal(tokenValueOf(sets, '--bg', 'dark'), '#161616');
});

test('linked and inline css are found in html', () => {
  const html = `<link rel="stylesheet" href="tokens.css"><link rel=stylesheet href='skin.css'>
    <link rel="icon" href="favicon.ico"><style>:root{--a:1px}</style>`;
  assert.deepEqual(cssFilesOfHtml(html), ['tokens.css', 'skin.css']);
  assert.deepEqual(inlineStylesOfHtml(html), [':root{--a:1px}']);
});
