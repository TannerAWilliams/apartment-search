import { test } from 'bun:test';
import assert from 'node:assert/strict';
import * as v from 'valibot';
import { RefreshCheckSchema } from '../server/routes/inputs.ts';

test('public refresh allows fetching but rejects anonymous imports and extra properties', () => {
  assert.equal(v.is(RefreshCheckSchema, { check: 'now' }), true);
  assert.equal(v.is(RefreshCheckSchema, { check: 'now', source: 'streeteasy-live', sessionStart: false }), true);
  for (const body of [null, [], {}, { check: 'now', imports: {} }, { check: 'now', fallback: true }, { check: 'now', source: {} }, { check: 'now', sessionStart: 'true' }]) {
    assert.equal(v.is(RefreshCheckSchema, body), false);
  }
});
