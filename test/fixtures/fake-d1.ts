import { Database } from 'bun:sqlite';
import type { D1Database, D1Statement } from '../../server/d1-bucket.ts';

/** A D1 binding backed by in-memory SQLite with the production schema. */
export async function fakeD1() {
  const sqlite = new Database(':memory:');
  sqlite.exec(await Bun.file(new URL('../../deploy/cloudflare/schema.sql', import.meta.url)).text());
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
      return sqlite.transaction(() =>
        batch.map((item) => {
          const { sql, values } = statements.get(item)!;
          const statement = sqlite.query(sql);
          if (sql.startsWith('SELECT')) return { results: statement.all(...values) as T[] };
          return { results: [] as T[], meta: { changes: statement.run(...values).changes } };
        }),
      )();
    },
  };
  return { d1, sqlite };
}
