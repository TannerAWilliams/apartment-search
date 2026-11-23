import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { isPublicRefresh } from '../server/public-access.ts';

test('public refresh allows fetching but rejects anonymous imports and extra properties', () => {
  assert.equal(isPublicRefresh({ check: 'now' }), true);
  assert.equal(isPublicRefresh({ check: 'now', source: 'streeteasy-live', sessionStart: false }), true);
  for (const body of [null, [], {}, { check: 'now', imports: {} }, { check: 'now', fallback: true }, { check: 'now', source: {} }, { check: 'now', sessionStart: 'true' }]) {
    assert.equal(isPublicRefresh(body), false);
  }
});
