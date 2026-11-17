import { test } from 'bun:test';
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
  const row = { id: 'a', address: '12 Grove St', unit: '1', city: 'Jersey City', state: 'NJ', zip: '07302', bedrooms: 0, rent: 1800,
    seenAt: '2026-11-13', kind: 'feed', sources: [{ id: 'alpha', name: 'Alpha', kind: 'feed' }] };
  const [merged] = mergeListings([row, { ...row, id: 'b', bedrooms: 1, rent: 2000,
    sources: [{ id: 'beta', name: 'Beta', kind: 'feed' }] }]);
  assert.equal(merged.bedrooms, 0);
  assert.equal(merged.detailsConflict, true);
  assert.match(listingPresentation(merged).notices.join(' '), /Sources report different/);
});

test('a newer observation from the same source is an update, not a source conflict', () => {
  const source = { id: 'alpha', name: 'Alpha', url: 'https://alpha.example/listing/1' };
  const row = { id: 'old', address: '12 Grove St', unit: '1', city: 'Jersey City', state: 'NJ', zip: '07302', bedrooms: 0, rent: 1800,
    seenAt: '2026-11-12', kind: 'cached', sources: [{ ...source, kind: 'cached' }] };
  const [merged] = mergeListings([row, { ...row, id: 'fresh', bedrooms: 1, rent: 2000,
    seenAt: '2026-11-13', kind: 'feed', sources: [{ ...source, kind: 'feed' }] }]);
  assert.equal(merged.rent, 2000);
  assert.equal(merged.bedrooms, 1);
  assert.equal(merged.detailsConflict, false);
  assert.doesNotMatch(listingPresentation(merged).notices.join(' '), /Sources report different/);
});

test('a secondary saved link does not turn a primary source update into a conflict', () => {
  const alpha = { id: 'alpha', name: 'Alpha', url: 'https://alpha.example/listing/1', kind: 'saved' };
  const beta = { id: 'beta', name: 'Beta', url: 'https://beta.example/listing/1', kind: 'saved' };
  const row = { id: 'saved', address: '12 Grove St', unit: '1', city: 'Jersey City', state: 'NJ', zip: '07302', bedrooms: 1, rent: 1800,
    seenAt: '2026-11-12', kind: 'saved', sources: [alpha, beta] };
  const [merged] = mergeListings([row, { ...row, id: 'fresh', rent: 2000, seenAt: '2026-11-13', kind: 'feed',
    sources: [{ ...alpha, kind: 'feed' }] }]);
  assert.equal(merged.rent, 2000);
  assert.equal(merged.detailsConflict, false);
  assert.doesNotMatch(listingPresentation(merged).notices.join(' '), /Sources report different/);
});
