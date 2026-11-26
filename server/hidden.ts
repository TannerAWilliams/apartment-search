/**
 * The apartments each account has hidden from its own results, so the choice follows the person to every device.
 * One small document per account, named by a hash of the email address. An apartment is named by its address and
 * unit (src/listings.ts listingKey), so it stays hidden whichever site lists it, and if it is listed again later.
 */
import * as v from 'valibot';
import type { Bucket } from './contracts.ts';
import { log } from './log.ts';

/** The most kept; the oldest are forgotten first. */
export const MAX_HIDDEN = 1000;
export const HiddenSchema = v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(200)));

export async function hiddenKey(owner: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner.toLowerCase()));
  return 'hidden/' + [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') + '.json';
}

export async function readHidden(bucket: Bucket, owner: string): Promise<string[]> {
  const key = await hiddenKey(owner);
  const object = await bucket.get(key);
  if (!object) return [];
  const parsed = v.safeParse(HiddenSchema, await object.json().catch(() => undefined));
  if (parsed.success) return parsed.output;
  log.warn('stored_document_invalid', { key });
  return [];
}

/** Replaces the account's hidden apartments: each once, the newest kept when there are too many. */
export async function writeHidden(bucket: Bucket, owner: string, keys: string[]) {
  const kept = [...new Set(keys)].slice(-MAX_HIDDEN);
  await bucket.put(await hiddenKey(owner), JSON.stringify(kept));
  return kept;
}
