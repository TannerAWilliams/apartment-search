import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

test('oversized binary writes are rejected before copying the payload', async () => {
  const bucket = createMemoryBucket(4);
  const prior = await bucket.put('inventory', 'old');
  const payload = new Uint8Array(5);
  let copied = false;
  payload[Symbol.iterator] = function () {
    copied = true;
    return [1, 2, 3, 4, 5].values();
  };
  await expect(bucket.put('inventory', payload)).rejects.toThrow(/capacity exceeded/);
  expect(copied).toBe(false);
  const saved = await bucket.get('inventory');
  expect(required(saved).etag).toBe(required(prior).etag);
  expect(await required(saved).text()).toBe('old');
});

test('string preflight counts UTF-8 bytes, including replacement characters', async () => {
  for (const text of ['é', '🏠', '\ud800']) {
    const bytes = new TextEncoder().encode(text).byteLength;
    const exact = createMemoryBucket(bytes);
    await exact.put('inventory', text);
    expect((await required(await exact.get('inventory')).arrayBuffer()).byteLength).toBe(bytes);
    const short = createMemoryBucket(bytes - 1);
    await expect(short.put('inventory', text)).rejects.toThrow(/capacity exceeded/);
    expect(await short.get('inventory')).toBeNull();
  }
});

test('preflight credits only the replaced object and preserves conditional writes', async () => {
  const bucket = createMemoryBucket(6);
  const prior = await bucket.put('inventory', 'old');
  await bucket.put('other', '123');
  await expect(bucket.put('inventory', '🏠')).rejects.toThrow(/capacity exceeded/);
  expect(await bucket.put('inventory', new Uint8Array(100), { onlyIf: { etagMatches: 'stale' } })).toBeNull();
  await bucket.put('inventory', 'é', { onlyIf: { etagMatches: required(prior).etag } });
  await bucket.put('remaining', 'x');
  await expect(bucket.put('overflow', 'x')).rejects.toThrow(/capacity exceeded/);
  expect(await required(await bucket.get('other')).text()).toBe('123');
});
