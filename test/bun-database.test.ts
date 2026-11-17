import { test, expect } from 'bun:test';
import { createBunDatabase } from '../server/bun-database.ts';
test('Bun database rejects non-PostgreSQL targets and untrusted schema identifiers before connecting', () => {
  expect(() => createBunDatabase('sqlite://local')).toThrow('PostgreSQL');
  expect(() => createBunDatabase('mysql://localhost/test')).toThrow('PostgreSQL');
  expect(() => createBunDatabase('postgresql://localhost/test', { schema: 'public;DROP SCHEMA public' })).toThrow('schema');
});
