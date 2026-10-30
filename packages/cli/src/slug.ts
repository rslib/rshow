import { SLUG_PATTERN } from 'rshow-shared';
import { UsageError } from './exit.ts';

export function deriveSlug(name: string): string {
  return name
    .replace(/\/+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

export function validateSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) throw new UsageError(`invalid slug: ${slug}`);
  return slug;
}
