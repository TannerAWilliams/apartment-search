import { Database } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import { createD1Bucket, type D1Database, type D1Statement } from '../server/d1-bucket.ts';
import { createRefreshWorkflow } from '../server/refresh-workflow.ts';

async function localD1(sqlite: Database) {
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
  return d1;
}

test('D1 bucket preserves multiple parts and keeps the winning conditional write', async () => {
  const sqlite = new Database(':memory:');
  try {
    const bucket = createD1Bucket(await localD1(sqlite));
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

test('a new Worker request recovers the same Openigloo instance from D1 without touching inventory', async () => {
  const sqlite = new Database(':memory:');
  try {
    const database = await localD1(sqlite);
    const bucket = createD1Bucket(database);
    let now = Date.parse('2026-11-21T16:00:00Z');
    const created: string[] = [];
    let status = 'running';
    const binding = {
      async create({ id }: { id: string }) { created.push(id); },
      async get(id: string) {
        if (!created.includes(id)) throw new Error('No such fixture instance');
        return { async status() { return { status }; } };
      },
    };
    const sourceIds = ['openigloo', 'zumper-live'];
    const publishedKey = 'rentals/openigloo-fixture.json';
    const published = await bucket.put(publishedKey, '{"lastCheckedAt":"2026-11-18T18:20:40Z","listings":40}');
    const begin = await createRefreshWorkflow(bucket, binding, sourceIds, () => now).start(false, ['openigloo']);
    now += 5 * 60_000;
    const afterReload = createRefreshWorkflow(createD1Bucket(database), binding, sourceIds, () => now);
    expect(await afterReload.status()).toMatchObject({ id: begin.id, status: 'running', sources: ['openigloo'] });
    expect((await afterReload.start(false, ['openigloo'])).id).toBe(begin.id);
    expect(created).toEqual([begin.id]);
    status = 'errored';
    expect(await afterReload.status()).toMatchObject({ id: begin.id, status: 'errored' });
    expect((await bucket.get(publishedKey))?.etag).toBe(published?.etag);
  } finally {
    sqlite.close();
  }
});

test('confirmed Workflow stays unknown during outage or after deletion; exact guarded reconciliation touches only its header', async () => {
  const sqlite = new Database(':memory:');
  try {
    const database = await localD1(sqlite);
    const bucket = createD1Bucket(database);
    const key = 'rentals/complete-refresh-workflow.json';
    const inventoryKey = 'rentals/openigloo.json.gz';
    const freshnessKey = 'rentals/refresh.json';
    await bucket.put(inventoryKey, new Uint8Array([0x1f, 0x8b, 0x00, 0x01]));
    await bucket.put(freshnessKey, '{"lastCheckedAt":"2026-11-21T16:00:00Z"}');
    const retained = async () => Promise.all([inventoryKey, freshnessKey].map(async item => {
      const stored = (await bucket.get(item))!;
      return { etag: stored.etag, bytes: new Uint8Array(await stored.arrayBuffer()) };
    }));
    const before = await retained();
    let error: Error | undefined;
    const created: string[] = [];
    const binding = {
      async create({ id }: { id: string }) { created.push(id); },
      async get(id: string) {
        expect(created).toContain(id);
        if (error) throw error;
        return { status: async () => ({ status: 'queued' }) };
      },
    };
    const sources = ['openigloo', 'zumper-live'];
    const manager = () => createRefreshWorkflow(createD1Bucket(database), binding, sources);
    const first = await manager().start(false, ['openigloo']);
    const lookup = sqlite.query<{ etag: string; body: string }, [string]>(
      'SELECT h.etag, p.body FROM apartment_objects h JOIN apartment_object_parts p ON p.key = h.key AND p.etag = h.etag AND p.part = 0 WHERE h.key = ? AND h.part_count = 1');
    const captured = lookup.get(key)!;
    expect(JSON.parse(atob(captured.body))).toMatchObject({ id: first.id, status: 'queued' });
    for (const message of ['Temporary Cloudflare service unavailable', 'Instance does not exist (instance.not_found)']) {
      error = new Error(message);
      expect(await manager().status()).toEqual({ ...first, status: 'unknown' });
      expect(await manager().start(true, ['zumper-live'])).toEqual({ ...first, status: 'unknown' });
      await manager().retry(first.id);
      expect(created).toEqual([first.id]);
      expect(lookup.get(key)).toEqual(captured);
      expect(await retained()).toEqual(before);
    }

    // An operator would run this only after independent definitive absence verification.
    const sql = await Bun.file(new URL('../deploy/cloudflare/reconcile-workflow.sql', import.meta.url)).text();
    const reconcile = sqlite.query<unknown, [string, string]>(sql);
    expect(reconcile.run('wrong-etag', captured.body).changes).toBe(0);
    expect(reconcile.run(captured.etag, 'wrong-body').changes).toBe(0);
    expect(lookup.get(key)).toEqual(captured);
    expect(reconcile.run(captured.etag, captured.body).changes).toBe(1);
    expect(await bucket.get(key)).toBeNull();
    expect(sqlite.query('SELECT body FROM apartment_object_parts WHERE key = ?').get(key)).toEqual({ body: captured.body });
    expect(created).toEqual([first.id]);
    expect(await retained()).toEqual(before);
    error = undefined;
    const next = await manager().start(false, ['zumper-live']);
    expect(next.id).not.toBe(first.id);
    expect(created).toEqual([first.id, next.id]);
    expect(JSON.parse(atob(lookup.get(key)!.body))).toMatchObject({ id: next.id });
    expect(reconcile.run(captured.etag, captured.body).changes).toBe(0);
    expect(await retained()).toEqual(before);
  } finally {
    sqlite.close();
  }
});
