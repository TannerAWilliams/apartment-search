import type { ListingSnapshot, SnapshotStore } from '../../server/contracts.ts';
import { isRecord } from '../../src/domain.ts';
import { listingIndex, passesFilter } from '../../server/storage/listing-rows.ts';

/** An in-memory Bucket for tests, with the same conditional writes and size limit as the D1 bucket. */
export function createMemoryBucket(maxBytes = 96 * 1024 * 1024) {
  const objects = new Map<string, { bytes: Uint8Array; etag: string; customMetadata: Record<string, string> }>();
  let used = 0;
  const snapshot = (value: { bytes: Uint8Array; etag: string; customMetadata: Record<string, string> } | undefined) =>
    value && {
      etag: value.etag,
      customMetadata: { ...value.customMetadata },
      arrayBuffer: async () => value.bytes.slice().buffer,
      text: async () => new TextDecoder().decode(value.bytes),
      json: async <T>() => JSON.parse(new TextDecoder().decode(value.bytes)) as T,
    };
  // Listing snapshots, copied in and out through JSON as D1 stores them.
  const saved = new Map<string, { etag: string; json: string }>();
  const snapshots: SnapshotStore = {
    async head(key) {
      const value = saved.get(key);
      return value ? { etag: value.etag } : null;
    },
    async read(key, filter = {}) {
      const value = saved.get(key);
      if (!value) return null;
      const snapshot = JSON.parse(value.json) as ListingSnapshot;
      return {
        etag: value.etag,
        summary: snapshot.summary,
        listings: snapshot.listings.filter((listing) => passesFilter(listingIndex(listing), filter)),
        saved: snapshot.listings.length,
        history: filter.history ? snapshot.history : [],
      };
    },
    async find(id) {
      for (const { json } of saved.values()) {
        const found = (JSON.parse(json) as ListingSnapshot).listings.find((listing) => isRecord(listing) && listing.id === id);
        if (found) return found;
      }
      return null;
    },
    async write(key, snapshot, onlyIf = {}) {
      const previous = saved.get(key);
      if (onlyIf.etagMatches && previous?.etag !== onlyIf.etagMatches) return null;
      if (onlyIf.etagDoesNotMatch === '*' && previous) return null;
      const etag = crypto.randomUUID();
      saved.set(key, { etag, json: JSON.stringify(snapshot) });
      return { etag };
    },
  };
  return {
    snapshots,
    async get(key: string) {
      return snapshot(objects.get(key)) ?? null;
    },
    async head(key: string) {
      return snapshot(objects.get(key)) ?? null;
    },
    async put(
      key: string,
      body: string | Uint8Array,
      options: { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } } = {},
    ) {
      const previous = objects.get(key);
      if (options.onlyIf?.etagMatches && previous?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
      // Reject before allocating a second payload-sized buffer on memory-limited hosts.
      const byteLength = typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength;
      const nextUsed = used - (previous?.bytes.length ?? 0) + byteLength;
      if (nextUsed > maxBytes) throw new Error('Temporary listing cache capacity exceeded.');
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
      const value = { bytes, etag: crypto.randomUUID(), customMetadata: { ...options.customMetadata } };
      objects.set(key, value);
      used = nextUsed;
      return { etag: value.etag };
    },
  };
}

/** A snapshot store whose database is down, for tests of storage failures. */
export const unavailableSnapshots: SnapshotStore = {
  head: async () => {
    throw new Error('storage down');
  },
  read: async () => {
    throw new Error('storage down');
  },
  find: async () => {
    throw new Error('storage down');
  },
  write: async () => null,
};
