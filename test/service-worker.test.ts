import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { alertFromPush } from '../web/alert-message.ts';

const push = (value: unknown) => ({ json: () => value });

test('a pushed alert shows its title, text and in-app link', () => {
  assert.deepEqual(alertFromPush(push({ title: 'Brooklyn 1BR: 2 new apartments', body: 'A\nB', tag: 'rule-1', url: '/#results' })),
    { title: 'Brooklyn 1BR: 2 new apartments', body: 'A\nB', tag: 'rule-1', url: '/#results' });
});

test('a missing, malformed or outside link falls back to safe defaults', () => {
  const defaults = { title: 'Apartment Search', body: 'A saved search has new matches.', tag: undefined, url: '/' };
  assert.deepEqual(alertFromPush(null), defaults);
  assert.deepEqual(alertFromPush({ json: () => { throw new SyntaxError('not JSON'); } }), defaults);
  assert.deepEqual(alertFromPush(push('just text')), defaults);
  assert.deepEqual(alertFromPush(push({ title: 7, url: 'https://evil.example/' })), defaults);
});
