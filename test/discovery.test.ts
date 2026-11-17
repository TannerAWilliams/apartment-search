import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryFacts, matchesDiscovery, LAUNDRY_OPTIONS } from '../src/discovery.ts';
import { normalizeListing, mergeListings, listingPresentation } from '../src/listings.ts';
import { parseFilters, matchListings } from '../src/search.ts';
const base = { id: 'one', address: '12 Grove Street', unit: '2', city: 'Jersey City', state: 'NJ', zip: '07302', rent: 2000, bedrooms: 1, status: 'Active', url: 'https://example.com/unit/2' };
const source = { id: 'test', name: 'Test source', kind: 'feed' };
test('facts retain only explicit structured fields and keep missing details unknown', () => {
  assert.deepEqual(discoveryFacts(undefined), { bathrooms: null, squareFeet: null, petsAllowed: null, laundry: null });
  assert.deepEqual(discoveryFacts({ bathrooms: '1.5', squareFeet: '850', petsAllowed: false, laundry: 'none' }), { bathrooms: 1.5, squareFeet: 850, petsAllowed: false, laundry: 'none' });
  for (const laundry of LAUNDRY_OPTIONS) assert.equal(discoveryFacts({ laundry }).laundry, laundry);
  for (const value of [null, true, '', ' ', 'huge', '-1', -1, 0, Infinity, {}, 100001]) {
    assert.equal(discoveryFacts({ bathrooms: value }).bathrooms, null);
    assert.equal(discoveryFacts({ squareFeet: value }).squareFeet, null);
  }
  assert.equal(discoveryFacts({ bathrooms: 1.7 }).bathrooms, null);
  assert.equal(discoveryFacts({ petsAllowed: 'yes', laundry: 'maybe', description: 'Pets and laundry!' }).petsAllowed, null);
});
test('feature requirements exclude unknowns and apply all conditions', () => {
  const known = { bathrooms: 2, squareFeet: 900, petsAllowed: true, laundry: 'in_unit' };
  assert.equal(matchesDiscovery({}, {}), true);
  assert.equal(matchesDiscovery(known, { minBathrooms: 2, minSquareFeet: 900, petsRequired: true, laundry: 'in_unit' }), true);
  for (const filters of [{ minBathrooms: 1 }, { minSquareFeet: 1 }, { petsRequired: true }, { laundry: 'in_unit' }]) assert.equal(matchesDiscovery({}, filters), false);
  for (const filters of [{ minBathrooms: 3 }, { minSquareFeet: 901 }, { laundry: 'in_building' }]) assert.equal(matchesDiscovery(known, filters), false);
  assert.equal(matchesDiscovery({ petsAllowed: false }, { petsRequired: true }), false);
  assert.equal(matchesDiscovery({ laundry: 'none' }, { laundry: 'none' }), true);
});
test('normalization and actual search preserve facts without inferring them for other units', () => {
  const known = normalizeListing({ ...base, bathrooms: 1.5, squareFeet: 800, petsAllowed: true, laundry: 'in_building' }, source);
  const unknown = normalizeListing({ ...base, id: 'two', unit: '3' }, source);
  assert.equal(known.bathrooms, 1.5);
  const filters = parseFilters({ minBathrooms: '1.5', minSquareFeet: '800', petsRequired: true, laundry: 'in_building' });
  assert.deepEqual(matchListings([known, unknown], filters, null).map(l => l.id), ['test:one']);
  assert.equal(matchListings([known, unknown], parseFilters(), null).length, 2);
});
test('invalid discovery filters reject rather than silently broaden search', () => {
  for (const input of [{ minBathrooms: 'many' }, { minBathrooms: -1 }, { minBathrooms: 21 }, { minSquareFeet: 0 }, { minSquareFeet: '5.5' }, { minSquareFeet: 100001 }, { laundry: 'yes' }, { laundry: true }, { petsRequired: 'true' }]) assert.throws(() => parseFilters(input));
  assert.equal(parseFilters({ laundry: '', petsRequired: false }).petsRequired, false);
  assert.equal(parseFilters({ minBathrooms: '', minSquareFeet: null }).minBathrooms, null);
});

test('independent feature disagreements become unknown and fail required filters', () => {
  const first = normalizeListing({ ...base, petsAllowed: true, bathrooms: 2, squareFeet: 900, laundry: 'in_unit', updatedAt: '2026-01-03' }, source);
  const second = normalizeListing({ ...base, petsAllowed: false, bathrooms: 1, squareFeet: 800, laundry: 'none', updatedAt: '2026-01-02', url: 'https://other.example/unit/2' }, { ...source, id: 'other' });
  const [merged] = mergeListings([first, second]);
  assert.deepEqual(discoveryFacts(merged), { bathrooms: null, squareFeet: null, petsAllowed: null, laundry: null });
  assert.equal(merged.discoveryConflicts.length, 4);
  assert.equal(matchesDiscovery(merged, { petsRequired: true }), false);
  assert.ok(listingPresentation(merged).notices.some(notice => notice.includes('Sources disagree on apartment features')));
  const [again] = mergeListings([merged, first]);
  assert.equal(again.petsAllowed, null);
});
test('unknown preferred facts are not filled from alternates; same-source updates are not conflicts', () => {
  const first = normalizeListing({ ...base, updatedAt: '2026-01-03' }, source);
  const older = normalizeListing({ ...base, petsAllowed: true, updatedAt: '2026-01-02', url: 'https://other.example/unit/2' }, { ...source, id: 'other' });
  const [unknown] = mergeListings([first, older]);
  assert.equal(unknown.petsAllowed, null); assert.deepEqual(unknown.discoveryConflicts, []);
  const [updated] = mergeListings([{ ...first, petsAllowed: false }, { ...first, petsAllowed: true, seenAt: '2026-01-01' }]);
  assert.equal(updated.petsAllowed, false); assert.deepEqual(updated.discoveryConflicts, []);
});

test('overlapping merged source sets cannot silently replace contradictory feature facts', () => {
  const a = normalizeListing({ ...base, petsAllowed: true, updatedAt: '2026-01-03' }, source);
  const b = normalizeListing({ ...base, updatedAt: '2026-01-02', url: 'https://other.example/unit/2' }, { ...source, id: 'other' });
  const [combined] = mergeListings([a, b]);
  assert.equal(combined.petsAllowed, true);
  const [overlap] = mergeListings([combined, { ...b, petsAllowed: false, seenAt: '2026-01-04' }]);
  assert.equal(overlap.petsAllowed, null);
  assert.ok(overlap.discoveryConflicts.includes('petsAllowed'));
  assert.equal(matchesDiscovery(overlap, { petsRequired: true }), false);
});
