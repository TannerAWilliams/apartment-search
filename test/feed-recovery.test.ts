import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { refreshSources, storedFeed } from '../server/refresh.ts';

const feed = { id: 'partner', name: 'Partner', kind: 'feed', url: 'https://feed.example.test/listings' };
const row = { id: 'one', address: '12 Grove Street', unit: '3', city: 'Jersey City', state: 'NJ',
  zip: '07302', county: 'Hudson', status: 'active', bedrooms: 2, rent: 2400 };

for (const failure of ['disconnect', 'invalid-json', 'http-error'] as const) {
  test(`later-page ${failure} keeps the prior inventory and recovers on the next healthy refresh`, async () => {
    const env = { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
    const refresh = (hour: string, fetcher: import('../src/fetch-type.ts').FetchTransport) => refreshSources(env, { sourceId: feed.id, onDemand: true,
      now: new Date(`2026-11-13T${hour}:00:00Z`), fetcher });
    const first = await refresh('12', async (url: string) => {
      assert.equal(String(url), feed.url);
      return Response.json({ listings: [row], total: 1 });
    });
    const firstStatus = first.sources.find(({ id }) => id === feed.id);
    assert.equal(required(firstStatus).status, 'updated');
    const saved = await storedFeed(env.BUCKET, feed);
    let faultInjected = false;
    const requested: string[] = [];
    const failed = await refresh('13', async (url: string) => {
      requested.push(String(url));
      if (String(url) === feed.url) return Response.json({ listings: [{ ...row, rent: 9999 }], total: 2, next: '/page2' });
      assert.equal(String(url), 'https://feed.example.test/page2');
      faultInjected = true;
      if (failure === 'http-error') return new Response('Unavailable', { status: 503 });
      if (failure === 'invalid-json') return new Response('{"listings":[');
      let reads = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (reads++ === 0) controller.enqueue(new TextEncoder().encode('{"listings":['));
        else controller.error(new Error('Injected connection lost after partial body'));
      } }));
    });
    assert.equal(faultInjected, true, 'the test must reach the second-page fault');
    assert.deepEqual(requested, [feed.url, ...Array(failure === 'http-error' ? 2 : 1).fill('https://feed.example.test/page2')]);
    const failedStatus = failed.sources.find(({ id }) => id === feed.id);
    assert.equal(required(failedStatus).status, 'failed');
    assert.equal(required(failedStatus).updatedAt, required(firstStatus).updatedAt);
    assert.deepEqual(await storedFeed(env.BUCKET, feed), saved);

    const healthy = await refresh('14', async (url: string) => {
      assert.equal(String(url), feed.url);
      return Response.json({ listings: [{ ...row, rent: 2500 }], total: 1 });
    });
    assert.equal(required(healthy.sources.find(({ id }) => id === feed.id)).status, 'updated');
    assert.equal((await storedFeed(env.BUCKET, feed)).listings[0].rent, 2500);
  });
}
