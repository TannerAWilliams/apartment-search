import { expect, test } from 'bun:test';
import { GATHER_MS, offline, recentlyGathered, search } from '../server/search.ts';
import { parseFilters } from '../src/search.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const set = (mode: string) => ({ listings: [], mode, sources: [], notices: [] });

test('a search’s listings are reused for a minute, two sets at a time, and a failed read is not kept', async () => {
  const bucket = createMemoryBucket();
  let reads = 0;
  const gather = (mode: string) => async () => {
    reads += 1;
    return set(mode);
  };
  const first = await recentlyGathered(bucket, 'all', gather('a'), 1_000);
  expect(await recentlyGathered(bucket, 'all', gather('b'), 2_000)).toBe(first);
  expect(reads).toBe(1);
  // After a minute, read again.
  expect((await recentlyGathered(bucket, 'all', gather('c'), 1_000 + GATHER_MS)).mode).toBe('c');
  // A third set pushes out the oldest.
  await recentlyGathered(bucket, 'brooklyn', gather('d'), 70_000);
  await recentlyGathered(bucket, 'queens', gather('e'), 70_000);
  expect((await recentlyGathered(bucket, 'all', gather('f'), 70_001)).mode).toBe('f');
  // A failed read is tried again next time.
  await expect(recentlyGathered(bucket, 'bronx', async () => Promise.reject(new Error('D1 busy')), 80_000)).rejects.toThrow('D1 busy');
  expect((await recentlyGathered(bucket, 'bronx', gather('g'), 80_001)).mode).toBe('g');
});

test('switching categories re-filters the kept listings and gives the same results as a fresh search', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const all = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null }), env, offline);
  const deals = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null, belowMarket: true }), env, offline);
  const again = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null }), env, offline);
  expect(again.total).toBe(all.total);
  expect(again.matches.map(({ id }) => id)).toEqual(all.matches.map(({ id }) => id));
  expect(deals.total).toBeLessThanOrEqual(all.total);
});
