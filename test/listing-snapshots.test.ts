import { expect, test } from 'bun:test';
import type { SnapshotStore } from '../server/contracts.ts';
import { createD1Bucket } from '../server/d1-bucket.ts';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { required } from './test-values.ts';

const listing = (id: string, state: string, city: string, rent: number | null, extra = '') => ({ id, state, city, rent, note: extra });
const stores: [string, () => Promise<SnapshotStore>][] = [
  ['D1', async () => createD1Bucket((await fakeD1()).d1).snapshots],
  ['memory', async () => createMemoryBucket().snapshots],
];

for (const [name, make] of stores) {
  test(`${name}: a snapshot is written whole and read back narrowed to what a search can match`, async () => {
    const store = await make();
    const listings = [
      listing('a', 'NY', 'Brooklyn', 2500),
      listing('b', 'NJ', 'Jersey City', 2200),
      listing('c', 'NY', 'Brooklyn', 4100),
      listing('d', 'NY', 'Brooklyn', null),
      { id: 'no-place', rent: 1000 },
    ];
    const history = [{ identity: 'a', observations: [{ rent: 2500 }] }];
    const written = required(await store.write('source', { summary: { total: 5, observation: { version: 1 } }, listings, history }));
    expect((await store.head('source'))?.etag).toBe(written.etag);

    const all = required(await store.read('source'));
    expect(all.listings).toEqual(listings);
    expect(all.saved).toBe(5);
    expect(all.summary).toEqual({ total: 5, observation: { version: 1 } });
    expect(all.history).toEqual([]);
    expect(required(await store.read('source', { history: true })).history).toEqual(history);

    // Listings with no region or rent stay, so the search itself decides about them.
    const narrowed = required(await store.read('source', { region: 'nyc', maxRent: 3000 }));
    expect(narrowed.listings.map((item) => (item as { id: string }).id)).toEqual(['a', 'd', 'no-place']);
    expect(narrowed.saved).toBe(5);
    expect(await store.read('missing')).toBeNull();
  });

  test(`${name}: writes replace the snapshot only when it is the version they read`, async () => {
    const store = await make();
    const first = required(await store.write('source', { summary: {}, listings: [listing('a', 'NY', 'Brooklyn', 1)], history: [] }));
    expect(await store.write('source', { summary: {}, listings: [], history: [] }, { etagDoesNotMatch: '*' })).toBeNull();
    expect(await store.write('source', { summary: {}, listings: [], history: [] }, { etagMatches: 'stale' })).toBeNull();
    expect(required(await store.read('source')).listings).toHaveLength(1);
    await store.write(
      'source',
      { summary: { second: true }, listings: [listing('b', 'NJ', 'Hoboken', 2)], history: [] },
      { etagMatches: first.etag },
    );
    const second = required(await store.read('source'));
    expect(second.summary).toEqual({ second: true });
    expect(second.listings).toEqual([listing('b', 'NJ', 'Hoboken', 2)]);
  });
}

test('D1: a large snapshot is split across statements and read back in order', async () => {
  const store = createD1Bucket((await fakeD1()).d1).snapshots;
  // About 3 MB of listings: several of the D1 store's 768 KB statements.
  const listings = Array.from({ length: 1500 }, (_, index) => listing(`unit-${index}`, 'NY', 'Queens', 1000 + index, 'x'.repeat(2000)));
  const history = listings.map(({ id }) => ({ identity: id, observations: [] }));
  await store.write('large', { summary: {}, listings, history });
  const read = required(await store.read('large', { history: true }));
  expect(read.saved).toBe(1500);
  expect(read.listings).toEqual(listings);
  expect(read.history).toEqual(history);
  // Rewriting removes every row of the previous version.
  await store.write('large', { summary: {}, listings: listings.slice(0, 2), history: [] });
  expect(required(await store.read('large', { history: true }))).toMatchObject({ saved: 2, history: [] });
});
