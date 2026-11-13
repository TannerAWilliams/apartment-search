import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeListings, normalizeListing } from '../src/listings.ts';
import { distanceMiles, isPoint } from '../src/search.ts';

const row = {
  id: 'unit-2', address: '12 Grove Street', unit: '2', city: 'Jersey City', state: 'NJ', zip: '07302',
  latitude: 40.72, longitude: -74.04, bedrooms: 1, rent: 1800, status: 'active',
  updatedAt: '2026-11-12T12:00:00Z',
};
const listing = (changes = {}) => normalizeListing({ ...row, ...changes }, { id: 'partner', name: 'Partner', kind: 'feed' });

test('newer malformed coordinates cannot discard a valid location from another observation', () => {
  for (const point of [
    { latitude: 91, longitude: -74.04 }, { latitude: -91, longitude: -74.04 },
    { latitude: 40.72, longitude: 181 }, { latitude: 40.72, longitude: -181 },
    { latitude: NaN, longitude: -74.04 }, { latitude: 40.72, longitude: Infinity },
  ]) {
    const old = listing();
    const fresh = listing({ ...point, rent: 1900, updatedAt: '2026-11-13T12:00:00Z' });
    for (const observations of [[old, fresh], [fresh, old]]) {
      const [merged] = mergeListings(observations);
      assert.equal(merged.rent, 1900);
      assert.equal(merged.seenAt, '2026-11-13T12:00:00Z');
      assert.equal(merged.latitude, row.latitude);
      assert.equal(merged.longitude, row.longitude);
      assert.equal(distanceMiles(merged, row), 0);
    }
  }
});

test('valid newer coordinate pairs, including zero and world bounds, stay preferred', () => {
  for (const point of [{ latitude: 0, longitude: 0 }, { latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }]) {
    const [merged] = mergeListings([listing(), listing({ ...point, updatedAt: '2026-11-13T12:00:00Z' })]);
    assert.equal(isPoint(merged), true);
    assert.equal(merged.latitude, point.latitude);
    assert.equal(merged.longitude, point.longitude);
  }
});

test('preferFirst preserves listing precedence but falls back to a valid location pair', () => {
  const [merged] = mergeListings([listing({ latitude: 100, rent: 1700 }), listing()], { preferFirst: true });
  assert.equal(merged.rent, 1700);
  assert.equal(merged.latitude, row.latitude);
  assert.equal(merged.longitude, row.longitude);
});

test('two invalid observations do not invent a map or commute location', () => {
  const [merged] = mergeListings([listing({ latitude: 100 }), listing({ longitude: 200 })]);
  assert.equal(isPoint(merged), false);
  assert.equal(distanceMiles(merged, row), null);
});
