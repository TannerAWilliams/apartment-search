/**
 * A watch on saved apartments: when one drops its rent, or is no longer listed, its account is told once, with
 * the alerts. What was last seen of each saved apartment is kept per account, so a drop is measured from the
 * rent it had, and nothing is said twice.
 */
import * as v from 'valibot';
import type { ListingData } from '../src/domain.ts';
import { listingKey } from '../src/listings.ts';
import type { Alert } from './alerts.ts';
import { mapLimit } from './concurrency.ts';
import type { Bucket } from './contracts.ts';
import { readSaved, watchKey } from './saved.ts';
import { checkedDocument } from './storage/stored-documents.ts';

/** Checks in a row an apartment must be missing before it is called gone: one source failing to answer is not that. */
export const MISSING_CHECKS = 3;
const SeenSchema = v.record(v.string(), v.object({ rent: v.number(), missing: v.number(), gone: v.boolean() }));
const money = (rent: number) => '$' + rent.toLocaleString('en-US');
const label = (listing: ListingData) =>
  [listing.address, listing.unit ? `Unit ${listing.unit}` : '', listing.city].filter(Boolean).join(', ');

/** One account's alert about its saved apartments, or null when nothing changed; keeps what it saw. */
async function watchOne(bucket: Bucket, owner: string, current: Map<string, ListingData>, now: Date): Promise<Alert | null> {
  const saved = await readSaved(bucket, owner);
  if (!saved.length) return null;
  const key = await watchKey(owner);
  const object = await bucket.get(key);
  const before = (object && checkedDocument(SeenSchema, await object.json().catch(() => null), key)) ?? {};
  const seen: v.InferOutput<typeof SeenSchema> = {};
  const drops: { text: string; url: string }[] = [];
  const gone: { text: string; url: string }[] = [];
  for (const listing of saved) {
    const was = before[listing.id] ?? { rent: listing.rent, missing: 0, gone: false };
    const listed = current.get(listing.id) ?? current.get(listingKey(listing));
    if (listed) {
      if (listed.rent < was.rent)
        drops.push({
          text: `${label(listing)}: ${money(was.rent)} → ${money(listed.rent)}`,
          url: '/listing/' + encodeURIComponent(listed.id),
        });
      seen[listing.id] = { rent: listed.rent, missing: 0, gone: false };
    } else {
      const missing = was.missing + 1;
      const nowGone = missing >= MISSING_CHECKS;
      if (nowGone && !was.gone) gone.push({ text: `${label(listing)}: no longer listed`, url: '' });
      seen[listing.id] = { rent: was.rent, missing, gone: was.gone || nowGone };
    }
  }
  await bucket.put(key, JSON.stringify(seen));
  if (!drops.length && !gone.length) return null;
  const parts = [
    drops.length && `${drops.length} price ${drops.length === 1 ? 'drop' : 'drops'}`,
    gone.length && `${gone.length} no longer listed`,
  ].filter(Boolean);
  const lines = [...drops, ...gone];
  return {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    ruleId: 'saved',
    title: `Your saved apartments: ${parts.join(', ')}`,
    lines: lines.map(({ text }) => text),
    urls: lines.map(({ url }) => url),
    newCount: 0,
    dropCount: drops.length,
    owner,
  };
}

/** Each account's saved apartments against what is listed now. An empty inventory says nothing about any of them. */
export async function savedAlerts(bucket: Bucket, owners: string[], inventory: ListingData[], now = new Date()) {
  if (!inventory.length) return [];
  const current = new Map<string, ListingData>();
  for (const listing of inventory) {
    current.set(listing.id, listing);
    current.set(listingKey(listing), listing);
  }
  const alerts = await mapLimit(owners, 4, (owner) => watchOne(bucket, owner.toLowerCase(), current, now).catch(() => null));
  return alerts.filter((alert) => alert !== null);
}
