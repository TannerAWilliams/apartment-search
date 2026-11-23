import { test, expect } from 'bun:test';
import assert from 'node:assert/strict';
import { createBunDatabase } from '../server/bun-database.ts';
test('Bun database rejects non-PostgreSQL targets and untrusted schema identifiers before connecting', () => {
  expect(() => createBunDatabase('sqlite://local')).toThrow('PostgreSQL');
  expect(() => createBunDatabase('mysql://localhost/test')).toThrow('PostgreSQL');
  expect(() => createBunDatabase('postgresql://localhost/test', { schema: 'public;DROP SCHEMA public' })).toThrow('schema');
});

test('the Postgres client connects lazily and fails cleanly when the server is unreachable', async () => {
  // Port 1 on loopback refuses connections, so nothing leaves this machine.
  const database = createBunDatabase('postgres://user:pass@127.0.0.1:1/apartments', { max: 1, schema: 'apartment_test_' + '0'.repeat(32) });
  try {
    await assert.rejects(database.query('SELECT 1'));
    await assert.rejects(database.connect());
  } finally {
    await database.end();
  }
});
