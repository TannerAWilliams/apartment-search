/**
 * Shared lists, for couples and roommates: one account invites another by email; once they accept, both see one
 * list of apartments, and each can add or remove apartments, vote yes or no on each and leave notes. An account is
 * in at most one shared list. Stored as one document per list, plus one per member pointing to it, named by a hash
 * of the email address.
 */
import * as v from 'valibot';
import { isRecord, type ListingData } from '../src/domain.ts';
import { SearchInputError } from '../src/search.ts';
import type { Bucket } from './contracts.ts';
import { checkedDocument } from './storage/stored-documents.ts';

export const MAX_MEMBERS = 4;
export const MAX_SHARED_LISTINGS = 200;
const MAX_NOTES = 20;

const HouseholdSchema = v.object({
  id: v.string(),
  members: v.array(v.string()),
  invited: v.array(v.string()),
  listings: v.array(v.unknown()),
  votes: v.record(v.string(), v.record(v.string(), v.picklist(['yes', 'no']))),
  notes: v.record(v.string(), v.array(v.object({ by: v.string(), text: v.string(), at: v.string() }))),
  /** Where each member commutes to, so every shared apartment shows each person's trip. */
  workplaces: v.optional(v.record(v.string(), v.object({ label: v.string(), latitude: v.number(), longitude: v.number() })), {}),
});
export type Household = Omit<v.InferOutput<typeof HouseholdSchema>, 'listings'> & { listings: ListingData[] };
const PointerSchema = v.object({ id: v.string() });

async function hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.toLowerCase()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
const householdKey = (id: string) => `households/${id}.json`;
const memberKey = async (email: string) => `households/members/${await hash(email)}.json`;

async function readJson<T extends v.GenericSchema>(bucket: Bucket, key: string, schema: T) {
  const object = await bucket.get(key);
  return object ? checkedDocument(schema, await object.json().catch(() => null), key) : null;
}
const readHousehold = async (bucket: Bucket, id: string) => (await readJson(bucket, householdKey(id), HouseholdSchema)) as Household | null;
async function writeHousehold(bucket: Bucket, household: Household) {
  await bucket.put(householdKey(household.id), JSON.stringify(household));
  return household;
}
async function pointTo(bucket: Bucket, email: string, id: string | null) {
  await bucket.put(await memberKey(email), JSON.stringify(id ? { id } : {}));
}

/** The shared list this account is in or invited to, or null. */
export async function findHousehold(bucket: Bucket, email: string) {
  const pointer = await readJson(bucket, await memberKey(email), PointerSchema);
  const household = pointer ? await readHousehold(bucket, pointer.id) : null;
  return household && (household.members.includes(email) || household.invited.includes(email)) ? household : null;
}

const listingId = (listing: unknown) => (isRecord(listing) && typeof listing.id === 'string' && listing.id ? listing.id : null);

export type HouseholdAction =
  | { action: 'invite'; email: string }
  | { action: 'accept' }
  | { action: 'leave' }
  | { action: 'add'; listing: unknown }
  | { action: 'remove'; id: string }
  | { action: 'vote'; id: string; vote: 'yes' | 'no' | null }
  | { action: 'note'; id: string; text: string }
  | { action: 'workplace'; workplace: { label: string; latitude: number; longitude: number } | null };

/** Applies one change for this account and returns the shared list as it now is (null after leaving). */
export async function changeHousehold(bucket: Bucket, email: string, change: HouseholdAction, now = new Date()) {
  const me = email.toLowerCase();
  const current = await findHousehold(bucket, me);
  if (change.action === 'invite') {
    const partner = change.email.trim().toLowerCase();
    if (partner === me) throw new SearchInputError('Invite someone other than yourself.');
    const other = await findHousehold(bucket, partner);
    if (other && other.id !== current?.id) throw new SearchInputError('That person is already in another shared list.');
    if (current && !current.members.includes(me)) throw new SearchInputError('Accept or leave the invitation you have first.');
    const household: Household = current ?? {
      id: crypto.randomUUID(),
      members: [me],
      invited: [],
      listings: [],
      votes: {},
      notes: {},
      workplaces: {},
    };
    if (household.members.length + household.invited.length >= MAX_MEMBERS && !household.invited.includes(partner))
      throw new SearchInputError(`A shared list can have up to ${MAX_MEMBERS} people.`);
    if (!household.members.includes(partner) && !household.invited.includes(partner)) household.invited.push(partner);
    await pointTo(bucket, me, household.id);
    await pointTo(bucket, partner, household.id);
    return writeHousehold(bucket, household);
  }
  if (!current) throw new SearchInputError('You are not in a shared list yet. Invite someone first.');
  if (change.action === 'leave') {
    const rest = {
      ...current,
      members: current.members.filter((item) => item !== me),
      invited: current.invited.filter((item) => item !== me),
    };
    await pointTo(bucket, me, null);
    await writeHousehold(bucket, rest);
    return null;
  }
  if (change.action === 'accept') {
    if (!current.members.includes(me))
      return writeHousehold(bucket, {
        ...current,
        members: [...current.members, me],
        invited: current.invited.filter((item) => item !== me),
      });
    return current;
  }
  if (!current.members.includes(me)) throw new SearchInputError('Accept the invitation first.');
  if (change.action === 'workplace') {
    const { [me]: _previous, ...others } = current.workplaces;
    return writeHousehold(bucket, { ...current, workplaces: change.workplace ? { ...others, [me]: change.workplace } : others });
  }
  if (change.action === 'add') {
    const id = listingId(change.listing);
    if (!id) throw new SearchInputError('That apartment cannot be shared.');
    const listings = [...current.listings.filter((item) => item.id !== id), change.listing as ListingData].slice(-MAX_SHARED_LISTINGS);
    return writeHousehold(bucket, { ...current, listings });
  }
  if (change.action === 'remove') {
    const { [change.id]: _votes, ...votes } = current.votes;
    const { [change.id]: _notes, ...notes } = current.notes;
    return writeHousehold(bucket, { ...current, listings: current.listings.filter((item) => item.id !== change.id), votes, notes });
  }
  if (!current.listings.some((item) => item.id === change.id)) throw new SearchInputError('That apartment is not in the shared list.');
  if (change.action === 'vote') {
    const { [me]: _previous, ...others } = current.votes[change.id] ?? {};
    const votes = { ...current.votes, [change.id]: change.vote ? { ...others, [me]: change.vote } : others };
    return writeHousehold(bucket, { ...current, votes });
  }
  const note = { by: me, text: change.text.trim().slice(0, 500), at: now.toISOString() };
  const notes = { ...current.notes, [change.id]: [...(current.notes[change.id] ?? []), note].slice(-MAX_NOTES) };
  return writeHousehold(bucket, { ...current, notes });
}
