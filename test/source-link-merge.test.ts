import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSourceLinks, orderedListingLinks } from '../src/listings.ts';

const url = 'https://streeteasy.com/rental/123';
const fresh = { id: 'streeteasy', name: 'StreetEasy', kind: 'feed', url };

test('fresh source evidence survives same-URL cached or historical duplicates in either order', () => {
  for (const kind of ['cached', 'snapshot', 'saved', 'verified']) {
    const older = { ...fresh, kind };
    assert.deepEqual(mergeSourceLinks([older], [fresh]), [fresh]);
    assert.deepEqual(mergeSourceLinks([fresh], [older]), [fresh]);
  }
});

test('promoting one URL never promotes another cached URL or mutates inputs', () => {
  const cached = Object.freeze({ ...fresh, kind: 'cached' });
  const other = Object.freeze({ ...cached, id: 'other', url: 'https://example.test/other' });
  const before = Object.freeze([cached, other]);
  const result = mergeSourceLinks(before, [fresh]);
  assert.deepEqual(result, [fresh, other]);
  assert.equal(cached.kind, 'cached');
  assert.equal(result.filter(({ kind }) => kind === 'feed').length, 1);
  assert.equal(orderedListingLinks(result)[0], fresh);
});

test('deduplication remains idempotent and keeps precedence when freshness is equal', () => {
  const second = { ...fresh, name: 'Alternate name' };
  assert.deepEqual(mergeSourceLinks([fresh], [second]), [fresh]);
  const cached = { ...fresh, kind: 'cached' };
  assert.deepEqual(mergeSourceLinks([cached], [cached]), [cached]);
  assert.deepEqual(mergeSourceLinks([cached], []), [cached]);
});
