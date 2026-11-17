import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresBucket, type BucketDatabase } from '../server/postgres-bucket.ts';

function adapter(db: PGlite): BucketDatabase {
  return { query: (sql: string, params?: unknown[]) => db.query(sql, params), connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) } as unknown as BucketDatabase;
}
test('PostgreSQL bucket persists source bytes, metadata and etags across process-like reopen', async () => {
  const path = await mkdtemp(join(tmpdir(), 'apartment-pg-'));
  let db = new PGlite(path);
  try {
    let bucket = await createPostgresBucket(adapter(db), 30);
    assert.equal(await bucket.get('missing'), null);
    const first = await bucket.put('source', '{"count":1}', { customMetadata: { version: '1' }, onlyIf: { etagDoesNotMatch: '*' } });
    await db.close(); db = new PGlite(path); bucket = await createPostgresBucket(adapter(db), 30);
    const restored = await bucket.head('source');
    assert.equal(required(restored).etag, required(first).etag); assert.deepEqual(required(restored).customMetadata, { version: '1' });
    assert.deepEqual(await required(restored).json(), { count: 1 });
    new Uint8Array(await required(restored).arrayBuffer())[0] = 0;
    assert.equal(await required(restored).text(), '{"count":1}');
    assert.equal(await bucket.put('source', 'bad', { onlyIf: { etagDoesNotMatch: '*' } }), null);
    assert.equal(await bucket.put('source', 'bad', { onlyIf: { etagMatches: 'wrong' } }), null);
    assert.equal(await bucket.put('absent', 'bad', { onlyIf: { etagMatches: 'wrong' } }), null);
    const next = await bucket.put('source', new TextEncoder().encode('new'), { onlyIf: { etagMatches: required(first).etag } });
    assert.notEqual(required(next).etag, required(first).etag); assert.equal(await required((await bucket.get('source'))).text(), 'new');
    await bucket.put('other', 'x'.repeat(25));
    await assert.rejects(bucket.put('source', 'x'.repeat(6)), /capacity/);
    await assert.rejects(bucket.put('oversize', 'x'.repeat(31)), /capacity/);
    assert.equal(await required((await bucket.get('source'))).text(), 'new');
    await bucket.put('source', 'ok');
    assert.equal(await required((await bucket.get('source'))).text(), 'ok');
  } finally { await db.close(); await rm(path, { recursive: true, force: true }); }
});
test('validation, unavailable database and rollback failures fail closed and release clients', async () => {
  const unavailable = { query: async () => { throw new Error('offline'); } } as unknown as BucketDatabase;
  await assert.rejects(createPostgresBucket(unavailable, 0), /Invalid/);
  await assert.rejects(createPostgresBucket(unavailable), /offline/);
  let released = 0;
  const queries: string[] = [];
  const failure = { query: async () => ({}), connect: async () => ({
    query: async (sql: string) => { queries.push(sql); if (sql === 'BEGIN') return {}; throw new Error('unavailable'); },
    release: () => released++,
  }) } as unknown as BucketDatabase;
  const bucket = await createPostgresBucket(failure);
  await assert.rejects(bucket.put('source', 'new'), /unavailable/);
  assert.equal(released, 1); assert.ok(queries.includes('ROLLBACK'));
});
test('captures caller bytes and metadata before waiting for the database connection', async () => {
  const db = new PGlite();
  try {
    const base = adapter(db);
    let proceed: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { proceed = resolve; });
    const delayed = { ...base, connect: async () => { await gate; return base.connect(); } } as BucketDatabase;
    const bucket = await createPostgresBucket(delayed);
    const input = new TextEncoder().encode('old'); const metadata = { version: 'old' };
    const pending = bucket.put('key', input, { customMetadata: metadata });
    input[0] = 120; metadata.version = 'new'; required(proceed)(); await pending;
    assert.equal(await required((await bucket.get('key'))).text(), 'old');
    assert.deepEqual(required((await bucket.get('key'))).customMetadata, { version: 'old' });
  } finally { await db.close(); }
});
