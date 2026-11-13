import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResults } from '../src/search.ts';

const listing = (id, rent, seenAt, kind = 'feed') => ({ id, rent, seenAt, kind });
const ordered = (rows, sort = 'recent') => [...rows].sort((a, b) => compareResults(a, b, sort)).map(row => row.id);

test('recent sort orders checked listings by timestamp before rent', () => {
  const rows = [listing('old', 1000, '2026-11-01T00:00:00Z'), listing('new', 4000, '2026-11-13T00:00:00Z')];
  assert.deepEqual(ordered(rows), ['new', 'old']);
  assert.deepEqual(ordered(rows, 'rent'), ['old', 'new']);
});

test('recent sort keeps checked feeds before historical snapshots', () => {
  assert.deepEqual(ordered([listing('snapshot', 1000, '2026-11-14T00:00:00Z', 'snapshot'),
    listing('feed', 4000, '2026-11-13T00:00:00Z')]), ['feed', 'snapshot']);
});

test('recent sort handles missing and invalid dates without an unstable comparator', () => {
  const rows = [listing('missing', 1000, null), listing('invalid', 1200, 'invalid'),
    listing('dated', 4000, '2026-11-13T00:00:00Z')];
  assert.deepEqual(ordered(rows), ['dated', 'missing', 'invalid']);
  for (const a of rows) for (const b of rows) assert.ok(Number.isFinite(compareResults(a, b, 'recent')));
});

test('recent ties retain deterministic price and ID ordering', () => {
  assert.deepEqual(ordered([listing('b', 2000, '2026-11-13T00:00:00Z'),
    listing('a', 2000, '2026-11-12T19:00:00-05:00'), listing('cheap', 1000, '2026-11-13T00:00:00Z')]), ['cheap', 'a', 'b']);
});

test('recent sort is applied across the complete result set before pagination', async () => {
  const { formatSearch } = await import('../src/market.ts');
  const rows = Array.from({ length: 105 }, (_, n) => ({
    ...listing(String(n).padStart(3, '0'), 1000 + n, new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString()),
    sources: [{ id: 'streeteasy', name: 'StreetEasy', kind: 'feed', url: `https://streeteasy.com/rental/${n}` }],
  }));
  const first = formatSearch(rows, { sort: 'recent', offset: 0 }, {}, 'live', [], []);
  const last = formatSearch(rows, { sort: 'recent', offset: 100 }, {}, 'live', [], []);
  assert.equal(first.total, 105);
  assert.equal(first.matches[0].id, '104');
  assert.equal(first.matches.at(-1).id, '005');
  assert.equal(first.nextOffset, 100);
  assert.deepEqual(last.matches.map(row => row.id), ['004', '003', '002', '001', '000']);
  assert.equal(last.nextOffset, null);
});
