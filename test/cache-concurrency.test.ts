import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

test('concurrent initial refresh leases have exactly one winner', async () => {
  const bucket = createMemoryBucket();
  const attempts = await Promise.all(
    Array.from({ length: 32 }, (_, id) => bucket.put('refresh-lock', String(id), { onlyIf: { etagDoesNotMatch: '*' } })),
  );
  const winners = attempts.flatMap((result, id) => (result ? [id] : []));
  expect(winners.length).toBe(1);
  expect(await required(await bucket.get('refresh-lock')).text()).toBe(String(winners[0]));
});

test('concurrent updates based on one ETag cannot lose the winning write', async () => {
  const bucket = createMemoryBucket();
  const initial = await bucket.put('inventory', 'initial');
  const oldSnapshot = await bucket.get('inventory');
  const attempts = await Promise.all(
    Array.from({ length: 32 }, (_, id) => bucket.put('inventory', String(id), { onlyIf: { etagMatches: required(initial).etag } })),
  );
  const winners = attempts.flatMap((result, id) => (result ? [id] : []));
  expect(winners.length).toBe(1);
  expect(await required(await bucket.get('inventory')).text()).toBe(String(winners[0]));
  expect(await required(oldSnapshot).text()).toBe('initial');
  expect(await bucket.put('inventory', 'stale', { onlyIf: { etagMatches: required(initial).etag } })).toBeNull();
  expect(await required(await bucket.get('inventory')).text()).toBe(String(winners[0]));
});

test('failed writes do not consume capacity and smaller replacements free it', async () => {
  const bucket = createMemoryBucket(10);
  await bucket.put('inventory', '1234567890');
  await expect(bucket.put('new', 'x')).rejects.toThrow(/capacity exceeded/);
  await expect(bucket.put('inventory', '12345678901')).rejects.toThrow(/capacity exceeded/);
  expect(await bucket.get('new')).toBeNull();
  expect(await required(await bucket.get('inventory')).text()).toBe('1234567890');
  await bucket.put('inventory', '12');
  await bucket.put('new', '12345678');
  expect(await required(await bucket.get('new')).text()).toBe('12345678');
});
