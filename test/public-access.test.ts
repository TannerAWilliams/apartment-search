import { expect, test } from 'bun:test';
import * as v from 'valibot';
import { RefreshCheckSchema } from '../server/routes/inputs.ts';

test('public refresh allows fetching but rejects anonymous imports and extra properties', () => {
  expect(v.is(RefreshCheckSchema, { check: 'now' })).toBe(true);
  expect(v.is(RefreshCheckSchema, { check: 'now', source: 'streeteasy-live', sessionStart: false })).toBe(true);
  for (const body of [
    null,
    [],
    {},
    { check: 'now', imports: {} },
    { check: 'now', fallback: true },
    { check: 'now', source: {} },
    { check: 'now', sessionStart: 'true' },
  ]) {
    expect(v.is(RefreshCheckSchema, body)).toBe(false);
  }
});
