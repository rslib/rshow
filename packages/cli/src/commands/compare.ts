import process from 'node:process';
import { boolValue, parseCommandArgs, stringValue } from '../args.ts';
import { runCompare } from '../compare.ts';
import { displayPath } from '../handoff.ts';
import type { Ctx } from '../context.ts';
import { EXIT, UsageError } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import { publishTarget } from '../publish.ts';
import { deriveSlug } from '../slug.ts';
import { COMPARE_USAGE, usageLine } from '../usage.ts';

export const DEFAULT_THRESHOLD = 0.1;
export const DEFAULT_MAX_DIFF_RATIO = 0.02;
export const DEFAULT_NATIVE_MAX_DIFF_RATIO = 0.15;

export function ratioValue(text: string | undefined, name: string, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new UsageError(`--${name} must be between 0 and 1, got: ${text}`);
  }
  return value;
}

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(
    argv,
    {
      against: { type: 'string' },
      map: { type: 'string' },
      threshold: { type: 'string' },
      'max-diff-ratio': { type: 'string' },
      'native-max-diff-ratio': { type: 'string' },
      'tui-colors': { type: 'boolean' },
      publish: { type: 'boolean' },
    },
    0,
    0,
    COMPARE_USAGE,
  );
  const against = stringValue(args, 'against');
  if (against === undefined) throw new UsageError(`--against <handoff-dir> is needed (try: ${usageLine(COMPARE_USAGE)})`);
  const mapFlag = stringValue(args, 'map');

  const result = await runCompare({
    against,
    map: mapFlag,
    threshold: ratioValue(stringValue(args, 'threshold'), 'threshold', DEFAULT_THRESHOLD),
    maxDiffRatio: ratioValue(stringValue(args, 'max-diff-ratio'), 'max-diff-ratio', DEFAULT_MAX_DIFF_RATIO),
    nativeMaxDiffRatio: ratioValue(
      stringValue(args, 'native-max-diff-ratio'),
      'native-max-diff-ratio',
      DEFAULT_NATIVE_MAX_DIFF_RATIO,
    ),
    tuiColors: boolValue(args, 'tui-colors'),
    chrome: process.env.CHROME,
    onProgress: (line) => ctx.out.line(line),
  });

  const failing = result.results.filter((item) => !item.pass);
  ctx.out.data({
    pass: result.pass,
    checked: result.checked,
    skipped: result.skipped,
    report: result.reportDir,
    results: result.results,
  });
  for (const item of result.results) {
    const where = item.width === 0 ? item.mode : `${item.mode} ${item.width}`;
    const ratio = item.diffRatio === undefined ? '' : ` diff ${item.diffRatio.toFixed(4)}`;
    const note = item.note === undefined ? '' : ` (${item.note})`;
    const status = item.status ?? (item.pass ? 'pass' : 'fail');
    ctx.out.line(`${status} ${item.screen} ${item.state} ${where}${ratio}${note}`);
    for (const mismatch of item.mismatches.slice(0, 20)) {
      ctx.out.line(
        `  mismatch ${item.screen} ${item.state} ${mismatch.component}: ${mismatch.property} expected ${mismatch.expected} actual ${mismatch.actual}`,
      );
    }
  }
  const display = displayPath(result.reportDir);
  ctx.out.line(`report: ${display}/index.html`);
  ctx.out.line(
    result.pass
      ? `compare: ok (${result.checked} checked, ${result.skipped} without a url)`
      : `compare: ${failing.length} failing of ${result.checked} checked (${result.skipped} without a url)`,
  );
  const review = result.results.filter((item) => item.status === 'review');
  if (review.length > 0) {
    ctx.out.line(
      `review: ${review.length} native screen(s) pass the hard checks and need a rubric pass in ${display}`,
    );
  }

  if (boolValue(args, 'publish')) {
    const slug = deriveSlug(`${result.spec.source.slug}-compare`);
    const api = await ctx.api();
    const published = await publishTarget(api, result.reportDir, {
      slug,
      title: `${result.spec.source.slug} compare`,
    });
    ctx.out.line(`published: ${published.version.url}`);
    ctx.out.line(`live: ${published.artifact.url}`);
  }

  return result.pass ? EXIT.ok : EXIT.compare;
}
