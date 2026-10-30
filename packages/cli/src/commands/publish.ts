import { stat } from 'node:fs/promises';
import path from 'node:path';
import { boolValue, parseCommandArgs, stringList, stringValue } from '../args.ts';
import { runBuild } from '../build.ts';
import { enforceCheck } from '../check.ts';
import { localConfigPath, readConfigFile } from '../config.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { publishTarget, reportPublish, reportUnchanged } from '../publish.ts';
import type { PublishOptions } from '../publish.ts';
import { deriveSlug, validateSlug } from '../slug.ts';
import { normalizeTags } from '../tags.ts';
import { PUBLISH_USAGE } from '../usage.ts';
import { warn } from '../warn.ts';

async function directoryOf(input: string): Promise<string | undefined> {
  const dir = path.resolve(input);
  const info = await stat(dir).catch(() => undefined);
  return info !== undefined && info.isDirectory() ? dir : undefined;
}

// <dir>/<out> is published when a build ran or rshow.json names an out folder.
async function targetOf(
  input: string,
  dir: string | undefined,
  built: boolean,
  out: string,
): Promise<string> {
  if (dir === undefined) return path.resolve(input);
  if (built) return path.resolve(dir, out);
  const local = await readConfigFile(localConfigPath(dir));
  return local.out === undefined ? dir : path.resolve(dir, out);
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    {
      slug: { type: 'string' },
      title: { type: 'string' },
      label: { type: 'string' },
      project: { type: 'string' },
      tag: { type: 'string', multiple: true },
      build: { type: 'string' },
      'no-check': { type: 'boolean' },
      force: { type: 'boolean' },
    },
    1,
    1,
    PUBLISH_USAGE,
  );
  const input = args.positionals[0] as string;
  const dir = await directoryOf(input);
  const config = await ctx.config(dir);

  const build = stringValue(args, 'build') ?? config.build;
  if (build !== undefined) {
    if (dir === undefined) throw new UsageError(`build needs a folder, got: ${input}`);
    await runBuild(dir, build);
  }

  const target = await targetOf(input, dir, build !== undefined, config.out);
  const slug = validateSlug(
    stringValue(args, 'slug') ?? config.slug ?? deriveSlug(path.basename(path.resolve(input))),
  );
  const title = stringValue(args, 'title') ?? config.title;
  const label = stringValue(args, 'label');
  const projectInput = stringValue(args, 'project') ?? config.project;
  const project = projectInput === undefined ? undefined : validateSlug(projectInput);
  const flagTags = stringList(args, 'tag');
  const tags = flagTags.length > 0 ? normalizeTags(flagTags) : config.tags;

  const opts: PublishOptions = { slug, title, label, project, tags, force: boolValue(args, 'force') };
  if (!boolValue(args, 'no-check')) {
    opts.beforeUpload = () => {
      if (config.art === undefined) warn('no art host configured; skipping theme checks');
      return enforceCheck(ctx.out, target, { art: config.art, offline: config.art === undefined });
    };
  }

  const api = await ctx.api(dir);
  const result = await publishTarget(api, target, opts);

  if (result.unchanged) {
    reportUnchanged(ctx.out, result);
    return;
  }

  ctx.out.data({
    artifact: result.artifact,
    version: result.version,
    blobs: {
      files: result.hashes,
      uploaded: result.uploaded,
      skipped: result.skipped,
      missing: result.missing,
    },
  });
  reportPublish(ctx.out, result);
}
