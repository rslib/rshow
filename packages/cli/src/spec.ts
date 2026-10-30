import { formatColor, parseColor, parsePx, sameColor } from './color.ts';
import type { Rgba } from './color.ts';
import type { TokenIndex, TokenSets } from './tokens.ts';
import { nearestTokenColor, tokenIndex, tokenValueOf } from './tokens.ts';

export type ComponentSpec = {
  name: string;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  background: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  radius: string;
  normative: boolean;
  text?: string;
  gap?: string;
  padding?: string;
  tokens?: Record<string, string>;
};

export type AnnotationSpec = { text: string; x: number; y: number };

export type FocusSpec = { name: string; role: string; text?: string };

export type FlowSpec = { from: string; to: string };

export type VariantSpec = { state: string; mode: string; components: ComponentSpec[] };

export type ScreenSpec = {
  id: string;
  title: string;
  frame: string;
  kind: string;
  width: number;
  height: number;
  states: string[];
  flows: FlowSpec[];
  annotations: AnnotationSpec[];
  focus: FocusSpec[];
  variants: VariantSpec[];
};

export type BaselineSpec = { screen: string; state: string; width: number; mode: string; file: string };

export type HandoffSource = {
  slug: string;
  version: number | null;
  url: string;
  kind: string;
  skin: string;
};

export type HandoffSpec = {
  schema: number;
  generator: string;
  createdAt: string;
  source: HandoffSource;
  widths: number[];
  modes: string[];
  primaryWidth: number;
  screens: ScreenSpec[];
  baselines: BaselineSpec[];
};

export type Mismatch = {
  screen: string;
  state: string;
  mode: string;
  component: string;
  property: string;
  expected: string;
  actual: string;
};

export type CompareOptions = {
  boxPx?: number;
  boxRatio?: number;
  colorTolerance?: number;
  threshold?: number;
  maxDiffRatio?: number;
};

export const DEFAULT_COMPARE: Required<CompareOptions> = {
  boxPx: 4,
  boxRatio: 0.02,
  colorTolerance: 0.08,
  threshold: 0.1,
  maxDiffRatio: 0.02,
};

export type ImplVariant = { state: string; mode: string; components: ComponentSpec[] };

export function variantOf(screen: ScreenSpec, state: string, mode: string): VariantSpec | undefined {
  return screen.variants.find((variant) => variant.state === state && variant.mode === mode);
}

function normalizedText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function boxDistance(left: ComponentSpec, right: ComponentSpec): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y) + Math.abs(left.w - right.w) + Math.abs(left.h - right.h);
}

export function findComponent(
  wanted: ComponentSpec,
  list: readonly ComponentSpec[],
): ComponentSpec | undefined {
  const byName = list.find((item) => item.name === wanted.name && item.role === wanted.role);
  if (byName !== undefined) return byName;
  const sameName = list.find((item) => item.name === wanted.name);
  if (sameName !== undefined) return sameName;
  const text = normalizedText(wanted.text);
  if (text !== '') {
    const byText = list.find((item) => item.role === wanted.role && normalizedText(item.text) === text);
    if (byText !== undefined) return byText;
  }
  const sameRole = list.filter((item) => item.role === wanted.role);
  if (sameRole.length === 0) return undefined;
  let best = sameRole[0] as ComponentSpec;
  for (const item of sameRole) {
    if (boxDistance(item, wanted) < boxDistance(best, wanted)) best = item;
  }
  return best;
}

function expectedValues(
  spec: ComponentSpec,
  property: 'color' | 'fontSize' | 'fontWeight' | 'radius',
  tokens: TokenSets,
  mode: string,
): string[] {
  const literal = spec[property];
  const values = [literal];
  const token = spec.tokens?.[property];
  if (token !== undefined) {
    const mapped = tokenValueOf(tokens, token, mode);
    if (mapped !== undefined) values.push(mapped);
  }
  return values;
}

