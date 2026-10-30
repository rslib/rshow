import { MAX_DESCRIPTION_LENGTH } from 'rshow-shared';
import { boolValue, emailList, parseCommandArgs, stringValue } from '../args.ts';
import type { Ctx } from '../context.ts';
import { UsageError } from '../exit.ts';
import { validateSlug } from '../slug.ts';
import {
  PROJECT_CREATE_USAGE,
  PROJECT_DELETE_USAGE,
  PROJECT_LIST_USAGE,
  PROJECT_SHARE_USAGE,
  PROJECT_SHOW_USAGE,
  PROJECT_USAGE,
  usageLine,
} from '../usage.ts';

type MemberChange = { email: string; role: 'viewer' | 'editor' };

function descriptionOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (text.length > MAX_DESCRIPTION_LENGTH) {
    throw new UsageError(`description too long: ${text.length} (at most ${MAX_DESCRIPTION_LENGTH})`);
  }
  return text;
}

function servedOf(artifact: any): string {
  return artifact?.served === null || artifact?.served === undefined ? '-' : `v${artifact.served}`;
}

async function create(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    { title: { type: 'string' }, description: { type: 'string' } },
    1,
    1,
    PROJECT_CREATE_USAGE,
  );
  const slug = validateSlug(args.positionals[0] as string);
  const title = stringValue(args, 'title');
  const description = descriptionOf(stringValue(args, 'description'));

  const api = await ctx.api();
  const project = await api.createProject({ slug, title, description });

  ctx.out.data(project);
  ctx.out.line(`slug: ${project.slug}`);
  ctx.out.line(`title: ${project.title}`);
  if (typeof project.description === 'string' && project.description !== '') {
    ctx.out.line(`description: ${project.description}`);
  }
  ctx.out.line(`url: ${project.url}`);
}

async function list(argv: string[], ctx: Ctx): Promise<void> {
  parseCommandArgs(argv, {}, 0, 0, PROJECT_LIST_USAGE);
  const api = await ctx.api();
  const reply = await api.projects();
  const projects = Array.isArray(reply?.projects) ? reply.projects : [];

  ctx.out.data(reply);
  if (projects.length === 0) {
    ctx.out.line('no projects');
    return;
  }
  for (const project of projects) {
    ctx.out.line(`${project.slug} ${project.role} ${project.artifacts} ${project.title}`);
  }
}

async function show(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, {}, 1, 1, PROJECT_SHOW_USAGE);
  const slug = validateSlug(args.positionals[0] as string);
  const api = await ctx.api();
  const reply = await api.project(slug);

  const members = Array.isArray(reply?.members) ? reply.members : [];
  const artifacts = Array.isArray(reply?.artifacts) ? reply.artifacts : [];
  ctx.out.data(reply);
  ctx.out.line(`slug: ${reply.slug}`);
  ctx.out.line(`title: ${reply.title}`);
  ctx.out.line(`description: ${reply.description === '' || reply.description === undefined ? '-' : reply.description}`);
  ctx.out.line(`owner: ${reply.owner}`);
  ctx.out.line(`role: ${reply.role}`);
  ctx.out.line(`url: ${reply.url}`);
  ctx.out.line(`updated: ${reply.updated_at}`);
  ctx.out.line(`members: ${members.length}`);
  for (const member of members) {
    ctx.out.line(`member ${member.email} ${member.role}`);
  }
  ctx.out.line(`artifacts: ${artifacts.length}`);
  for (const artifact of artifacts) {
    ctx.out.line(`artifact ${artifact.slug} ${artifact.mode} ${servedOf(artifact)} ${artifact.title}`);
  }
}

async function share(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(
    argv,
    {
      add: { type: 'string', multiple: true },
      editor: { type: 'string', multiple: true },
      remove: { type: 'string', multiple: true },
    },
    1,
    1,
    PROJECT_SHARE_USAGE,
  );
  const slug = validateSlug(args.positionals[0] as string);
  const changes: MemberChange[] = [
    ...emailList(args, 'add').map((email) => ({ email, role: 'viewer' as const })),
    ...emailList(args, 'editor').map((email) => ({ email, role: 'editor' as const })),
  ];
  const removals = emailList(args, 'remove');
  if (changes.length === 0 && removals.length === 0) {
    throw new UsageError(`nothing to change (try: ${usageLine(PROJECT_SHARE_USAGE)})`);
  }

  const api = await ctx.api();
  const members: any[] = [];
  for (const change of changes) {
    members.push(await api.putMember(slug, change.email, change.role));
  }
  for (const email of removals) {
    await api.deleteMember(slug, email);
  }

  ctx.out.data({ members, removed: removals });
  for (const member of members) ctx.out.line(`member ${member.email} ${member.role}`);
  for (const email of removals) ctx.out.line(`removed ${email}`);
}

async function remove(argv: string[], ctx: Ctx): Promise<void> {
  const args = parseCommandArgs(argv, { yes: { type: 'boolean' } }, 1, 1, PROJECT_DELETE_USAGE);
  const slug = validateSlug(args.positionals[0] as string);
  if (!boolValue(args, 'yes')) {
    throw new UsageError(`project delete needs --yes (try: ${usageLine(PROJECT_DELETE_USAGE)})`);
  }

  const api = await ctx.api();
  await api.deleteProject(slug);
  ctx.out.data(null);
  ctx.out.line(`deleted: ${slug}`);
}

export async function run(argv: string[], ctx: Ctx): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === undefined) {
    throw new UsageError(`expected a project command (try: ${usageLine(PROJECT_USAGE)})`);
  }
  if (sub === 'create') return create(rest, ctx);
  if (sub === 'list') return list(rest, ctx);
  if (sub === 'show') return show(rest, ctx);
  if (sub === 'share') return share(rest, ctx);
  if (sub === 'delete') return remove(rest, ctx);
  throw new UsageError(`unknown project command: ${sub} (try: ${usageLine(PROJECT_USAGE)})`);
}
