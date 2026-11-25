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

test('a search is answered from the data center’s cache until a source check changes it', async () => {
  const { cachedSearch } = await import('../server/search.ts');
  const stored = new Map<string, Response>();
  const cache = {
    match: async (request: RequestInfo | URL) => stored.get(String(request instanceof Request ? request.url : request))?.clone(),
    put: async (request: RequestInfo | URL, response: Response) => {
      stored.set(String(request instanceof Request ? request.url : request), response.clone());
    },
  } as unknown as Cache;
  const env = { BUCKET: createMemoryBucket() };
  const filters = parseFilters({ region: 'all', bedrooms: null, maxRent: null });
  const first = await cachedSearch(filters, env, offline, cache);
  expect(stored.size).toBe(1);
  const again = await cachedSearch(filters, env, offline, cache);
  expect(again.total).toBe(first.total);
  expect(stored.size, 'the same search is not stored twice').toBe(1);
  // A new deploy keeps its own answers, so a change to ranking is seen at once.
  await cachedSearch(filters, { ...env, CF_VERSION_METADATA: { id: 'next-version' } }, offline, cache);
  expect(stored.size).toBe(2);
  // Without a cache or storage, it searches directly.
  expect((await cachedSearch(filters, {}, offline, undefined)).total).toBeGreaterThan(0);
});

test('the companies in the app settings are counted once per saved state and deploy, then read from the cache', async () => {
  const { appConfig, savedAppConfig } = await import('../server/app-config.ts');
  const stored = new Map<string, Response>();
  const cache = {
    match: async (request: Request) => stored.get(request.url)?.clone(),
    put: async (request: Request, response: Response) => void stored.set(request.url, response.clone()),
  } as unknown as Cache;
  const env = { BUCKET: createMemoryBucket() };
  const first = await savedAppConfig(env, appConfig(env), cache);
  expect(stored.size).toBe(1);
  expect((await savedAppConfig(env, appConfig(env), cache)).companies).toEqual(first.companies);
  expect(stored.size).toBe(1);
  await savedAppConfig({ ...env, CF_VERSION_METADATA: { id: 'next-version' } }, appConfig(env), cache);
  expect(stored.size).toBe(2);
  // Without a cache it counts them directly.
  expect((await savedAppConfig(env, appConfig(env), undefined)).companies).toEqual(first.companies);
});
