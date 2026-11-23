import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { secretsEqual } from '../server/secrets.ts';

test('the in-memory test bucket mirrors D1 conditional writes and size limits', async () => {
 const bucket = createMemoryBucket(100);
 const first = await bucket.put('state', 'old', { onlyIf: { etagDoesNotMatch: '*' } });
 assert.equal(await bucket.put('state', 'bad', { onlyIf: { etagDoesNotMatch: '*' } }), null);
 assert.equal(await bucket.put('state', 'bad', { onlyIf: { etagMatches: 'wrong' } }), null);
 assert.equal(await required((await bucket.get('state'))).text(), 'old');
 await bucket.put('state', 'new', { onlyIf: { etagMatches: required(first).etag } });
 assert.equal(await required((await bucket.get('state'))).text(), 'new');
 await assert.rejects(bucket.put('large', 'x'.repeat(101)));
 assert.equal(await bucket.get('large'), null);
 assert.equal(await createMemoryBucket().get('state'), null);
});
test('secrets compare equal only when identical', () => {
 assert.equal(secretsEqual('Bearer ' + 'x'.repeat(40), 'Bearer ' + 'x'.repeat(40)), true);
 assert.equal(secretsEqual('Bearer short', 'Bearer ' + 'x'.repeat(40)), false);
 assert.equal(secretsEqual('Bearer ' + 'y'.repeat(40), 'Bearer ' + 'x'.repeat(40)), false);
});
