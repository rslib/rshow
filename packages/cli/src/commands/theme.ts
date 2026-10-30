import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { THEME_NAME_PATTERN, THEME_PREFIX } from 'rshow-shared';
import { boolValue, parseCommandArgs, stringValue } from '../args.ts';
import { runBuild } from '../build.ts';
import { countsLine, enforceCheck, reportCheck } from '../check.ts';
import type { CheckResult } from '../check.ts';
import type { Ctx } from '../context.ts';
import { AuthError, CheckError, EXIT, UsageError } from '../exit.ts';
import type { ExitCode } from '../exit.ts';
import { publishTarget, reportPublish, reportUnchanged } from '../publish.ts';
import { closeOnSignals, startPreview } from '../serve.ts';
import { validateSlug } from '../slug.ts';
import { readThemeMeta, requireThemeDir, themeSlug, themeUrl } from '../theme.ts';
import {
  baseRoleValues,
  buildPreset,
  builtinThemeDir,
  checkPreset,
  ROLE_TOKENS,
  readThemeJson,
} from '../themes.ts';
import {
  THEME_CHECK_USAGE,
  THEME_LIST_USAGE,
  THEME_NEW_USAGE,
  THEME_PREVIEW_USAGE,
  THEME_PUBLISH_USAGE,
  THEME_USAGE,
  usageLine,
} from '../usage.ts';
import { warn } from '../warn.ts';
import { portOf } from './preview.ts';

async function presetCheck(dir: string): Promise<CheckResult> {
  const findings = await checkPreset(dir);
  const info = await stat(path.join(dir, 'theme.json')).catch(() => undefined);
  const errors = findings.filter((finding) => finding.severity === 'error').length;
  return { findings, errors, warnings: findings.length - errors, files: 1, bytes: info?.size ?? 0 };
}

async function enforcePresetCheck(out: Ctx['out'], dir: string): Promise<void> {
  const result = await presetCheck(dir);
  if (result.findings.length > 0) reportCheck(out, result);
  if (result.errors > 0) throw new CheckError(`check failed: ${countsLine(result)}`);
}

async function publish(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    { label: { type: 'string' }, build: { type: 'string' }, 'no-check': { type: 'boolean' }, force: { type: 'boolean' } },
    1,
    1,
    THEME_PUBLISH_USAGE,
  );
  const dir = await requireThemeDir(args.positionals[0] as string);
  const meta = await readThemeMeta(dir);
  const slug = validateSlug(themeSlug(meta.name));

  const doc = await readThemeJson(dir);
  const baseName = typeof doc.json.extends === 'string' ? doc.json.extends.trim() : '';

  const config = await ctx.config(dir);
  const build = stringValue(args, 'build') ?? config.build;
  if (build !== undefined) await runBuild(dir, build);

  const preset = baseName !== '';
  if (!boolValue(args, 'no-check')) {
    if (preset) await enforcePresetCheck(ctx.out, dir);
    else {
      if (config.art === undefined) warn('no art host configured; skipping theme checks');
      await enforceCheck(ctx.out, dir, { art: config.art, offline: config.art === undefined });
    }
  }

  let target = dir;
  let temp: string | undefined;
  if (preset) {
    temp = await mkdtemp(path.join(tmpdir(), 'rshow-theme-'));
    await buildPreset(dir, temp);
    target = temp;
  }

  try {
    const api = await ctx.api(target);
    const result = await publishTarget(api, target, {
      slug,
      title: meta.name,
      label: stringValue(args, 'label'),
      requireIndex: false,
      force: boolValue(args, 'force'),
    });

    if (result.unchanged) {
      reportUnchanged(ctx.out, result);
      return;
    }

    let artifact = result.artifact;
    if (artifact.mode !== 'public') {
      try {
        artifact = await api.patchArtifact(slug, { mode: 'public' });
      } catch (err) {
        if (err instanceof AuthError && err.status === 403) {
          throw new AuthError(
            `a full-scope token is needed to set ${slug} public (v${result.version.n} is published but stays private)`,
            403,
          );
        }
        throw err;
      }
    }

    const url = themeUrl(meta.name, result.version.n);
    ctx.out.data({
      artifact,
      version: result.version,
      blobs: {
        files: result.hashes,
        uploaded: result.uploaded,
        skipped: result.skipped,
        missing: result.missing,
      },
      theme: url,
    });
    reportPublish(ctx.out, { ...result, artifact });
    ctx.out.line(url);
  } finally {
    if (temp !== undefined) await rm(temp, { recursive: true, force: true });
  }
}