function sameValue(property: 'color' | 'fontSize' | 'fontWeight' | 'radius', expected: string, actual: string): boolean {
  if (property === 'color') {
    const left = parseColor(expected);
    const right = parseColor(actual);
    if (left !== undefined && right !== undefined) return sameColor(left, right);
    return normalizedText(expected) === normalizedText(actual);
  }
  if (property === 'fontWeight') return normalizedText(expected) === normalizedText(actual);
  const left = parsePx(expected);
  const right = parsePx(actual);
  if (left !== undefined && right !== undefined) return Math.abs(left - right) < 0.01;
  return normalizedText(expected) === normalizedText(actual);
}

export function compareComponents(
  screen: ScreenSpec,
  variant: VariantSpec,
  impl: readonly ComponentSpec[],
  tokens: TokenSets,
  opts: CompareOptions = {},
): Mismatch[] {
  const settings = { ...DEFAULT_COMPARE, ...opts };
  const out: Mismatch[] = [];
  const add = (property: string, expected: string, actual: string, component: string): void => {
    out.push({ screen: screen.id, state: variant.state, mode: variant.mode, component, property, expected, actual });
  };

  for (const component of variant.components) {
    if (!component.normative) continue;
    const found = findComponent(component, impl);
    if (found === undefined) {
      add('missing', `${component.role} ${component.name}`, 'not found', component.name);
      continue;
    }
    const tolerance = Math.max(settings.boxPx, settings.boxRatio * Math.max(component.w, component.h));
    const off = [
      Math.abs(found.x - component.x),
      Math.abs(found.y - component.y),
      Math.abs(found.w - component.w),
      Math.abs(found.h - component.h),
    ];
    if (off.some((value) => value > tolerance)) {
      const shape = (item: ComponentSpec): string => `${item.x},${item.y} ${item.w}x${item.h}`;
      add('box', shape(component), shape(found), component.name);
    }
    for (const property of ['color', 'fontSize', 'fontWeight', 'radius'] as const) {
      const expected = expectedValues(component, property, tokens, variant.mode);
      if (expected.some((value) => sameValue(property, value, found[property]))) continue;
      const label = component.tokens?.[property] === undefined ? expected[0] : `${expected[0]} (${component.tokens[property]})`;
      add(property, label, found[property], component.name);
    }
  }
  return out;
}

function colorDrift(
  screen: ScreenSpec,
  variant: VariantSpec,
  impl: readonly ComponentSpec[],
  index: TokenIndex,
  opts: CompareOptions,
): Mismatch[] {
  const settings = { ...DEFAULT_COMPARE, ...opts };
  const out: Mismatch[] = [];
  const seen = new Set<string>();
  const check = (component: ComponentSpec, property: 'color' | 'background', raw: string): void => {
    const value = parseColor(raw);
    if (value === undefined) return;
    if (value.a === 0) return;
    const exact = index.colors.find((entry) => sameColor(entry.rgba, value));
    if (exact !== undefined) return;
    const near = nearestTokenColor(index, value, settings.colorTolerance);
    if (near === undefined) return;
    const mark = `${component.name}\n${property}\n${raw}`;
    if (seen.has(mark)) return;
    seen.add(mark);
    out.push({
      screen: screen.id,
      state: variant.state,
      mode: variant.mode,
      component: component.name,
      property: `raw-${property}`,
      expected: `${near.name} ${near.value}`,
      actual: formatColor(value as Rgba),
    });
  };

  const known = new Set(variant.components.map((item) => item.name));
  for (const component of impl) {
    if (!component.normative && !known.has(component.name)) continue;
    check(component, 'color', component.color);
    check(component, 'background', component.background);
  }
  return out;
}

export function compareStructure(
  spec: HandoffSpec,
  collected: { screen: string; variants: ImplVariant[] }[],
  tokens: TokenSets,
  opts: CompareOptions = {},
): Mismatch[] {
  const index = tokenIndex(tokens);
  const out: Mismatch[] = [];
  for (const screen of spec.screens) {
    const impl = collected.find((item) => item.screen === screen.id) ?? collected[0];
    if (impl === undefined) continue;
    for (const variant of screen.variants) {
      const actual = impl.variants.find(
        (item) => item.state === variant.state && item.mode === variant.mode,
      );
      if (actual === undefined) continue;
      out.push(...compareComponents(screen, variant, actual.components, tokens, opts));
      out.push(...colorDrift(screen, variant, actual.components, index, opts));
    }
  }
  return out;
}
