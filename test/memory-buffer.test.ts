import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

test('stored Node Buffers are isolated from caller mutations and backing array offsets', async () => {
  const bucket = createMemoryBucket();
  const parent = Buffer.from('xxoriginalyy');
  const body = parent.subarray(2, 10);
  const stored = await bucket.put('source', body);
  parent.fill(0);
  const snapshot = await bucket.get('source');
  assert.equal(await required(snapshot).text(), 'original');
  assert.equal(required(snapshot).etag, required(stored).etag);
  const read = new Uint8Array(await required(snapshot).arrayBuffer());
  read.fill(0);
  assert.equal(await required((await bucket.get('source'))).text(), 'original');
});

test('an oversized Buffer replacement preserves saved bytes and ETag', async () => {
  const bucket = createMemoryBucket(4);
  const initial = await bucket.put('source', Buffer.from('good'));
  await assert.rejects(bucket.put('source', Buffer.from('oversized')), /capacity exceeded/);
  const saved = await bucket.get('source');
  assert.equal(required(saved).etag, required(initial).etag);
  assert.equal(await required(saved).text(), 'good');
});
