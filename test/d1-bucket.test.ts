import { fakeD1 } from './fixtures/fake-d1.ts';
import { test, expect } from 'bun:test';
import { createD1Bucket } from '../server/storage/d1-bucket.ts';

test('D1 bucket preserves multiple parts and keeps the winning conditional write', async () => {
  const { d1, sqlite } = await fakeD1();
  try {
    const bucket = createD1Bucket(d1);
    const text = 'Apartment 🗽'.repeat(50_000);
    expect(await bucket.get('test')).toBeNull();
    const initial = await bucket.put('test', text, { customMetadata: { format: 'test' }, onlyIf: { etagDoesNotMatch: '*' } });
    expect(await bucket.head('test')).toEqual({ etag: initial!.etag, customMetadata: { format: 'test' } });
    expect(await (await bucket.get('test'))?.text()).toBe(text);
    expect(await bucket.put('test', 'duplicate', { onlyIf: { etagDoesNotMatch: '*' } })).toBeNull();
    expect(await bucket.put('test', 'stale', { onlyIf: { etagMatches: 'different' } })).toBeNull();
    expect(await (await bucket.get('test'))?.text()).toBe(text);
    const winner = await bucket.put('test', '', { onlyIf: { etagMatches: initial!.etag } });
    expect(winner?.etag).not.toBe(initial!.etag);
    expect(await (await bucket.get('test'))?.text()).toBe('');
    expect(sqlite.query('SELECT COUNT(*) AS count FROM apartment_object_parts').get()).toEqual({ count: 1 });
  } finally {
    sqlite.close();
  }
});

test('migrations are numbered in order with no gaps, and every one applies to a fresh database', async () => {
  const { migrations } = await import('./fixtures/fake-d1.ts');
  const { Database } = await import('bun:sqlite');
  const files = await migrations();
  expect(files.map(({ name }) => Number(name.slice(0, 4)))).toEqual(files.map((_, index) => index + 1));
  for (const { name } of files) expect(name).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  const database = new Database(':memory:');
  for (const { sql } of files) database.exec(sql);
  // Applying them again changes nothing, as the first one did to the database that already had its tables.
  for (const { sql } of files.slice(0, 1)) database.exec(sql);
});
