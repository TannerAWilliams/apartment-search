import { expect, test } from 'bun:test';
import { alertFromPush } from '../web/alert-message.ts';

const push = (value: unknown) => ({ json: () => value });

test('a pushed alert shows its title, text and in-app link', () => {
  expect(alertFromPush(push({ title: 'Brooklyn 1BR: 2 new apartments', body: 'A\nB', tag: 'rule-1', url: '/#results' }))).toStrictEqual({ title: 'Brooklyn 1BR: 2 new apartments', body: 'A\nB', tag: 'rule-1', url: '/#results' });
});

test('a missing, malformed or outside link falls back to safe defaults', () => {
  const defaults = { title: 'Apartment Search', body: 'A saved search has new matches.', tag: undefined, url: '/' };
  expect(alertFromPush(null)).toStrictEqual(defaults);
  expect(alertFromPush({ json: () => { throw new SyntaxError('not JSON'); } })).toStrictEqual(defaults);
  expect(alertFromPush(push('just text'))).toStrictEqual(defaults);
  expect(alertFromPush(push({ title: 7, url: 'https://evil.example/' }))).toStrictEqual(defaults);
});
