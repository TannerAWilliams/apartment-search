import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from '../server/memory-bucket.ts';

test('concurrent initial refresh leases have exactly one winner', async () => {
  const bucket = createMemoryBucket();
  const attempts = await Promise.all(Array.from({ length: 32 }, (_, id) =>
    bucket.put('refresh-lock', String(id), { onlyIf: { etagDoesNotMatch: '*' } })));
  const winners = attempts.flatMap((result, id) => result ? [id] : []);
  assert.equal(winners.length, 1);
  assert.equal(await required((await bucket.get('refresh-lock'))).text(), String(winners[0]));
});

test('concurrent updates based on one ETag cannot lose the winning write', async () => {
  const bucket = createMemoryBucket();
  const initial = await bucket.put('inventory', 'initial');
  const oldSnapshot = await bucket.get('inventory');
  const attempts = await Promise.all(Array.from({ length: 32 }, (_, id) =>
    bucket.put('inventory', String(id), { onlyIf: { etagMatches: required(initial).etag } })));
  const winners = attempts.flatMap((result, id) => result ? [id] : []);
  assert.equal(winners.length, 1);
  assert.equal(await required((await bucket.get('inventory'))).text(), String(winners[0]));
  assert.equal(await required(oldSnapshot).text(), 'initial');
  assert.equal(await bucket.put('inventory', 'stale', { onlyIf: { etagMatches: required(initial).etag } }), null);
  assert.equal(await required((await bucket.get('inventory'))).text(), String(winners[0]));
});

test('failed writes do not consume capacity and smaller replacements free it', async () => {
  const bucket = createMemoryBucket(10);
  await bucket.put('inventory', '1234567890');
  await assert.rejects(bucket.put('new', 'x'), /capacity exceeded/);
  await assert.rejects(bucket.put('inventory', '12345678901'), /capacity exceeded/);
  assert.equal(await bucket.get('new'), null);
  assert.equal(await required((await bucket.get('inventory'))).text(), '1234567890');
  await bucket.put('inventory', '12');
  await bucket.put('new', '12345678');
  assert.equal(await required((await bucket.get('new'))).text(), '12345678');
});
