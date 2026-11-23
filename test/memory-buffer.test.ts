import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

test('stored byte views are isolated from caller mutations and backing array offsets', async () => {
  const bucket = createMemoryBucket();
  const parent = bytes('xxoriginalyy');
  const body = parent.subarray(2, 10);
  const stored = await bucket.put('source', body);
  parent.fill(0);
  const snapshot = await bucket.get('source');
  expect(await required(snapshot).text()).toBe('original');
  expect(required(snapshot).etag).toBe(required(stored).etag);
  const read = new Uint8Array(await required(snapshot).arrayBuffer());
  read.fill(0);
  expect(await required((await bucket.get('source'))).text()).toBe('original');
});

test('an oversized replacement preserves saved bytes and ETag', async () => {
  const bucket = createMemoryBucket(4);
  const initial = await bucket.put('source', bytes('good'));
  await expect(bucket.put('source', bytes('oversized'))).rejects.toThrow(/capacity exceeded/);
  const saved = await bucket.get('source');
  expect(required(saved).etag).toBe(required(initial).etag);
  expect(await required(saved).text()).toBe('good');
});
