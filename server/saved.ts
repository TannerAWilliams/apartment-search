/**
 * The listings each account saved, so they follow the person to every device they sign in on. Each account's list
 * is one document, named by a hash of its email address so the address is not part of the key.
 */
import { isRecord, type ListingData } from '../src/domain.ts';
import type { Bucket } from './contracts.ts';
import { log } from './log.ts';

export const MAX_SAVED = 300;

async function savedKey(owner: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner.toLowerCase()));
  return 'saved/' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') + '.json';
}

/** Saved listings with an ID, one per ID (the latest copy), up to MAX_SAVED. */
export function keepSaved(listings: unknown[]) {
  const valid = listings.filter((item) => isRecord(item) && typeof item.id === 'string' && item.id) as ListingData[];
  return [...new Map(valid.map((listing) => [listing.id, listing])).values()].slice(-MAX_SAVED);
}

export async function readSaved(bucket: Bucket, owner: string): Promise<ListingData[]> {
  const key = await savedKey(owner);
  const object = await bucket.get(key);
  if (!object) return [];
  const data = await object.json().catch(() => null);
  if (Array.isArray(data)) return keepSaved(data);
  log.warn('stored_document_invalid', { key });
  return [];
}

export async function writeSaved(bucket: Bucket, owner: string, listings: unknown[]) {
  const kept = keepSaved(listings);
  await bucket.put(await savedKey(owner), JSON.stringify(kept));
  return kept;
}
