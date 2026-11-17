import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBunDatabase } from '../server/bun-database.ts';
type Pool = ReturnType<typeof createBunDatabase>;
import { createPostgresBucket } from '../server/postgres-bucket.ts';

const connectionString = process.env.TEST_POSTGRES_URL;
if (!connectionString) throw new Error('Set TEST_POSTGRES_URL to a disposable local PostgreSQL instance. No test was run.');
const target = new URL(connectionString);
if (target.search || target.hash || !['postgres:', 'postgresql:'].includes(target.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
  throw new Error('Real PostgreSQL tests are restricted to disposable loopback instances; production/remote targets are not allowed.');
}
async function isolated(work: (pool: Pool, connect: () => Pool) => Promise<void>) {
  const admin = createBunDatabase(connectionString);
  const schema = 'apartment_test_' + randomUUID().replaceAll('-', '');
  const pools: Pool[] = [];
  const connect = () => {
    const pool = createBunDatabase(connectionString, { max: 12, schema });
    pools.push(pool); return pool;
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const pool = connect();
    assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
    await work(pool, connect);
  } finally {
    await Promise.all(pools.map(pool => pool.end().catch(() => {})));
    // Only this run's random, test-owned schema is removed; never public/production tables.
    try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await admin.end(); }
  }
}

test('real PostgreSQL persists snapshot metadata across independent connection pools', async () => isolated(async (pool, connect) => {
  const first = await createPostgresBucket(pool);
  const saved = await first.put("unit');DROP TABLE apartment_objects;--", '{"rent":2000}', { customMetadata: { source: 'synthetic' } });
  const other = await createPostgresBucket(connect());
  const restored = await other.get("unit');DROP TABLE apartment_objects;--");
  assert.equal(restored.etag, saved.etag);
  assert.deepEqual(await restored.json(), { rent: 2000 });
  assert.deepEqual(restored.customMetadata, { source: 'synthetic' });
  const bytes = new Uint8Array(await restored.arrayBuffer()); bytes[0] = 0;
  assert.equal(await (await other.get("unit');DROP TABLE apartment_objects;--")).text(), '{"rent":2000}');
}));

test('real PostgreSQL serializes competing CAS writers across pools', async () => isolated(async (pool, connect) => {
  const first = await createPostgresBucket(pool), second = await createPostgresBucket(connect());
  const seed = await first.put('shared', 'seed');
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).put('shared', String(index), { onlyIf: { etagMatches: seed.etag } })));
  assert.equal(results.filter(Boolean).length, 1);
  const winner = results.findIndex(Boolean);
  assert.equal(await (await first.get('shared')).text(), String(winner));
  const creates = await Promise.all([first.put('new', 'one', { onlyIf: { etagDoesNotMatch: '*' } }), second.put('new', 'two', { onlyIf: { etagDoesNotMatch: '*' } })]);
  assert.equal(creates.filter(Boolean).length, 1);
}));

test('real PostgreSQL quota races and rollback preserve committed snapshots', async () => isolated(async (pool, connect) => {
  const first = await createPostgresBucket(pool, 7), second = await createPostgresBucket(connect(), 7);
  const race = await Promise.allSettled([first.put('a', '1234'), second.put('b', '5678')]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected').length, 1);
  const existing = await first.get('a') ? 'a' : 'b';
  const before = await first.get(existing);
  await first.put('small', 'xx');
  await assert.rejects(first.put(existing, '123456'), /capacity/i);
  assert.equal((await first.get(existing)).etag, before.etag);
  assert.equal(await (await first.get(existing)).text(), await before.text());
  await first.put(existing, 'abc'); // transaction rollback released its lock/connection
  assert.equal(await (await second.get(existing)).text(), 'abc');
}));
