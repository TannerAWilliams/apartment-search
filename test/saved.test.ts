import { expect, test } from 'bun:test';
import { keepSaved, MAX_SAVED, readSaved } from '../server/saved.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { testListing } from './fixtures/listing.ts';
import './fixtures/quiet-logs.ts';

const call = (env: Record<string, unknown>, account: string | undefined, body?: unknown) =>
  handleApi(
    new Request(
      'https://app.test/api/saved',
      body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ),
    env,
    { account },
  );

test('each account keeps its own saved listings', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  expect(await readJson(call(env, 'renter@example.com'))).toMatchObject({ listings: [] });
  const listings = [testListing({ id: 'a' }), testListing({ id: 'b' })];
  const saved = await readJson<{ listings: { id: string }[] }>(call(env, 'renter@example.com', { listings }));
  expect(saved.listings.map(({ id }) => id)).toStrictEqual(['a', 'b']);
  expect((await readSaved(bucket, 'RENTER@example.com')).length, 'the address is matched without case').toBe(2);
  expect((await readJson<{ listings: unknown[] }>(call(env, 'other@example.com'))).listings).toStrictEqual([]);

  // Without an account, or with a bad body, nothing is stored.
  expect((await call(env, undefined)).status).toBe(404);
  expect((await call(env, undefined, { listings })).status).toBe(404);
  expect((await call(env, 'renter@example.com', { listings: 'x' })).status).toBe(422);
  expect((await call({}, 'renter@example.com')).status).toBe(400);
});

test('saved listings need an ID, keep the latest copy of each, and are capped', async () => {
  const copies = keepSaved([testListing({ id: 'a', rent: 1 }), null, { id: '' }, { id: 7 }, testListing({ id: 'a', rent: 2 })]);
  expect(copies.map(({ id, rent }) => ({ id, rent }))).toStrictEqual([{ id: 'a', rent: 2 }]);
  expect(keepSaved(Array.from({ length: MAX_SAVED + 5 }, (_, index) => ({ id: String(index) }))).length).toBe(MAX_SAVED);
  const bucket = createMemoryBucket();
  await bucket.put(
    'saved/' +
      [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('x@example.com')))]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('') +
      '.json',
    '{"not":"a list"}',
  );
  expect(await readSaved(bucket, 'x@example.com'), 'an unreadable list reads as empty').toStrictEqual([]);
});
