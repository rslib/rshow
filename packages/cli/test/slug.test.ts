import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveSlug, validateSlug } from '../src/slug.ts';

test('deriveSlug lowercases and collapses non slug runs', () => {
  assert.equal(deriveSlug('My Site'), 'my-site');
  assert.equal(deriveSlug('Hello__World!!'), 'hello-world');
  assert.equal(deriveSlug('a.b.c'), 'a-b-c');
  assert.equal(deriveSlug('---Leading and trailing---'), 'leading-and-trailing');
  assert.equal(deriveSlug('Site/'), 'site');
  assert.equal(deriveSlug('already-fine-9'), 'already-fine-9');
});

test('validateSlug accepts and rejects', () => {
  assert.equal(validateSlug('a-b9'), 'a-b9');
  assert.throws(() => validateSlug('Bad Slug'), /invalid slug/);
  assert.throws(() => validateSlug('-lead'), /invalid slug/);
  assert.throws(() => validateSlug(''), /invalid slug/);
  assert.throws(() => validateSlug('a'.repeat(64)), /invalid slug/);
});
