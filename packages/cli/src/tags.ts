import { MAX_TAGS, TAG_PATTERN } from 'rshow-shared';
import { UsageError } from './exit.ts';

export { MAX_TAGS, TAG_PATTERN } from 'rshow-shared';

function unique(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of list) {
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

function capped(tags: string[]): string[] {
  if (tags.length > MAX_TAGS) {
    throw new UsageError(`too many tags: ${tags.length} (at most ${MAX_TAGS})`);
  }
  return tags;
}

export function validateTag(raw: string): string {
  const tag = raw.trim().toLowerCase();
  if (!TAG_PATTERN.test(tag)) throw new UsageError(`invalid tag: ${raw}`);
  return tag;
}

export function normalizeTags(list: readonly string[]): string[] {
  return capped(unique(list.map(validateTag)));
}

export function tagsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLowerCase());
}

export function withTags(
  current: readonly string[],
  add: readonly string[],
  remove: readonly string[],
): string[] {
  const next = unique(tagsOf(current)).filter((tag) => !remove.includes(tag));
  for (const tag of add) {
    if (!next.includes(tag)) next.push(tag);
  }
  return capped(next);
}

export function sameTags(left: unknown, right: readonly string[]): boolean {
  const a = unique(tagsOf(left)).sort();
  const b = unique(right.map((tag) => tag.toLowerCase())).sort();
  return a.length === b.length && a.every((tag, index) => tag === b[index]);
}
