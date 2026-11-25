import { expect, test } from 'bun:test';
import { overBudget } from '../perf/bench.ts';
import { overLimits } from '../perf/bundle.ts';
import { makeListings, seeded } from '../perf/fixtures.ts';

const budgets = {
  tolerance: 0.5,
  scenarios: { 'search-cold': { ratio: 6, ms: 300 }, 'api-search': { ratio: 1, ms: 40 } },
  scaling: { 'search-cold': 8 },
  sizes: { 'search-response-bytes': 150_000 },
  memory: { 'search-cold-heap-mb': 40 },
};

test('the speed check passes within the tolerance and names everything over its budget', () => {
  const within = {
    scenarios: { 'search-cold': { ratio: 8.9, ms: 420 }, 'api-search': { ratio: 0.7, ms: 30 } },
    scaling: { 'search-cold': 4.4 },
    sizes: { 'search-response-bytes': 126_000 },
    memory: { 'search-cold-heap-mb': 26 },
  };
  expect(overBudget(within, budgets)).toEqual([]);
  const failures = overBudget(
    {
      scenarios: { 'search-cold': { ratio: 9.1, ms: 450 }, 'api-search': { ratio: 1, ms: 40 }, 'new-scenario': { ratio: 1, ms: 1 } },
      scaling: { 'search-cold': 15.8 },
      sizes: { 'search-response-bytes': 400_000 },
      memory: { 'search-cold-heap-mb': 90 },
    },
    budgets,
  );
  expect(failures).toHaveLength(5);
  expect(failures[0]).toBe('search-cold: +52% slower than its budget (allowed +50%)');
  expect(failures[1]).toContain('new-scenario: no time budget recorded');
  expect(failures[2]).toContain('took 15.8× as long for 4× the listings (limit 8×)');
  expect(failures[3]).toBe('search-response-bytes: 400000 is over its limit of 150000 (+167%)');
  expect(failures[4]).toContain('search-cold-heap-mb: 90 is over its limit of 40');
});

test('the bundle check names a file over its limit and a library in the first download', () => {
  const limits = { entryJsKb: 238, entryCssKb: 14, lazyChunkKb: 329, totalJsKb: 668, workerKb: 1232 };
  const measured = { entryJsKb: 216, entryCssKb: 12, lazyChunkKb: 298, totalJsKb: 607, workerKb: 1120 };
  expect(overLimits(measured, limits)).toEqual([]);
  expect(overLimits({ ...measured, entryJsKb: 462 }, limits, ['MapLibre'])).toEqual([
    'entryJsKb: 462 KB is over its limit of 238 KB',
    'the first download contains MapLibre, which must stay in the lazily loaded map file',
  ]);
});

test('the benchmark inventory is the same on every run', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const ids = (seed: number) => [...makeListings(200, seed, now).values()].flat().map(({ id, rent }) => id + rent);
  expect(ids(1)).toEqual(ids(1));
  expect(ids(1)).not.toEqual(ids(2));
  expect(seeded(7)()).toBe(seeded(7)());
});
