import { malformed } from './test-values.ts';
import { test, expect } from 'bun:test';
import {
  addSavedSearch,
  readSavedSearches,
  serializeSavedSearches,
  presetFilters,
  compareWholeSnapshot,
  parseWholeSnapshot,
} from '../src/saved-searches.ts';
const point = (rent = 2000, day = 1, key = 'unit1', includesFees = false) => ({
  key,
  label: 'Apartment',
  sourceId: 'feed',
  checkedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  rent,
  includesFees,
});
const snapshot = (observations = [point()]) => ({
  scope: 'all-cached-search-matches',
  total: observations.length,
  eligible: observations.length,
  observations,
  checkedAt: '2026-02-01T00:00:00Z',
  notices: ['Partial source coverage.'],
});
test('presets pick validated filters, ignore secrets and pagination, round-trip and isolate mutable baseline', () => {
  expect(readSavedSearches(null)).toEqual([]);
  const list = addSavedSearch(
    [],
    ' Brooklyn ',
    {
      region: 'nyc',
      bedrooms: null,
      maxRent: 3000,
      petsRequired: true,
      minBathrooms: 1.5,
      offset: 100,
      token: 'never stored',
      includeCommute: true,
    },
    'one',
  );
  expect(list[0].name).toBe('Brooklyn');
  expect(list[0].filters.offset).toBe(0);
  expect(list[0].filters.includeCommute).toBe(false);
  expect(serializeSavedSearches(list)).not.toContain('never stored');
  expect(readSavedSearches(serializeSavedSearches(list))).toEqual(list);
  expect(() => presetFilters({ minSquareFeet: 'lots' })).toThrow();
  expect(() => addSavedSearch(list, 'brooklyn', {}, 'two')).toThrow();
  expect(() => addSavedSearch(list, 'Other', {}, 'one')).toThrow();
  expect(() => addSavedSearch([], ' ', {}, 'one')).toThrow();
  expect(() => addSavedSearch([], 'x'.repeat(61), {}, 'one')).toThrow();
  expect(() => addSavedSearch([], 'Name', {}, '../bad')).toThrow();
  let many: ReturnType<typeof addSavedSearch> = [];
  for (let i = 0; i < 10; i++) many = addSavedSearch(many, String(i), {}, String(i));
  expect(() => addSavedSearch(many, 'extra', {}, 'extra')).toThrow();
});
test('corrupt saved state fails closed and no generated document bypasses read validation', () => {
  for (const raw of ['{', 'null', '{}', '{"version":2,"searches":[]}', '{"version":1,"searches":null}'])
    expect(() => readSavedSearches(raw)).toThrow();
  const one = addSavedSearch([], 'Name', {}, 'one')[0];
  for (const patch of [{ lastCheckedAt: 'bad' }, { lastCheckedAt: 1 }, { baseline: {} }, { name: 2 }, { id: null }])
    expect(() => serializeSavedSearches([malformed<typeof one>({ ...one, ...patch })])).toThrow();
  const withBaseline = { ...one, baseline: compareWholeSnapshot(snapshot(), null).baseline, lastCheckedAt: '2026-02-01T00:00:00Z' };
  expect(readSavedSearches(serializeSavedSearches([withBaseline]))[0]).toEqual(withBaseline);
  expect(() => readSavedSearches('x'.repeat(40 * 1024 * 1024 + 1))).toThrow();
});
test('whole snapshots require coherent counts and validated observations, not paginated/partial claims', () => {
  expect(parseWholeSnapshot(snapshot()).eligible).toBe(1);
  for (const patch of [
    { scope: 'page' },
    { total: 2001 },
    { total: -1 },
    { total: 1.5 },
    { eligible: 2 },
    { eligible: -1 },
    { checkedAt: 1 },
    { checkedAt: 'bad' },
    { notices: [1] },
    { notices: null },
    { observations: [] },
    { observations: [point(), point()] },
  ])
    expect(() => parseWholeSnapshot({ ...snapshot(), ...patch })).toThrow();
});
test('whole-search baseline tracks changes beyond page100, never infers delisted or savings across fee bases', () => {
  const first = compareWholeSnapshot(snapshot(Array.from({ length: 101 }, (_, i) => point(2000, 1, String(i)))), null);
  expect(first.changes).toEqual([]);
  const next = compareWholeSnapshot(snapshot([point(1900, 2, '100'), point(1500, 2, '0', true), point(2200, 2, 'new')]), first.baseline);
  expect(next.changes.map((change) => change.kind)).toEqual(['price', 'fee_basis', 'newly_encountered']);
  expect(next.baseline.observations.length).toBe(102);
  expect(compareWholeSnapshot(snapshot([]), next.baseline).baseline).toEqual(next.baseline);
  expect(compareWholeSnapshot(snapshot([point(9999, 1, '100')]), next.baseline).changes).toEqual([]);
  expect(compareWholeSnapshot(snapshot([point(1900, 3, '100')]), next.baseline).changes).toEqual([]);
  expect(first.baseline.observations.find((item) => item.key === '100')!.rent).toBe(2000);
});
test('retention eviction is explicit and cannot mix separate preset baselines', () => {
  const first = compareWholeSnapshot(snapshot(Array.from({ length: 2000 }, (_, i) => point(2000, 1, String(i)))), null);
  const next = compareWholeSnapshot(snapshot([point(2500, 2, 'new')]), first.baseline);
  expect(next.baseline.truncated).toBe(true);
  expect(next.baseline.observations.length).toBe(2000);
  expect(compareWholeSnapshot(snapshot([point(2500, 3, 'new')]), next.baseline).baseline.truncated).toBe(true);
  expect(compareWholeSnapshot(snapshot([point(2500, 3, 'new')]), null).changes).toEqual([]);
});
