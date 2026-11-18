import { Database } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import { createD1Bucket, type D1Database, type D1Statement } from '../server/d1-bucket.ts';

test('D1 bucket preserves multiple parts and keeps the winning conditional write', async () => {
  const sqlite = new Database(':memory:');
  try {
    sqlite.exec(await Bun.file(new URL('../deploy/cloudflare/schema.sql', import.meta.url)).text());
    const statements = new WeakMap<object, { sql: string; values: (string | number | null)[] }>();
    const d1: D1Database = {
      prepare(sql) {
        const statement = {
          bind(...values: (string | number | null)[]) {
            statements.set(statement, { sql, values });
            return statement;
          },
          async first<T>() {
            const { values } = statements.get(statement)!;
            return sqlite.query(sql).get(...values) as T | null;
          },
        };
        return statement;
      },
      async batch<T>(batch: D1Statement[]) {
        return sqlite.transaction(() => batch.map(item => {
          const { sql, values } = statements.get(item)!;
          const statement = sqlite.query(sql);
          if (sql.startsWith('SELECT')) return { results: statement.all(...values) as T[] };
          return { results: [] as T[], meta: { changes: statement.run(...values).changes } };
        }))();
      },
    };
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
