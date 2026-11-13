import { randomUUID } from 'node:crypto';

// Render Free has no durable disk. This single-process cache deliberately resets
// on restart; a failed refresh never replaces a previously saved source object.
export function createMemoryBucket(maxBytes = 96 * 1024 * 1024) {
  const objects = new Map<string, { bytes: Uint8Array; etag: string; customMetadata: Record<string, string> }>();
  let used = 0;
  const snapshot = (value) => value && ({
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
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : Uint8Array.from(body);
      const nextUsed = used - (previous?.bytes.length ?? 0) + bytes.length;
      if (nextUsed > maxBytes) throw new Error('Temporary listing cache capacity exceeded.');
      const value = { bytes, etag: randomUUID(), customMetadata: { ...options.customMetadata } };
      objects.set(key, value); used = nextUsed;
      return { etag: value.etag };
    },
  };
}
