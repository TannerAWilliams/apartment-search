import { fromByteArray, toByteArray } from 'base64-js';
import type { Bucket, BucketHead, ListingSnapshot, SnapshotStore } from '../contracts.ts';
import { listingIndex } from './listing-rows.ts';

type Result<T> = { results: T[]; meta: { changes: number; last_row_id: number } };
/** The parts of Cloudflare's D1 binding the app uses: the storage here, and Better Auth (server/auth.ts). */
export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<Result<T>>;
};
export type D1Database = {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<Result<T>[]>;
  exec(query: string): Promise<unknown>;
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
  // Written by put() below from a Record<string, string>.
  return { etag: row.etag, customMetadata: JSON.parse(row.metadata) as Record<string, string> };
}

const SNAPSHOT_HEAD = 'SELECT etag, summary FROM listing_snapshots WHERE key = ?';
const WRITE_SNAPSHOT = `
  INSERT INTO listing_snapshots (key, etag, summary)
  SELECT ?1, ?2, ?3
  WHERE (?4 IS NULL OR EXISTS (SELECT 1 FROM listing_snapshots WHERE key = ?1 AND etag = ?4))
    AND (?5 = 0 OR NOT EXISTS (SELECT 1 FROM listing_snapshots WHERE key = ?1))
  ON CONFLICT(key) DO UPDATE SET etag = excluded.etag, summary = excluded.summary`;
/** Later statements in the write run only when the snapshot row took this write's etag. */
const OWNED = 'EXISTS (SELECT 1 FROM listing_snapshots WHERE key = ?1 AND etag = ?2)';
const LISTING_ROWS = `SELECT data FROM listings WHERE snapshot = ?1
  AND (?2 IS NULL OR region IS NULL OR region = ?2) AND (?3 IS NULL OR rent IS NULL OR rent <= ?3) ORDER BY position`;
/** Rows go in as JSON arrays read with json_each, so one statement carries many rows within D1's size limits. */
const CHUNK_BYTES = 768 * 1024;

/** Splits encoded rows into JSON arrays under CHUNK_BYTES, with the position of each array's first row. */
export function chunks(rows: string[]) {
  const out: { start: number; json: string }[] = [];
  let start = 0;
  let batch: string[] = [];
  let size = 2;
  rows.forEach((row, index) => {
    if (batch.length && size + row.length + 1 > CHUNK_BYTES) {
      out.push({ start, json: '[' + batch.join(',') + ']' });
      start = index;
      batch = [];
      size = 2;
    }
    batch.push(row);
    size += row.length + 1;
  });
  if (batch.length) out.push({ start, json: '[' + batch.join(',') + ']' });
  return out;
}

/** Listing snapshots in the listing_snapshots, listings and price_history tables. */
function d1Snapshots(database: D1Database): SnapshotStore {
  return {
    async head(key) {
      const row = await database.prepare(SNAPSHOT_HEAD).bind(key).first<{ etag: string }>();
      return row ? { etag: row.etag } : null;
    },
    async read(key, filter = {}) {
      const statements = [
        database.prepare(SNAPSHOT_HEAD).bind(key),
        database.prepare(LISTING_ROWS).bind(key, filter.region ?? null, filter.maxRent ?? null),
        database.prepare('SELECT count(*) AS saved FROM listings WHERE snapshot = ?').bind(key),
        ...(filter.history ? [database.prepare('SELECT data FROM price_history WHERE snapshot = ? ORDER BY position').bind(key)] : []),
      ];
      // One batch is one transaction, so the rows all belong to the same snapshot.
      const [head, listings, count, history] = await database.batch<Record<string, unknown>>(statements);
      const row = head.results[0];
      if (!row) return null;
      const parse = (rows: Record<string, unknown>[]) => rows.map(({ data }): unknown => JSON.parse(String(data)));
      return {
        etag: String(row.etag),
        // Written by write() below from an object.
        summary: JSON.parse(String(row.summary)) as ListingSnapshot['summary'],
        listings: parse(listings.results),
        saved: Number(count.results[0]?.saved ?? 0),
        history: history ? parse(history.results) : [],
      };
    },
    async write(key, { summary, listings, history }, onlyIf) {
      const etag = crypto.randomUUID();
      const listingRows = listings.map((listing) => {
        const { region, rent } = listingIndex(listing);
        return JSON.stringify([region, rent, listing]);
      });
      const statements = [
        database
          .prepare(WRITE_SNAPSHOT)
          .bind(key, etag, JSON.stringify(summary), onlyIf?.etagMatches ?? null, onlyIf?.etagDoesNotMatch === '*' ? 1 : 0),
        database.prepare(`DELETE FROM listings WHERE snapshot = ?1 AND ${OWNED}`).bind(key, etag),
        database.prepare(`DELETE FROM price_history WHERE snapshot = ?1 AND ${OWNED}`).bind(key, etag),
        ...chunks(listingRows).map(({ start, json }) =>
          database
            .prepare(`INSERT INTO listings (snapshot, position, region, rent, data)
              SELECT ?1, ?3 + row.key, row.value ->> '$[0]', row.value ->> '$[1]', row.value -> '$[2]' FROM json_each(?4) AS row WHERE ${OWNED}`)
            .bind(key, etag, start, json),
        ),
        ...chunks(history.map((entry) => JSON.stringify(entry))).map(({ start, json }) =>
          database
            .prepare(
              `INSERT INTO price_history (snapshot, position, data) SELECT ?1, ?3 + row.key, row.value FROM json_each(?4) AS row WHERE ${OWNED}`,
            )
            .bind(key, etag, start, json),
        ),
      ];
      const [written] = await database.batch(statements);
      return written.meta?.changes === 1 ? { etag } : null;
    },
  };
}

/** One bucket per database binding, so caches keyed by bucket survive across requests in an isolate. */
const buckets = new WeakMap<D1Database, Bucket>();

export function createD1Bucket(database: D1Database): Bucket {
  const existing = buckets.get(database);
  if (existing) return existing;
  const bucket: Bucket = {
    database,
    snapshots: d1Snapshots(database),
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
      const decoded = parts.map((part) => toByteArray(part.body));
      const bytes = new Uint8Array(decoded.reduce((total, part) => total + part.length, 0));
      let offset = 0;
      for (const part of decoded) {
        bytes.set(part, offset);
        offset += part.length;
      }
      const text = async () => new TextDecoder().decode(bytes);
      return { ...headFrom(row), arrayBuffer: async () => bytes.slice().buffer, text, json: async <T>() => JSON.parse(await text()) as T };
    },
    async put(key, body, options) {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      const parts = Math.max(1, Math.ceil(bytes.length / PART_BYTES));
      const etag = crypto.randomUUID();
      const statements = [
        database
          .prepare(WRITE_HEAD)
          .bind(
            key,
            etag,
            JSON.stringify(options?.customMetadata ?? {}),
            parts,
            options?.onlyIf?.etagMatches ?? null,
            options?.onlyIf?.etagDoesNotMatch === '*' ? 1 : 0,
          ),
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
  buckets.set(database, bucket);
  return bucket;
}
