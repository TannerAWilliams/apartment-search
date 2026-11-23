import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { loadFeed } from '../server/sources/listings.ts';

const feed = { id: 'partner', name: 'Partner', kind: 'feed', url: 'https://feed.example.test/listings' };
const limit = 16 * 1024 * 1024;

test('oversized declared feed body is canceled before reading or parsing', async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        canceled = true;
      },
    }),
    {
      headers: { 'Content-Length': String(limit + 1) },
    },
  );
  response.json = async () => []; // Regression guard: the old unbounded parser would accept this.
  await expect(loadFeed(feed, async () => response)).rejects.toMatchObject({ code: 'incomplete_feed' });
  expect(canceled).toBe(true);
});

test('missing or understated content length cannot bypass the decoded-byte cap', async () => {
  for (const headers of [new Headers(), new Headers({ 'Content-Length': '2' })]) {
    let canceled = false;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(limit + 1));
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers },
    );
    response.json = async () => [];
    await expect(loadFeed(feed, async () => response)).rejects.toMatchObject({ code: 'incomplete_feed' });
    expect(canceled).toBe(true);
  }
});

test('an oversized refresh preserves the prior saved partner inventory', async () => {
  const { refreshSources, storedFeed } = await import('../server/refresh.ts');
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const env = { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const row = {
    id: 'one',
    address: '12 Grove Street',
    unit: '3',
    city: 'Jersey City',
    state: 'NJ',
    zip: '07302',
    county: 'Hudson',
    status: 'active',
    bedrooms: 2,
    rent: 2400,
  };
  const first = await refreshSources(env, {
    sourceId: feed.id,
    onDemand: true,
    now: new Date('2026-11-13T12:00:00Z'),
    fetcher: async (url: string) => {
      expect(String(url)).toBe(feed.url);
      return Response.json([row]);
    },
  });
  expect(required(first.sources.find((source) => source.id === feed.id)).status).toBe('updated');
  const saved = await storedFeed(env.BUCKET, feed);
  const second = await refreshSources(env, {
    sourceId: feed.id,
    onDemand: true,
    now: new Date('2026-11-13T13:00:00Z'),
    fetcher: async (url: string) => {
      expect(String(url)).toBe(feed.url);
      return new Response('[]', { headers: { 'Content-Length': String(limit + 1) } });
    },
  });
  expect(required(second.sources.find((source) => source.id === feed.id)).status).toBe('failed');
  expect(await storedFeed(env.BUCKET, feed)).toStrictEqual(saved);
});

test('exact byte limit remains accepted and multibyte text spans chunks correctly', async () => {
  const exact = new Response('[]' + ' '.repeat(limit - 2));
  expect(await loadFeed(feed, async () => exact)).toStrictEqual({ listings: [], pages: 1 });
  const raw = JSON.stringify({ listings: [], total: 0, note: 'Apartment 🏠' });
  const bytes = new TextEncoder().encode(raw);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
  );
  expect(await loadFeed(feed, async () => response)).toStrictEqual({ listings: [], pages: 1 });
});

test('oversized later page rejects the entire feed instead of returning a partial result', async () => {
  const urls: string[] = [];
  await expect(
    loadFeed(feed, async (url: string) => {
      urls.push(url);
      return urls.length === 1
        ? Response.json({ listings: [], next: '/page2' })
        : new Response('[]', { headers: { 'Content-Length': String(limit + 1) } });
    }),
  ).rejects.toMatchObject({ code: 'incomplete_feed' });
  expect(urls).toStrictEqual([feed.url, 'https://feed.example.test/page2']);
});

test('feed configuration rejects too many feeds, missing details and unsupported export formats', async () => {
  const { configuredFeeds } = await import('../server/sources/listings.ts');
  const feed = (id: string, extra = {}) => ({ id, name: 'Feed ' + id, url: 'https://feeds.example.test/' + id, ...extra });
  const config = (feeds: unknown) => configuredFeeds({ FREE_PARTNER_FEEDS_JSON: JSON.stringify(feeds) });
  expect(() => config(Array.from({ length: 16 }, (_, index) => feed('feed' + index)))).toThrow(/up to 15/);
  expect(() => config({ id: 'feed' })).toThrow(/up to 15/);
  expect(() => config([feed('feed', { url: 'http://insecure.example.test' })])).toThrow(/unique ID, name, or HTTPS URL/);
  expect(() => config([feed('feed'), feed('feed')])).toThrow(/unique ID/);
  expect(() => config([feed('feed', { format: 'csv' })])).toThrow(/unsupported export format/);
  expect(config([feed('feed')]).length).toBe(1);
});

test('a feed whose total changes between pages, or whose next page is unusable, is incomplete', async () => {
  const page = (body: object) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const changing = [page({ listings: [], total: 2, next: '/page2' }), page({ listings: [], total: 3 })];
  await expect(loadFeed(feed, async () => changing.shift()!)).rejects.toMatchObject({ code: 'incomplete_feed' });
  for (const next of [' ', 7, 'http://[bad']) {
    await expect(loadFeed(feed, async () => page({ listings: [], next }))).rejects.toMatchObject({ code: 'incomplete_feed' });
  }
});
