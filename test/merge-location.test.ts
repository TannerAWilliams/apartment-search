import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { mergeListings, normalizeListing } from '../src/listings.ts';
import { distanceMiles, isPoint } from '../src/search.ts';

const row = {
  id: 'unit-2', address: '12 Grove Street', unit: '2', city: 'Jersey City', state: 'NJ', zip: '07302',
  latitude: 40.72, longitude: -74.04, bedrooms: 1, rent: 1800, status: 'active',
  updatedAt: '2026-11-12T12:00:00Z',
};
const listing = (changes = {}) => required(normalizeListing({ ...row, ...changes }, { id: 'partner', name: 'Partner', kind: 'feed' }));

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
      expect(merged.rent).toBe(1900);
      expect(merged.seenAt).toBe('2026-11-13T12:00:00Z');
      expect(merged.latitude).toBe(row.latitude);
      expect(merged.longitude).toBe(row.longitude);
      expect(distanceMiles(merged, row)).toBe(0);
    }
  }
});

test('valid newer coordinate pairs, including zero and world bounds, stay preferred', () => {
  for (const point of [{ latitude: 0, longitude: 0 }, { latitude: 90, longitude: 180 }, { latitude: -90, longitude: -180 }]) {
    const [merged] = mergeListings([listing(), listing({ ...point, updatedAt: '2026-11-13T12:00:00Z' })]);
    expect(isPoint(merged)).toBe(true);
    expect(merged.latitude).toBe(point.latitude);
    expect(merged.longitude).toBe(point.longitude);
  }
});

test('preferFirst preserves listing precedence but falls back to a valid location pair', () => {
  const [merged] = mergeListings([listing({ latitude: 100, rent: 1700 }), listing()], { preferFirst: true });
  expect(merged.rent).toBe(1700);
  expect(merged.latitude).toBe(row.latitude);
  expect(merged.longitude).toBe(row.longitude);
});

test('two invalid observations do not invent a map or commute location', () => {
  const [merged] = mergeListings([listing({ latitude: 100 }), listing({ longitude: 200 })]);
  expect(isPoint(merged)).toBe(false);
  expect(distanceMiles(merged, row)).toBeNull();
});
