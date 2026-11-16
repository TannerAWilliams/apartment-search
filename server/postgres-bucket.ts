import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Pool } from 'pg';

export type BucketDatabase = Pick<Pool, 'query' | 'connect'>;
type Options = { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } };

// One row is one complete source snapshot. Conditional writes use a transaction
// and a global quota lock so competing processes cannot exceed the capacity.
export async function createPostgresBucket(database: BucketDatabase, maxBytes = 96 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid listing storage capacity.');
  await database.query(`CREATE TABLE IF NOT EXISTS apartment_objects (
    key text PRIMARY KEY, body bytea NOT NULL, etag text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  async function get(key: string) {
    const result = await database.query('SELECT body, etag, metadata FROM apartment_objects WHERE key = $1', [key]);
    const row = result.rows[0];
    if (!row) return null;
    const bytes = Uint8Array.from(row.body);
    return {
      etag: row.etag as string, customMetadata: { ...row.metadata } as Record<string, string>,
      arrayBuffer: async () => bytes.slice().buffer,
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
  }
  return {
    get, head: get,
    async put(key: string, body: string | Uint8Array, options: Options = {}) {
      const length = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
      if (length > maxBytes) throw new Error('Listing storage capacity exceeded.');
      // Capture mutable caller input before waiting for a connection or lock.
      const bytes = Buffer.from(body);
      const metadata = JSON.stringify({ ...options.customMetadata });
      const condition = { ...options.onlyIf };
      const client = await database.connect();
      try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE apartment_objects IN EXCLUSIVE MODE');
        const previous = (await client.query('SELECT etag FROM apartment_objects WHERE key = $1', [key])).rows[0];
        if ((condition.etagMatches && previous?.etag !== condition.etagMatches) || (condition.etagDoesNotMatch === '*' && previous)) {
          await client.query('ROLLBACK');
          return null;
        }
        const total = (await client.query('SELECT COALESCE(SUM(octet_length(body)), 0)::text AS bytes FROM apartment_objects WHERE key <> $1', [key])).rows[0];
        if (Number(total.bytes) + length > maxBytes) throw new Error('Listing storage capacity exceeded.');
        const etag = randomUUID();
        await client.query(`INSERT INTO apartment_objects (key, body, etag, metadata) VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (key) DO UPDATE SET body = EXCLUDED.body, etag = EXCLUDED.etag, metadata = EXCLUDED.metadata, updated_at = now()`, [key, bytes, etag, metadata]);
        await client.query('COMMIT');
        return { etag };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
  };
}
