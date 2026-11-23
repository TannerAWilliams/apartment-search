import { fakeD1 } from './fixtures/fake-d1.ts';
import { test, expect } from 'bun:test';
import { createD1Bucket } from '../server/d1-bucket.ts';

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
