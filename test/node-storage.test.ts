import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { SESSION_COOKIE, issueSession, validSession } from '../server/private-session.ts';

test('temporary bucket provides isolated objects and conditional writes', async () => {
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
test('session expires, resists tampering and uses only the correct secret', () => {
 const now = 1800000000000; const secret = 'x'.repeat(40); const session = issueSession(secret, now);
 assert.equal(validSession(`${SESSION_COOKIE}=${session}`, secret, now), true);
 assert.equal(validSession(`${SESSION_COOKIE}=${session}`, 'other', now), false);
 assert.equal(validSession(`${SESSION_COOKIE}=${session}`, secret, now + 86400000), false);
 assert.equal(validSession(`${SESSION_COOKIE}=${session}x`, secret, now), false);
 assert.equal(validSession('other=' + session, secret, now), false);
});
