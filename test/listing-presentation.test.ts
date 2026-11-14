import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingPresentation, mergeListings } from '../src/listings.ts';

test('unknown or malformed bedrooms are never presented as studio', () => {
  for (const bedrooms of [null, undefined, '', '0', NaN, -1, 1.5]) {
    assert.equal(listingPresentation({ bedrooms, rent: 1800 }).bedsLabel, 'Beds unknown');
  }
  assert.equal(listingPresentation({ bedrooms: 0, rent: 1800 }).bedsLabel, 'Studio');
  assert.equal(listingPresentation({ bedrooms: 1, rent: 1800 }).bedsLabel, '1 bedroom');
});
test('missing and unusual prices receive distinct honest messages', () => {
  assert.equal(listingPresentation({ bedrooms: 1, rent: null }).priceKnown, false);
  assert.match(listingPresentation({ bedrooms: 1, rent: 300 }).notices.join(' '), /Unusually low price/);
  assert.equal(listingPresentation({ bedrooms: 1, rent: 1800 }).notices.length, 0);
});
test('merging conflicting source facts retains evidence rather than guessing', () => {
  const row = { id: 'a', address: '12 Grove St', unit: '1', state: 'NJ', zip: '07302', bedrooms: 0, rent: 1800, seenAt: '2026-11-13', sources: [] };
  const [merged] = mergeListings([row, { ...row, id: 'b', bedrooms: 1, rent: 2000 }]);
  assert.equal(merged.bedrooms, 0);
  assert.equal(merged.detailsConflict, true);
  assert.match(listingPresentation(merged).notices.join(' '), /Sources report different/);
});
