import assert from 'node:assert/strict';
import test from 'node:test';
import { compareComponents, compareStructure, findComponent } from '../src/spec.ts';
import type { ComponentSpec, HandoffSpec, ScreenSpec, VariantSpec } from '../src/spec.ts';
import { extractTokens } from '../src/tokens.ts';

const TOKENS = extractTokens([
  ':root{--bg:#ffffff;--fg:#161616;--accent:#0f62fe;--radius-2:2px;--text-16:16px}',
  ':root[data-mode=dark]{--bg:#161616;--fg:#f4f4f4}',
]);

function component(overrides: Partial<ComponentSpec> = {}): ComponentSpec {
  return {
    name: 'wf-button',
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
    ...overrides,
  };
}

function variant(components: ComponentSpec[], overrides: Partial<VariantSpec> = {}): VariantSpec {
  return { state: 'default', mode: 'light', components, ...overrides };
}

function screen(overrides: Partial<ScreenSpec> = {}): ScreenSpec {
  return {
    id: 'gallery',
    title: 'Gallery',
    frame: 'browser',
    kind: 'artboard',
    width: 648,
    height: 400,
    states: ['default'],
    flows: [],
    annotations: [],
    focus: [],
    variants: [],
    ...overrides,
  };
}

function specWith(screens: ScreenSpec[]): HandoffSpec {
  return {
    schema: 1,
    generator: 'rshow handoff',
    createdAt: '2026-01-01T00:00:00.000Z',
    source: { slug: 'gallery', version: 3, url: 'https://art.example.com/gallery/v3/', kind: 'mockup', skin: 'wire' },
    widths: [1440],
    modes: ['light'],
    primaryWidth: 1440,
    screens,
    baselines: [],
  };
}

test('a matching component has no mismatch', () => {
  const one = variant([component({ tokens: { color: '--bg', background: '--accent', radius: '--radius-2' } })]);
  assert.deepEqual(compareComponents(screen(), one, [component()], TOKENS), []);
});

test('a placeholder component is not checked', () => {
  const one = variant([component({ normative: false, x: 999 })]);
  assert.deepEqual(compareComponents(screen(), one, [], TOKENS), []);
});

test('a missing normative component is reported', () => {
  const one = variant([component({ name: 'PrimaryButton', role: 'button' })]);
  const mismatches = compareComponents(screen(), one, [], TOKENS);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0]?.property, 'missing');
  assert.equal(mismatches[0]?.component, 'PrimaryButton');
});

test('a box is allowed 4px or 2 percent, and reported past it', () => {
  const one = variant([component()]);
  assert.deepEqual(compareComponents(screen(), one, [component({ x: 27, y: 43, w: 122, h: 34 })], TOKENS), []);
  const far = compareComponents(screen(), one, [component({ x: 40, y: 40, w: 120, h: 32 })], TOKENS);
  assert.equal(far.length, 1);
  assert.equal(far[0]?.property, 'box');
  assert.equal(far[0]?.expected, '24,40 120x32');
  assert.equal(far[0]?.actual, '40,40 120x32');
});

test('colour, font size, weight and radius are compared, literal or token', () => {
  const one = variant([
    component({ tokens: { color: '--bg', fontSize: '--text-16', radius: '--radius-2' } }),
  ]);
  const moved = compareComponents(
    screen(),
    one,
    [component({ color: 'rgb(1, 1, 1)', fontSize: '18px', fontWeight: '400', radius: '4px' })],
    TOKENS,
  );
  const properties = moved.map((item) => item.property).sort();
  assert.deepEqual(properties, ['color', 'fontSize', 'fontWeight', 'radius']);
  const radius = moved.find((item) => item.property === 'radius');
  assert.equal(radius?.expected, '2px (--radius-2)');

  const dark = compareComponents(
    screen(),
    variant([component({ tokens: { color: '--fg' } })], { mode: 'dark' }),
    [component({ color: 'rgb(244, 244, 244)' })],
    TOKENS,
  );
  assert.deepEqual(dark, []);
});

test('a component is matched by data-component, then by role and text', () => {
  assert.equal(findComponent(component({ name: 'PrimaryButton' }), [component({ name: 'PrimaryButton', x: 500 })])?.x, 500);
  const byText = findComponent(component({ name: 'PrimaryButton', text: 'Open' }), [
    component({ name: 'other', text: 'Open', x: 7 }),
    component({ name: 'other2', text: 'Close', x: 9 }),
  ]);
  assert.equal(byText?.x, 7);
});

test('raw colours near a token are reported as drift', () => {
  const spec = specWith([
    screen({
      variants: [
        variant([component({ tokens: { background: '--accent' } })]),
      ],
    }),
  ]);
  const impl = [
    {
      screen: 'gallery',
      variants: [variant([component({ background: 'rgb(16, 98, 254)' })])],
    },
  ];
  const mismatches = compareStructure(spec, impl, TOKENS);
  const drift = mismatches.find((item) => item.property === 'raw-background');
  assert.ok(drift !== undefined, JSON.stringify(mismatches));
  assert.equal(drift.component, 'wf-button');
  assert.equal(drift.expected, '--accent rgb(15, 98, 254)');
  assert.equal(drift.actual, 'rgb(16, 98, 254)');

  const exact = compareStructure(
    spec,
    [{ screen: 'gallery', variants: [variant([component({ background: 'rgb(15, 98, 254)' })])] }],
    TOKENS,
  );
  assert.deepEqual(exact, []);
});

test('compareStructure skips a screen that was not collected', () => {
  const spec = specWith([screen({ variants: [variant([component()])] })]);
  assert.deepEqual(compareStructure(spec, [], TOKENS), []);
});
