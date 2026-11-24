/**
 * No-fee listings posted on Walkup by landlords and owners. Anyone signed in can submit an apartment; an admin
 * approves or rejects it; approved ones appear in search as "Walkup direct", with the landlord's email as the
 * listing's link, for 60 days unless renewed. The address is placed on the map when it is submitted.
 */
import * as v from 'valibot';
import type { ListingData } from '../src/domain.ts';
import { SearchInputError } from '../src/search.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { geocodeAddress } from './commute.ts';
import type { Bucket } from './contracts.ts';
import { nycBorough } from './sources/firstmover.ts';
import { checkedDocument } from './storage/stored-documents.ts';

const KEY = 'direct/listings.json';
export const DIRECT_SOURCE = { id: 'walkup-direct', name: 'Walkup direct', kind: 'feed' };
export const LISTED_DAYS = 60;
/** Submissions an account may have waiting for review at once. */
const MAX_PENDING = 5;

const text = (max: number, message: string) => v.pipe(v.string(message), v.trim(), v.minLength(1, message), v.maxLength(max, message));
export const DirectListingInputSchema = v.object({
  address: text(120, 'Give the street address.'),
  unit: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(20)), ''),
  zip: v.pipe(v.string('Give a five-digit ZIP code.'), v.regex(/^\d{5}$/, 'Give a five-digit ZIP code.')),
  bedrooms: v.pipe(v.number('Give the bedrooms.'), v.integer(), v.minValue(0), v.maxValue(4, 'Up to 4 bedrooms.')),
  bathrooms: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(6))),
  rent: v.pipe(v.number('Give the monthly rent.'), v.minValue(500, 'Give the monthly rent.'), v.maxValue(50_000, 'Give the monthly rent.')),
  available: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40)), ''),
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(1000)), ''),
  email: v.pipe(v.string('Give an email for renters.'), v.trim(), v.email('Give an email for renters.'), v.maxLength(254)),
  phone: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(30)), ''),
});
export type DirectListingInput = v.InferOutput<typeof DirectListingInputSchema>;

const EntrySchema = v.object({
  id: v.string(),
  owner: v.string(),
  status: v.picklist(['pending', 'approved', 'rejected']),
  submittedAt: v.string(),
  approvedAt: v.optional(v.string()),
  input: v.object({ ...DirectListingInputSchema.entries }),
  latitude: v.nullable(v.number()),
  longitude: v.nullable(v.number()),
});
export type DirectEntry = v.InferOutput<typeof EntrySchema>;
const ListSchema = v.array(EntrySchema);

export async function readDirect(bucket: Bucket): Promise<DirectEntry[]> {
  const object = await bucket.get(KEY);
  return (object && checkedDocument(ListSchema, await object.json().catch(() => null), KEY)) ?? [];
}
const writeDirect = (bucket: Bucket, entries: DirectEntry[]) => bucket.put(KEY, JSON.stringify(entries));

/** Saves a submission for review. New York City addresses only. */
export async function submitDirect(bucket: Bucket, owner: string, input: DirectListingInput, fetcher: FetchTransport, now = new Date()) {
  const borough = nycBorough(input.zip);
  if (!borough) throw new SearchInputError('Walkup direct takes New York City apartments only.');
  const entries = await readDirect(bucket);
  if (entries.filter((entry) => entry.owner === owner && entry.status === 'pending').length >= MAX_PENDING)
    throw new SearchInputError(`You can have up to ${MAX_PENDING} apartments waiting for review.`);
  const place = await geocodeAddress(`${input.address}, ${borough}, NY ${input.zip}`, fetcher).catch(() => null);
  const entry: DirectEntry = {
    id: crypto.randomUUID(),
    owner,
    status: 'pending',
    submittedAt: now.toISOString(),
    input,
    latitude: place?.latitude ?? null,
    longitude: place?.longitude ?? null,
  };
  await writeDirect(bucket, [...entries, entry]);
  return entry;
}

/** An admin's decision, or the owner taking a listing down or renewing it for another 60 days. */
export async function decideDirect(
  bucket: Bucket,
  id: string,
  decision: 'approve' | 'reject' | 'remove' | 'renew',
  { admin, account, now = new Date() }: { admin: boolean; account: string; now?: Date },
) {
  const entries = await readDirect(bucket);
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new SearchInputError('That listing was not found.');
  const mine = entry.owner === account;
  if ((decision === 'approve' || decision === 'reject') && !admin) throw new SearchInputError('Only an admin can review listings.');
  if ((decision === 'remove' || decision === 'renew') && !mine && !admin) throw new SearchInputError('That listing is not yours.');
  const next =
    decision === 'remove'
      ? entries.filter((item) => item.id !== id)
      : entries.map((item) =>
          item.id !== id
            ? item
            : decision === 'reject'
              ? { ...item, status: 'rejected' as const }
              : decision === 'approve' || item.status === 'approved'
                ? { ...item, status: 'approved' as const, approvedAt: now.toISOString() }
                : item,
        );
  await writeDirect(bucket, next);
  return next.find((item) => item.id === id) ?? null;
}

/** Approved listings still within their 60 days, as search listings. */
export async function directListings(bucket: Bucket, now = new Date()): Promise<ListingData[]> {
  const cutoff = now.getTime() - LISTED_DAYS * 86_400_000;
  return (await readDirect(bucket))
    .filter(({ status, approvedAt }) => status === 'approved' && Date.parse(approvedAt ?? '') >= cutoff)
    .map(({ id, input, latitude, longitude, approvedAt }) => {
      const subject = encodeURIComponent(`Apartment at ${input.address}${input.unit ? ', ' + input.unit : ''} (via Walkup)`);
      return {
        id: 'walkup-direct:' + id,
        address: input.address,
        unit: input.unit || undefined,
        city: nycBorough(input.zip)!,
        state: 'NY',
        zip: input.zip,
        region: 'nyc',
        rent: input.rent,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms ?? null,
        latitude,
        longitude,
        kind: 'feed',
        seenAt: approvedAt,
        checkedAt: approvedAt,
        company: 'Owner (no fee)',
        noFee: true,
        contact: {
          email: input.email,
          phone: input.phone || undefined,
          available: input.available || undefined,
          description: input.description || undefined,
        },
        sources: [{ ...DIRECT_SOURCE, url: `mailto:${input.email}?subject=${subject}` }],
      } satisfies ListingData;
    });
}
