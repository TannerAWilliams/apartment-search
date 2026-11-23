import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { loadFeed } from '../server/listings.ts';

const feed = { id: 'partner', name: 'Partner', kind: 'feed', url: 'https://feed.example.test/listings' };
const limit = 16 * 1024 * 1024;

test('oversized declared feed body is canceled before reading or parsing', async () => {
  let canceled = false;
  const response = new Response(new ReadableStream({ cancel() { canceled = true; } }), {
    headers: { 'Content-Length': String(limit + 1) },
  });
  response.json = async () => []; // Regression guard: the old unbounded parser would accept this.
  await assert.rejects(loadFeed(feed, async () => response), { code: 'incomplete_feed' });
  assert.equal(canceled, true);
});

test('missing or understated content length cannot bypass the decoded-byte cap', async () => {
  for (const headers of [new Headers(), new Headers({ 'Content-Length': '2' })]) {
    let canceled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(limit + 1)); },
      cancel() { canceled = true; },
    }), { headers });
    response.json = async () => [];
    await assert.rejects(loadFeed(feed, async () => response), { code: 'incomplete_feed' });
    assert.equal(canceled, true);
  }
});

test('an oversized refresh preserves the prior saved partner inventory', async () => {
  const { refreshSources, storedFeed } = await import('../server/refresh.ts');
  const { createMemoryBucket } = await import('../server/memory-bucket.ts');
  const env = { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const row = { id: 'one', address: '12 Grove Street', unit: '3', city: 'Jersey City', state: 'NJ',
    zip: '07302', county: 'Hudson', status: 'active', bedrooms: 2, rent: 2400 };
  const first = await refreshSources(env, { sourceId: feed.id, onDemand: true,
    now: new Date('2026-11-13T12:00:00Z'), fetcher: async (url: string) => {
      assert.equal(String(url), feed.url); return Response.json([row]);
    } });
  assert.equal(required(first.sources.find((source) => source.id === feed.id)).status, 'updated');
  const saved = await storedFeed(env.BUCKET, feed);
  const second = await refreshSources(env, { sourceId: feed.id, onDemand: true,
    now: new Date('2026-11-13T13:00:00Z'), fetcher: async (url: string) => {
      assert.equal(String(url), feed.url);
      return new Response('[]', { headers: { 'Content-Length': String(limit + 1) } });
    } });
  assert.equal(required(second.sources.find((source) => source.id === feed.id)).status, 'failed');
  assert.deepEqual(await storedFeed(env.BUCKET, feed), saved);
});

test('exact byte limit remains accepted and multibyte text spans chunks correctly', async () => {
  const exact = new Response('[]' + ' '.repeat(limit - 2));
  assert.deepEqual(await loadFeed(feed, async () => exact), { listings: [], pages: 1 });
  const raw = JSON.stringify({ listings: [], total: 0, note: 'Apartment 🏠' });
  const bytes = new TextEncoder().encode(raw);
  const response = new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  assert.deepEqual(await loadFeed(feed, async () => response), { listings: [], pages: 1 });
});

test('oversized later page rejects the entire feed instead of returning a partial result', async () => {
  const urls: string[] = [];
  await assert.rejects(loadFeed(feed, async (url: string) => {
    urls.push(url);
    return urls.length === 1 ? Response.json({ listings: [], next: '/page2' }) :
      new Response('[]', { headers: { 'Content-Length': String(limit + 1) } });
  }), { code: 'incomplete_feed' });
  assert.deepEqual(urls, [feed.url, 'https://feed.example.test/page2']);
});

test('feed configuration rejects too many feeds, missing details and unsupported export formats', async () => {
  const { configuredFeeds } = await import('../server/listings.ts');
  const feed = (id: string, extra = {}) => ({ id, name: 'Feed ' + id, url: 'https://feeds.example.test/' + id, ...extra });
  const config = (feeds: unknown) => configuredFeeds({ FREE_PARTNER_FEEDS_JSON: JSON.stringify(feeds) });
  assert.throws(() => config(Array.from({ length: 16 }, (_, index) => feed('feed' + index))), /up to 15/);
  assert.throws(() => config({ id: 'feed' }), /up to 15/);
  assert.throws(() => config([feed('feed', { url: 'http://insecure.example.test' })]), /unique ID, name, or HTTPS URL/);
  assert.throws(() => config([feed('feed'), feed('feed')]), /unique ID/);
  assert.throws(() => config([feed('feed', { format: 'csv' })]), /unsupported export format/);
  assert.equal(config([feed('feed')]).length, 1);
});

test('a feed whose total changes between pages, or whose next page is unusable, is incomplete', async () => {
  const page = (body: object) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const changing = [page({ listings: [], total: 2, next: '/page2' }), page({ listings: [], total: 3 })];
  await assert.rejects(loadFeed(feed, async () => changing.shift()!), { code: 'incomplete_feed' });
  for (const next of [' ', 7, 'http://[bad']) {
    await assert.rejects(loadFeed(feed, async () => page({ listings: [], next })), { code: 'incomplete_feed' });
  }
});