async function list(argv: string[], ctx: Ctx): Promise<void> {
  parseCommandArgs(argv, {}, 0, 0, THEME_LIST_USAGE);
  const api = await ctx.api();
  const reply = await api.artifacts();
  const artifacts = (Array.isArray(reply?.artifacts) ? reply.artifacts : [])
    .filter(
      (artifact: any): boolean => typeof artifact?.slug === 'string' && artifact.slug.startsWith('theme-'),
    )
    .sort((a: any, b: any): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));

  ctx.out.data({ artifacts });
  if (artifacts.length === 0) {
    ctx.out.line('no themes');
    return;
  }
  for (const artifact of artifacts) {
    const name = String(artifact.slug).slice('theme-'.length);
    if (artifact.served === null || artifact.served === undefined) {
      ctx.out.line(`${artifact.slug} -`);
      continue;
    }
    ctx.out.line(`${artifact.slug} v${artifact.served} ${themeUrl(name, artifact.served)}`);
  }
}

async function create(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(
    argv,
    { dir: { type: 'string' }, from: { type: 'string' } },
    1,
    1,
    THEME_NEW_USAGE,
  );
  const name = (args.positionals[0] as string).trim();
  if (!THEME_NAME_PATTERN.test(name)) {
    throw new UsageError(`invalid theme name: ${name} (use lowercase letters, digits and hyphens, at most 40)`);
  }
  if (name.startsWith(THEME_PREFIX)) {
    throw new UsageError(`invalid theme name: ${name} (the slug adds ${THEME_PREFIX})`);
  }

  const from = stringValue(args, 'from') ?? 'default';
  const baseDir = await builtinThemeDir(from);
  if (baseDir === undefined) throw new UsageError(`no built-in theme: ${from}`);

  const parent = path.resolve(stringValue(args, 'dir') ?? '.');
  const target = path.join(parent, name);
  const exists = await stat(target).catch(() => undefined);
  if (exists !== undefined) throw new UsageError(`${target} already exists`);

  const values = await baseRoleValues(baseDir, ROLE_TOKENS);
  const doc = { name, extends: from, tokens: {}, modeTokens: values };
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'theme.json'), `${JSON.stringify(doc, null, 2)}\n`);

  ctx.out.data({ path: target, name, extends: from });
  ctx.out.line(target);
  ctx.out.line(`next: rshow theme check ${target}`);
  return EXIT.ok;
}

async function check(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(argv, {}, 1, 1, THEME_CHECK_USAGE);
  const dir = await requireThemeDir(args.positionals[0] as string);
  const result = await presetCheck(dir);
  ctx.out.data({
    errors: result.errors,
    warnings: result.warnings,
    findings: result.findings,
  });
  reportCheck(ctx.out, result);
  return result.errors > 0 ? EXIT.check : EXIT.ok;
}

async function preview(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const args = parseCommandArgs(
    argv,
    {
      port: { type: 'string' },
      offline: { type: 'boolean' },
      'no-reload': { type: 'boolean' },
    },
    1,
    1,
    THEME_PREVIEW_USAGE,
  );
  const dir = await requireThemeDir(args.positionals[0] as string);
  const port = portOf(stringValue(args, 'port'));
  const offline = boolValue(args, 'offline');

  const config = await ctx.config(dir);
  if (config.art === undefined && !offline) warn('no art host configured; skipping the /_themes proxy');

  // The served root is the theme built from <dir>, so an edit to the preset
  // rebuilds it and reloads the page.
  const server = await startPreview({
    dir,
    theme: dir,
    root: 'theme',
    art: offline ? '' : (config.art ?? ''),
    offline,
    port,
    reload: !boolValue(args, 'no-reload'),
  });
  closeOnSignals(server);

  ctx.out.raw(`${server.url}/index.html`);
  return EXIT.ok;
}

export async function run(argv: string[], ctx: Ctx): Promise<ExitCode> {
  const [sub, ...rest] = argv;
  if (sub === undefined) throw new UsageError(`expected a theme command (try: ${usageLine(THEME_USAGE)})`);
  if (sub === 'new') return create(rest, ctx);
  if (sub === 'check') return check(rest, ctx);
  if (sub === 'preview') return preview(rest, ctx);
  if (sub === 'publish') {
    await publish(rest, ctx);
    return EXIT.ok;
  }
  if (sub === 'list') {
    await list(rest, ctx);
    return EXIT.ok;
  }
  throw new UsageError(`unknown theme command: ${sub} (try: ${usageLine(THEME_USAGE)})`);
}
