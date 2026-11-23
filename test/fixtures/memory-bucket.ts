import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

/** An in-memory Bucket for tests, with the same conditional writes and size limit as the D1 bucket. */
export function createMemoryBucket(maxBytes = 96 * 1024 * 1024) {
  const objects = new Map<string, { bytes: Uint8Array; etag: string; customMetadata: Record<string, string> }>();
  let used = 0;
  const snapshot = (value: { bytes: Uint8Array; etag: string; customMetadata: Record<string, string> } | undefined) => value && ({
    etag: value.etag, customMetadata: { ...value.customMetadata },
    arrayBuffer: async () => value.bytes.slice().buffer,
    text: async () => new TextDecoder().decode(value.bytes),
    json: async () => JSON.parse(new TextDecoder().decode(value.bytes)),
  });
  return {
    async get(key: string) { return snapshot(objects.get(key)) ?? null; },
    async head(key: string) { return snapshot(objects.get(key)) ?? null; },
    async put(key: string, body: string | Uint8Array, options: { customMetadata?: Record<string, string>; onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } } = {}) {
      const previous = objects.get(key);
      if (options.onlyIf?.etagMatches && previous?.etag !== options.onlyIf.etagMatches) return null;
      if (options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
      // Reject before allocating a second payload-sized buffer on memory-limited hosts.
      const byteLength = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.byteLength;
      const nextUsed = used - (previous?.bytes.length ?? 0) + byteLength;
      if (nextUsed > maxBytes) throw new Error('Temporary listing cache capacity exceeded.');
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
      const value = { bytes, etag: randomUUID(), customMetadata: { ...options.customMetadata } };
      objects.set(key, value); used = nextUsed;
      return { etag: value.etag };
    },
  };
}
