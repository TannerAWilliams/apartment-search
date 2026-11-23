import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { discoveryFacts, matchesDiscovery, LAUNDRY_OPTIONS } from '../src/discovery.ts';
import { normalizeListing, mergeListings, listingPresentation } from '../src/listings.ts';
import { parseFilters, matchListings } from '../src/search.ts';
const base = {
  id: 'one',
  address: '12 Grove Street',
  unit: '2',
  city: 'Jersey City',
  state: 'NJ',
  zip: '07302',
  rent: 2000,
  bedrooms: 1,
  status: 'Active',
  url: 'https://example.com/unit/2',
};
const source = { id: 'test', name: 'Test source', kind: 'feed' };
test('facts retain only explicit structured fields and keep missing details unknown', () => {
  expect(discoveryFacts(undefined)).toStrictEqual({ bathrooms: null, squareFeet: null, petsAllowed: null, laundry: null });
  expect(discoveryFacts({ bathrooms: '1.5', squareFeet: '850', petsAllowed: false, laundry: 'none' })).toStrictEqual({
    bathrooms: 1.5,
    squareFeet: 850,
    petsAllowed: false,
    laundry: 'none',
  });
  for (const laundry of LAUNDRY_OPTIONS) expect(discoveryFacts({ laundry }).laundry).toBe(laundry);
  for (const value of [null, true, '', ' ', 'huge', '-1', -1, 0, Infinity, {}, 100001]) {
    expect(discoveryFacts({ bathrooms: value }).bathrooms).toBeNull();
    expect(discoveryFacts({ squareFeet: value }).squareFeet).toBeNull();
  }
  expect(discoveryFacts({ bathrooms: 1.7 }).bathrooms).toBeNull();
  const prose = { petsAllowed: 'yes', laundry: 'maybe', description: 'Pets and laundry!' };
  expect(discoveryFacts(prose).petsAllowed).toBeNull();
});
test('feature requirements exclude unknowns and apply all conditions', () => {
  const known = { bathrooms: 2, squareFeet: 900, petsAllowed: true, laundry: 'in_unit' };
  expect(matchesDiscovery({}, {})).toBe(true);
  expect(matchesDiscovery(known, { minBathrooms: 2, minSquareFeet: 900, petsRequired: true, laundry: 'in_unit' })).toBe(true);
  for (const filters of [{ minBathrooms: 1 }, { minSquareFeet: 1 }, { petsRequired: true }, { laundry: 'in_unit' }])
    expect(matchesDiscovery({}, filters)).toBe(false);
  for (const filters of [{ minBathrooms: 3 }, { minSquareFeet: 901 }, { laundry: 'in_building' }])
    expect(matchesDiscovery(known, filters)).toBe(false);
  expect(matchesDiscovery({ petsAllowed: false }, { petsRequired: true })).toBe(false);
  expect(matchesDiscovery({ laundry: 'none' }, { laundry: 'none' })).toBe(true);
});
test('normalization and actual search preserve facts without inferring them for other units', () => {
  const known = required(normalizeListing({ ...base, bathrooms: 1.5, squareFeet: 800, petsAllowed: true, laundry: 'in_building' }, source));
  const unknown = required(normalizeListing({ ...base, id: 'two', unit: '3' }, source));
  expect(required(known).bathrooms).toBe(1.5);
  const filters = parseFilters({ minBathrooms: '1.5', minSquareFeet: '800', petsRequired: true, laundry: 'in_building' });
  expect(matchListings([known, unknown], filters, null).map((l) => l.id)).toStrictEqual(['test:one']);
  expect(matchListings([known, unknown], parseFilters(), null).length).toBe(2);
});
test('invalid discovery filters reject rather than silently broaden search', () => {
  for (const input of [
    { minBathrooms: 'many' },
    { minBathrooms: -1 },
    { minBathrooms: 21 },
    { minSquareFeet: 0 },
    { minSquareFeet: '5.5' },
    { minSquareFeet: 100001 },
    { laundry: 'yes' },
    { laundry: true },
    { petsRequired: 'true' },
  ])
    expect(() => parseFilters(input)).toThrow();
  expect(parseFilters({ laundry: '', petsRequired: false }).petsRequired).toBe(false);
  expect(parseFilters({ minBathrooms: '', minSquareFeet: null }).minBathrooms).toBeNull();
});

test('independent feature disagreements become unknown and fail required filters', () => {
  const first = required(
    normalizeListing({ ...base, petsAllowed: true, bathrooms: 2, squareFeet: 900, laundry: 'in_unit', updatedAt: '2026-01-03' }, source),
  );
  const second = required(
    normalizeListing(
      {
        ...base,
        petsAllowed: false,
        bathrooms: 1,
        squareFeet: 800,
        laundry: 'none',
        updatedAt: '2026-01-02',
        url: 'https://other.example/unit/2',
      },
      { ...source, id: 'other' },
    ),
  );
  const [merged] = mergeListings([first, second]);
  expect(discoveryFacts(merged)).toStrictEqual({ bathrooms: null, squareFeet: null, petsAllowed: null, laundry: null });
  expect(required(merged.discoveryConflicts).length).toBe(4);
  expect(matchesDiscovery(merged, { petsRequired: true })).toBe(false);
  expect(listingPresentation(merged).notices.some((notice) => notice.includes('Sources disagree on apartment features'))).toBeTruthy();
  const [again] = mergeListings([merged, first]);
  expect(again.petsAllowed).toBeNull();
});
test('unknown preferred facts are not filled from alternates; same-source updates are not conflicts', () => {
  const first = required(normalizeListing({ ...base, updatedAt: '2026-01-03' }, source));
  const older = required(
    normalizeListing(
      { ...base, petsAllowed: true, updatedAt: '2026-01-02', url: 'https://other.example/unit/2' },
      { ...source, id: 'other' },
    ),
  );
  const [unknown] = mergeListings([first, older]);
  expect(unknown.petsAllowed).toBeNull();
  expect(unknown.discoveryConflicts).toStrictEqual([]);
  const [updated] = mergeListings([
    { ...first, petsAllowed: false },
    { ...first, petsAllowed: true, seenAt: '2026-01-01' },
  ]);
  expect(updated.petsAllowed).toBe(false);
  expect(updated.discoveryConflicts).toStrictEqual([]);
});

test('overlapping merged source sets cannot silently replace contradictory feature facts', () => {
  const a = required(normalizeListing({ ...base, petsAllowed: true, updatedAt: '2026-01-03' }, source));
  const b = required(
    normalizeListing({ ...base, updatedAt: '2026-01-02', url: 'https://other.example/unit/2' }, { ...source, id: 'other' }),
  );
  const [combined] = mergeListings([a, b]);
  expect(combined.petsAllowed).toBe(true);
  const [overlap] = mergeListings([combined, { ...b, petsAllowed: false, seenAt: '2026-01-04' }]);
  expect(overlap.petsAllowed).toBeNull();
  expect(required(overlap.discoveryConflicts).includes('petsAllowed')).toBeTruthy();
  expect(matchesDiscovery(overlap, { petsRequired: true })).toBe(false);
});
