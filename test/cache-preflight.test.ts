import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from '../server/memory-bucket.ts';

test('oversized binary writes are rejected before copying the payload', async () => {
  const bucket = createMemoryBucket(4);
  const prior = await bucket.put('inventory', 'old');
  const payload = new Uint8Array(5);
  let copied = false;
  payload[Symbol.iterator] = function () { copied = true; return [1, 2, 3, 4, 5].values(); };
  await assert.rejects(bucket.put('inventory', payload), /capacity exceeded/);
  assert.equal(copied, false);
  const saved = await bucket.get('inventory');
  assert.equal(required(saved).etag, required(prior).etag);
  assert.equal(await required(saved).text(), 'old');
});

test('string preflight counts UTF-8 bytes, including replacement characters', async () => {
  for (const text of ['é', '🏠', '\ud800']) {
    const bytes = new TextEncoder().encode(text).byteLength;
    const exact = createMemoryBucket(bytes);
    await exact.put('inventory', text);
    assert.equal((await required((await exact.get('inventory'))).arrayBuffer()).byteLength, bytes);
    const short = createMemoryBucket(bytes - 1);
    await assert.rejects(short.put('inventory', text), /capacity exceeded/);
    assert.equal(await short.get('inventory'), null);
  }
});

test('preflight credits only the replaced object and preserves conditional writes', async () => {
  const bucket = createMemoryBucket(6);
  const prior = await bucket.put('inventory', 'old');
  await bucket.put('other', '123');
  await assert.rejects(bucket.put('inventory', '🏠'), /capacity exceeded/);
  assert.equal(await bucket.put('inventory', new Uint8Array(100), { onlyIf: { etagMatches: 'stale' } }), null);
  await bucket.put('inventory', 'é', { onlyIf: { etagMatches: required(prior).etag } });
  await bucket.put('remaining', 'x');
  await assert.rejects(bucket.put('overflow', 'x'), /capacity exceeded/);
  assert.equal(await required((await bucket.get('other'))).text(), '123');
});
