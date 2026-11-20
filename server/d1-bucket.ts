import { fromByteArray, toByteArray } from 'base64-js';
import type { Bucket, BucketHead } from './contracts.ts';

type Result<T> = { results: T[]; meta?: { changes?: number } };
export type D1Statement = {
  bind(...values: (string | number | null)[]): D1Statement;
  first<T>(): Promise<T | null>;
};
export type D1Database = {
  prepare(sql: string): D1Statement;
  batch<T>(statements: D1Statement[]): Promise<Result<T>[]>;
};

type StoredObject = { etag: string; metadata: string; part_count: number };
type StoredPart = { etag: string; part: number; body: string };
const PART_BYTES = 512 * 1024;

const HEAD = 'SELECT etag, metadata, part_count FROM apartment_objects WHERE key = ?';
const PARTS = 'SELECT etag, part, body FROM apartment_object_parts WHERE key = ? ORDER BY part';
const WRITE_HEAD = `
  INSERT INTO apartment_objects (key, etag, metadata, part_count)
  SELECT ?1, ?2, ?3, ?4
  WHERE (?5 IS NULL OR EXISTS (SELECT 1 FROM apartment_objects WHERE key = ?1 AND etag = ?5))
    AND (?6 = 0 OR NOT EXISTS (SELECT 1 FROM apartment_objects WHERE key = ?1))
  ON CONFLICT(key) DO UPDATE SET etag = excluded.etag, metadata = excluded.metadata,
    part_count = excluded.part_count`;
const REMOVE_PARTS = `DELETE FROM apartment_object_parts
  WHERE key = ?1 AND EXISTS (SELECT 1 FROM apartment_objects WHERE key = ?1 AND etag = ?2)`;
const WRITE_PART = `INSERT INTO apartment_object_parts (key, etag, part, body)
  SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM apartment_objects WHERE key = ?1 AND etag = ?2)`;

function headFrom(row: StoredObject): BucketHead {
  return { etag: row.etag, customMetadata: JSON.parse(row.metadata) };
}

export function createD1Bucket(database: D1Database): Bucket {
  return {
    async head(key) {
      const row = await database.prepare(HEAD).bind(key).first<StoredObject>();
      return row ? headFrom(row) : null;
    },
    async get(key) {
      const [objects, chunks] = await database.batch<StoredObject | StoredPart>([
        database.prepare(HEAD).bind(key),
        database.prepare(PARTS).bind(key),
      ]);
      const row = objects.results[0] as StoredObject | undefined;
      if (!row) return null;
      const parts = chunks.results as StoredPart[];
      if (parts.length !== row.part_count || parts.some((part, index) => part.etag !== row.etag || part.part !== index)) {
        throw new Error('The stored listing snapshot is incomplete.');
      }
      const decoded = parts.map(part => toByteArray(part.body));
      const bytes = new Uint8Array(decoded.reduce((total, part) => total + part.length, 0));
      let offset = 0;
      for (const part of decoded) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const text = async () => new TextDecoder().decode(bytes);
      return { ...headFrom(row), arrayBuffer: async () => bytes.slice().buffer, text, json: async () => JSON.parse(await text()) };
    },
    async put(key, body, options) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const parts = Math.max(1, Math.ceil(bytes.length / PART_BYTES));
      const etag = crypto.randomUUID();
      const statements = [
        database.prepare(WRITE_HEAD).bind(key, etag, JSON.stringify(options?.customMetadata ?? {}), parts,
          options?.onlyIf?.etagMatches ?? null, options?.onlyIf?.etagDoesNotMatch === '*' ? 1 : 0),
        database.prepare(REMOVE_PARTS).bind(key, etag),
      ];
      for (let part = 0; part < parts; part++) {
        const encoded = fromByteArray(bytes.subarray(part * PART_BYTES, (part + 1) * PART_BYTES));
        statements.push(database.prepare(WRITE_PART).bind(key, etag, part, encoded));
      }
      const [updated] = await database.batch(statements);
      return updated.meta?.changes === 1 ? { etag } : null;
    },
  };
}
