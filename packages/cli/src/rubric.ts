import type { TokenColor, PaletteReport } from './native.ts';
import type { ComponentSpec, ScreenSpec } from './spec.ts';

export type RubricShot = {
  label: string;
  baseline: string;
  capture: string;
  diff: string;
  expected?: readonly TokenColor[];
  palette?: PaletteReport;
};

export type RubricInput = { screen: ScreenSpec; shots: readonly RubricShot[] };

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function quoted(text: string | undefined): string {
  return text === undefined || text.trim() === '' ? '' : JSON.stringify(text.replace(/\s+/g, ' ').trim());
}

function readingOrder(components: readonly ComponentSpec[]): ComponentSpec[] {
  return [...components].sort((left, right) => (left.y !== right.y ? left.y - right.y : left.x - right.x));
}

export function describeRelation(
  component: ComponentSpec,
  previous: ComponentSpec | undefined,
): { size: string; place: string } {
  const shape = `${component.w}x${component.h}`;
  if (previous === undefined) {
    return {
      size: `${shape}, the first element in reading order`,
      place: `top left corner at ${component.x},${component.y}`,
    };
  }
  const same = component.w === previous.w && component.h === previous.h;
  const size = same ? `${shape}, the same size as ${previous.name}` : `${shape} while ${previous.name} is ${previous.w}x${previous.h}`;
  const gapX = component.x - previous.x;
  const gapY = component.y - previous.y;
  const overlap = Math.min(component.y + component.h, previous.y + previous.h) - Math.max(component.y, previous.y);
  const sameRow = overlap > Math.min(component.h, previous.h) / 2;
  let place: string;
  if (sameRow) {
    place = gapX >= 0 ? `${gapX}px right of ${previous.name} on the same row` : `${-gapX}px left of ${previous.name} on the same row`;
  } else {
    place = gapY >= 0 ? `${gapY}px below ${previous.name}` : `${-gapY}px above ${previous.name}`;
  }
  return { size, place };
}

function componentLines(components: readonly ComponentSpec[]): string[] {
  const ordered = readingOrder(components.filter((component) => component.normative));
  const lines: string[] = [];
  ordered.forEach((component, index) => {
    const { size, place } = describeRelation(component, ordered[index - 1]);
    lines.push(`- [ ] **${component.name}** (${component.role}) at ${component.x},${component.y}`);
    const text = quoted(component.text);
    if (text !== '') lines.push(`  - [ ] the text reads ${text}`);
    const tokens = Object.entries(component.tokens ?? {})
      .map(([key, name]) => `${key} ${name}`)
      .join(', ');
    lines.push(
      `  - [ ] the colour is ${component.color} on ${component.background}${tokens === '' ? '' : `, tokens ${tokens}`}`,
    );
    const type = [component.fontFamily, component.fontSize, component.fontWeight]
      .filter((value) => value !== '' && value !== undefined)
      .join(' ');
    if (type !== '' || component.radius !== '') {
      lines.push(`  - [ ] the type is ${type === '' ? 'unchanged' : type} and the radius is ${component.radius}`);
    }
    lines.push(`  - [ ] the size is ${size}`);
    lines.push(`  - [ ] the place is ${place}`);
  });
  return lines;
}

function paletteLines(shot: RubricShot): string[] {
  const lines: string[] = [];
  for (const token of shot.expected ?? []) {
    const missing = shot.palette?.missing.find((finding) => finding.token === token.name);
    lines.push(
      `- [ ] \`${token.name}\` ${findingColor(token)} is in the capture${missing === undefined ? '' : ` (the capture reads ${missing.actual})`}`,
    );
  }
  const missing = shot.palette?.missing ?? [];
  const drift = shot.palette?.drift ?? [];
  if (missing.length > 0) {
    for (const finding of missing) {
      lines.push(`- [ ] \`${finding.token}\` ${finding.expected} is missing, nearest is ${finding.actual} at delta E ${finding.distance}`);
    }
  }
  for (const finding of drift) {
    lines.push(
      `- [ ] \`${finding.token}\` ${finding.expected} drifted to ${finding.actual} over ${Math.round(finding.area * 1000) / 10}% of the capture`,
    );
  }
  if (missing.length === 0 && drift.length === 0) lines.push('- [ ] no token colour is missing and no large area drifts');
  return lines;
}

function findingColor(token: TokenColor): string {
  return `rgb(${token.color.r}, ${token.color.g}, ${token.color.b})`;
}

export function rubricMarkdown(input: RubricInput): string {
  const { screen, shots } = input;
  const lines: string[] = [];
  lines.push(`# Rubric: ${screen.title === '' ? screen.id : screen.title}`);
  lines.push('');
  lines.push(
    'A native screen has no DOM to read, so the pixel diff and the palette check only narrow the review.',
  );
  lines.push('Open the baseline and the capture side by side, tick a line when it holds, and write the reason on a line that does not.');
  lines.push('');
  lines.push(`Screen id ${screen.id}, frame ${screen.frame === '' ? 'none' : screen.frame}, ${screen.width}x${screen.height}.`);
  lines.push('');
  lines.push('## Shots');
  lines.push('');
  lines.push('| shot | baseline | capture | diff |');
  lines.push('| --- | --- | --- | --- |');
  if (shots.length === 0) lines.push('| no capture yet | - | - | - |');
  for (const shot of shots) {
    lines.push(`| ${cell(shot.label)} | ${cell(shot.baseline)} | ${cell(shot.capture)} | ${cell(shot.diff)} |`);
  }
  lines.push('');
  lines.push('## States');
  lines.push('');
  if (screen.states.length === 0) lines.push('- [ ] the screen has no state of its own, so the default one is enough');
  for (const state of screen.states) lines.push(`- [ ] \`${state}\`: the capture shows this state, not a neighbouring one`);
  lines.push('');

  const variants = screen.variants.filter((variant) => variant.components.some((component) => component.normative));
  lines.push('## Components');
  lines.push('');
  lines.push('A normative component must match its text, colour, size and place.');
  lines.push('Everything else in the design is a placeholder, so its copy, data and images are free.');
  lines.push('');
  if (variants.length === 0) {
    lines.push('The handoff marks no component normative on this screen, so nothing here is fixed.');
    lines.push('');
  }
  for (const variant of variants) {
    lines.push(`### ${variant.state} / ${variant.mode}`);
    lines.push('');
    lines.push(...componentLines(variant.components));
    lines.push('');
  }

  lines.push('## Annotations');
  lines.push('');
  if (screen.annotations.length === 0) lines.push('- [ ] the design carries no annotation on this screen');
  for (const note of screen.annotations) {
    lines.push(`- [ ] the note at ${note.x},${note.y} holds: ${note.text}`);
  }
  lines.push('');

  lines.push('## Palette');
  lines.push('');
  lines.push('A token colour that is absent, or a large area that is near a token but not on it, is drift.');
  lines.push('');
  for (const shot of shots) {
    lines.push(`### ${shot.label}`);
    lines.push('');
    if (shot.palette === undefined) {
      lines.push('- [ ] the capture was read before this list was written');
    } else {
      lines.push(...paletteLines(shot));
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}
