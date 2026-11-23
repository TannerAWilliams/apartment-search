import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { compareResults, parseFilters } from '../src/search.ts';

const listing = (id: string, rent: number, seenAt: string | null, kind = 'feed') => ({
  id,
  rent,
  seenAt,
  kind,
  address: 'Test apartment',
  city: 'Brooklyn',
  state: 'NY',
  zip: '11201',
  bedrooms: 1,
  sources: [],
});
const ordered = (rows: ReturnType<typeof listing>[], sort = 'recent') =>
  [...rows].sort((a, b) => compareResults(a, b, sort)).map((row) => row.id);

test('recent sort orders checked listings by timestamp before rent', () => {
  const rows = [listing('old', 1000, '2026-11-01T00:00:00Z'), listing('new', 4000, '2026-11-13T00:00:00Z')];
  expect(ordered(rows)).toStrictEqual(['new', 'old']);
  expect(ordered(rows, 'rent')).toStrictEqual(['old', 'new']);
});

test('recent sort keeps checked feeds before historical snapshots', () => {
  expect(
    ordered([listing('snapshot', 1000, '2026-11-14T00:00:00Z', 'snapshot'), listing('feed', 4000, '2026-11-13T00:00:00Z')]),
  ).toStrictEqual(['feed', 'snapshot']);
});

test('recent sort handles missing and invalid dates without an unstable comparator', () => {
  const rows = [listing('missing', 1000, null), listing('invalid', 1200, 'invalid'), listing('dated', 4000, '2026-11-13T00:00:00Z')];
  expect(ordered(rows)).toStrictEqual(['dated', 'missing', 'invalid']);
  for (const a of rows) for (const b of rows) expect(Number.isFinite(compareResults(a, b, 'recent'))).toBeTruthy();
});

test('recent ties retain deterministic price and ID ordering', () => {
  expect(
    ordered([
      listing('b', 2000, '2026-11-13T00:00:00Z'),
      listing('a', 2000, '2026-11-12T19:00:00-05:00'),
      listing('cheap', 1000, '2026-11-13T00:00:00Z'),
    ]),
  ).toStrictEqual(['cheap', 'a', 'b']);
});

test('recent sort is applied across the complete result set before pagination', async () => {
  const { formatSearch } = await import('../src/market.ts');
  const rows = Array.from({ length: 105 }, (_, n) => ({
    ...listing(String(n).padStart(3, '0'), 1000 + n, new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString()),
    sources: [{ id: 'streeteasy', name: 'StreetEasy', kind: 'feed', url: `https://streeteasy.com/rental/${n}` }],
  }));
  const first = formatSearch(
    rows,
    parseFilters({ sort: 'recent', offset: 0 }),
    required({ label: 'Fixture', latitude: 0, longitude: 0 }),
    'live',
    [],
    [],
  );
  const last = formatSearch(
    rows,
    parseFilters({ sort: 'recent', offset: 100 }),
    required({ label: 'Fixture', latitude: 0, longitude: 0 }),
    'live',
    [],
    [],
  );
  expect(first.total).toBe(105);
  expect(first.matches[0].id).toBe('104');
  expect(required(first.matches.at(-1)).id).toBe('005');
  expect(first.nextOffset).toBe(100);
  expect(last.matches.map((row) => row.id)).toStrictEqual(['004', '003', '002', '001', '000']);
  expect(last.nextOffset).toBeNull();
});
