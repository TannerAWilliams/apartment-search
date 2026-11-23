import { Database } from 'bun:sqlite';
import type { D1Database, D1Statement } from '../../server/d1-bucket.ts';

/** A D1 binding backed by in-memory SQLite with the production schema. */
export async function fakeD1() {
  const sqlite = new Database(':memory:');
  sqlite.exec(await Bun.file(new URL('../../deploy/cloudflare/schema.sql', import.meta.url)).text());
  type Value = string | number | bigint | boolean | null | Uint8Array;
  const statements = new WeakMap<object, { sql: string; values: Value[] }>();
  /** Runs one statement as D1 does: rows for a query, and the change count. */
  const run = <T>(sql: string, values: Value[]) => {
    const statement = sqlite.query(sql);
    if (/^\s*(select|with)\b|\breturning\b/i.test(sql))
      return { results: statement.all(...values) as T[], meta: { changes: 0, last_row_id: 0 } };
    const { changes, lastInsertRowid } = statement.run(...values);
    return { results: [] as T[], meta: { changes, last_row_id: Number(lastInsertRowid) } };
  };
  const d1: D1Database = {
    prepare(sql) {
      const statement: D1Statement = {
        bind(...values: unknown[]) {
          // D1 binds booleans as 1 and 0 and dates as text, like Better Auth expects of it.
          const bound = values.map(
            (value): Value => (value instanceof Date ? value.toISOString() : value === undefined ? null : (value as Value)),
          );
          statements.set(statement, { sql, values: bound });
          return statement;
        },
        async first<T>() {
          const { values } = statements.get(statement) ?? { values: [] };
          return sqlite.query(sql).get(...values) as T | null;
        },
        async all<T>() {
          return run<T>(sql, (statements.get(statement) ?? { values: [] }).values);
        },
      };
      return statement;
    },
    async batch<T>(batch: D1Statement[]) {
      return sqlite.transaction(() =>
        batch.map((item) => {
          const { sql, values } = statements.get(item)!;
          return run<T>(sql, values);
        }),
      )();
    },
    async exec(query) {
      sqlite.exec(query);
    },
  };
  return { d1, sqlite };
}
