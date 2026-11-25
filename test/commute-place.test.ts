import { expect, test } from 'bun:test';
import { placeKey, readCommutePlace as readStored } from '../server/commute-place.ts';
import { readCommutePlace, samePlace } from '../src/hooks/use-commute-place.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const call = (env: Record<string, unknown>, account: string | undefined, body?: unknown) =>
  handleApi(
    new Request(
      'https://app.test/api/commute-place',
      body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
    ),
    env,
    { account },
  );

test('each account keeps its own commute destination', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  expect(await readJson(call(env, 'renter@example.com'))).toStrictEqual({ place: null });
  const place = { workplace: 'custom', customWorkplace: '520 Madison Ave' };
  expect(await readJson(call(env, 'renter@example.com', { place }))).toStrictEqual({ place });
  expect(await readStored(bucket, 'RENTER@example.com'), 'the address is matched without case').toStrictEqual(place);
  expect(await readJson(call(env, 'other@example.com'))).toStrictEqual({ place: null });
  // Forgotten, it reads as none.
  expect(await readJson(call(env, 'renter@example.com', { place: null }))).toStrictEqual({ place: null });
  expect(await readJson(call(env, 'renter@example.com'))).toStrictEqual({ place: null });
  expect(await readJson(call(env, 'never@example.com', { place: null }))).toStrictEqual({ place: null });

  // Without an account, or with a bad body, nothing is stored.
  expect((await call(env, undefined)).status).toBe(404);
  expect((await call(env, undefined, { place })).status).toBe(404);
  expect((await call(env, 'renter@example.com', { place: { workplace: '' } })).status).toBe(422);
});

test('a damaged stored destination reads as none', async () => {
  const bucket = createMemoryBucket();
  await bucket.put(await placeKey('renter@example.com'), '{"workplace":7}');
  expect(await readStored(bucket, 'renter@example.com')).toBeNull();
});

test('the app keeps only a destination it still knows', () => {
  expect(readCommutePlace({ workplace: 'penn', customWorkplace: 'ignored' })).toStrictEqual({ workplace: 'penn', customWorkplace: '' });
  expect(readCommutePlace({ workplace: 'custom', customWorkplace: '520 Madison Ave' })).toStrictEqual({
    workplace: 'custom',
    customWorkplace: '520 Madison Ave',
  });
  for (const bad of [
    null,
    'penn',
    { workplace: 'moon', customWorkplace: '' },
    { workplace: 'custom', customWorkplace: 'ab' },
    { workplace: 1 },
  ])
    expect(readCommutePlace(bad)).toBeNull();
  expect(samePlace({ workplace: 'penn', customWorkplace: '' }, { workplace: 'penn', customWorkplace: '' })).toBe(true);
  expect(samePlace(null, { workplace: 'penn', customWorkplace: '' })).toBe(false);
  expect(samePlace(null, null)).toBe(true);
});
