import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { loadFeed } from '../server/sources/listings.ts';

const feed = { id: 'partner', name: 'Partner', kind: 'feed', url: 'https://feed.example.test/listings' };
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

test('a page exceeding its reported total fails without requesting its next page', async () => {
  let calls = 0;
  await expect(
    loadFeed(feed, async () => {
      calls++;
      return Response.json({ listings: [row], total: 0, next: '/unneeded' });
    }),
  ).rejects.toMatchObject({ code: 'incomplete_feed' });
  expect(calls).toBe(1);
});

test('earlier reported totals still apply to subsequent pages that omit the total', async () => {
  let calls = 0;
  await expect(
    loadFeed(feed, async () => {
      calls++;
      return calls === 1
        ? Response.json({ listings: [row], total: 1, next: '/page2' })
        : Response.json({ listings: [{ ...row, id: 'two' }], next: '/unneeded' });
    }),
  ).rejects.toMatchObject({ code: 'incomplete_feed' });
  expect(calls).toBe(2);
});

test('raw counts include excluded rows and exact complete inventory is still accepted', async () => {
  const result = await loadFeed(feed, async () =>
    Response.json({ listings: [row, { ...row, id: 'closed', status: 'inactive' }], total: 2 }),
  );
  expect(result.listings.length).toBe(1);
  expect(result.pages).toBe(1);
});

test('an impossible feed count preserves previously saved inventory', async () => {
  const { refreshSources, storedFeed } = await import('../server/refresh.ts');
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const env = { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  await refreshSources(env, {
    sourceId: feed.id,
    onDemand: true,
    now: new Date('2026-11-13T12:00:00Z'),
    fetcher: async () => Response.json({ listings: [row], total: 1 }),
  });
  const saved = await storedFeed(env.BUCKET, feed);
  let calls = 0;
  const result = await refreshSources(env, {
    sourceId: feed.id,
    onDemand: true,
    now: new Date('2026-11-13T13:00:00Z'),
    fetcher: async () => {
      calls++;
      return Response.json({ listings: [row], total: 0, next: '/unneeded' });
    },
  });
  expect(calls).toBe(1);
  expect(required(result.sources.find(({ id }) => id === feed.id)).status).toBe('failed');
  expect(await storedFeed(env.BUCKET, feed)).toStrictEqual(saved);
});
