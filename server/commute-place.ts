/**
 * Each account's commute destination (where they work or study), so commute times follow the person to every
 * device they sign in on. One small document per account, named by a hash of the email address.
 */
import * as v from 'valibot';
import type { Bucket } from './contracts.ts';
import { log } from './log.ts';

export const CommutePlaceSchema = v.object({
  /** A preset destination's key, or 'custom' for a typed place or address. */
  workplace: v.pipe(v.string(), v.minLength(1), v.maxLength(40)),
  customWorkplace: v.pipe(v.string(), v.maxLength(160)),
});
export type CommutePlace = v.InferOutput<typeof CommutePlaceSchema>;

export async function placeKey(owner: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner.toLowerCase()));
  return 'commute/' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') + '.json';
}

export async function readCommutePlace(bucket: Bucket, owner: string): Promise<CommutePlace | null> {
  const key = await placeKey(owner);
  const object = await bucket.get(key);
  if (!object) return null;
  const data: unknown = await object.json().catch(() => undefined);
  // A forgotten destination is kept as null.
  if (data === null) return null;
  const parsed = v.safeParse(CommutePlaceSchema, data);
  if (parsed.success) return parsed.output;
  log.warn('stored_document_invalid', { key });
  return null;
}

/** Keeps the destination, or forgets it when `place` is null (the bucket has no delete; null is stored over it). */
export async function writeCommutePlace(bucket: Bucket, owner: string, place: CommutePlace | null) {
  const key = await placeKey(owner);
  if (place) await bucket.put(key, JSON.stringify(place));
  else if (await bucket.get(key)) await bucket.put(key, 'null');
  return place;
}
