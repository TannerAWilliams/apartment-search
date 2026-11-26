/**
 * Saved listing snapshots: each source's latest listings with their price history, and the affordable
 * housing documents. A snapshot is replaced only if nothing else saved it since it was read.
 */
import type { ListingData } from '../../src/domain.ts';
import type { Bucket, HdcSnapshot, HousingSnapshot, SnapshotFilter } from '../contracts.ts';
import { housingDate } from '../sources/housing.ts';
import { STREETEASY_LIVE } from '../sources/streeteasy.ts';
import { type ObservationHistory, type ObservedListing, type UnitHistory, recordListingHistory } from '../storage/listing-history.ts';
import {
  HdcSnapshotSchema,
  type ManagerSnapshot,
  ManagerSnapshotSchema,
  StoredHousingSchema,
  checkedDocument,
} from '../storage/stored-documents.ts';

export type RentalSnapshot = {
  listings: ListingData[];
  observationHistory?: ObservationHistory;
  pages?: number;
  total?: number;
  rawCount?: number;
  transport?: string;
  checkedAt?: string;
  sampleLimit?: number;
  limited?: boolean;
  partial?: boolean;
  requestedPages?: number;
  failedPages?: number;
};

type StoredRentalSnapshot = Omit<RentalSnapshot, 'listings'> & {
  listings: (ListingData & { priceHistory?: UnitHistory })[];
  /** How many listings the snapshot holds; `listings` has only those a search filter kept. */
  saved?: number;
};

export const OPENIGLOO_KEY = 'openigloo';

export const HOUSING_KEY = 'rentals/housing-connect.json';
export const HDC_KEY = 'rentals/hdc-rerentals.json';
export const MANAGER_KEY = 'rentals/manager-rerentals.json';
export const FEED_PREFIX = 'feeds/';

/** A saved listing snapshot, read back as saveObservedSnapshot wrote it, with the listings the filter keeps. */
async function readListings(bucket: Bucket, key: string, filter?: SnapshotFilter): Promise<StoredRentalSnapshot | null> {
  const snapshot = await bucket.snapshots.read(key, filter);
  if (!snapshot) return null;
  // The summary and listings were written by saveObservedSnapshot from a RentalSnapshot and checked listings.
  const { observation: _observation, ...summary } = snapshot.summary;
  return {
    ...(summary as Omit<StoredRentalSnapshot, 'listings'>),
    listings: snapshot.listings as StoredRentalSnapshot['listings'],
    saved: snapshot.saved,
  };
}

export async function storedOpenigloo(bucket: Bucket | undefined, filter?: SnapshotFilter): Promise<StoredRentalSnapshot | null> {
  return bucket ? readListings(bucket, OPENIGLOO_KEY, filter) : null;
}

export async function storedDirectRentals(
  bucket: Bucket | undefined,
  source: { id: string },
  filter?: SnapshotFilter,
): Promise<StoredRentalSnapshot | null> {
  return bucket ? readListings(bucket, source.id, filter) : null;
}

export async function storedFeed(bucket: Bucket, feed: { id: string }, filter?: SnapshotFilter): Promise<StoredRentalSnapshot> {
  const snapshot = await readListings(bucket, FEED_PREFIX + feed.id, filter);
  if (!snapshot) throw new Error('This feed has not completed its first refresh.');
  return snapshot;
}

/** How old the city's lottery list may be and still be shown as what is open now. */
export const HOUSING_FRESH_DAYS = 7;

export async function storedHousing(bucket: Bucket | undefined, now = new Date()): Promise<HousingSnapshot> {
  const object = await bucket?.get(HOUSING_KEY);
  if (!object) return { publishedAt: null, checkedAt: null, opportunities: [] };
  const data = checkedDocument(StoredHousingSchema, await object.json().catch(() => null), HOUSING_KEY);
  if (!data) return { publishedAt: null, checkedAt: null, opportunities: [] };
  const today = housingDate(now);
  // The city publishes this list about monthly, and a lottery can close sooner than the list says: one shown as
  // open until Dec 18, 2026 had ended on Nov 19. So a list older than a week names no lottery as open; the page
  // says so and sends people to Housing Connect, which is current.
  const published = Date.parse(data.publishedAt ?? '');
  const stale = !(now.getTime() - published <= HOUSING_FRESH_DAYS * 86_400_000);
  return {
    ...data,
    checkedAt: object.customMetadata.updatedAt,
    opportunities: stale ? [] : data.opportunities.filter(({ closes }) => closes >= today),
    ...(stale ? { stale: true } : {}),
  };
}

export async function storedHdcRerentals(bucket: Bucket | undefined): Promise<HdcSnapshot | null> {
  const object = await bucket?.get(HDC_KEY);
  return object ? checkedDocument(HdcSnapshotSchema, await object.json().catch(() => null), HDC_KEY) : null;
}

export async function storedManagerRerentals(bucket: Bucket | undefined): Promise<ManagerSnapshot | null> {
  const object = await bucket?.get(MANAGER_KEY);
  return object ? checkedDocument(ManagerSnapshotSchema, await object.json().catch(() => null), MANAGER_KEY) : null;
}

export async function saveObservedSnapshot(
  bucket: Bucket,
  key: string,
  result: object,
  listings: ListingData[],
  sourceId: string,
  at: string,
) {
  const stored = await bucket.snapshots.read(key, { history: true });
  // Written below: listings this Worker checked, and their price history.
  const previous = stored && {
    listings: stored.listings as ObservedListing[],
    observationHistory: {
      ...(stored.summary.observation as Omit<ObservationHistory, 'entries'>),
      entries: stored.history as UnitHistory[],
    },
  };
  const carriesForward =
    ('partial' in result && result.partial === true) || ('limited' in result && result.limited === true && sourceId === STREETEASY_LIVE.id);
  const observed = recordListingHistory(listings, previous?.observationHistory, sourceId, at, { keepUnseen: carriesForward });
  if (carriesForward) {
    const ids = new Set(observed.listings.map((listing) => listing.id));
    const retained = (previous?.listings ?? [])
      .filter((listing) => !ids.has(listing.id))
      .map((listing) => ({ ...listing, kind: 'cached', sources: listing.sources.map((source) => ({ ...source, kind: 'cached' })) }));
    observed.listings.push(...retained);
  }
  const { entries, ...observation } = observed.observationHistory;
  const { listings: _listings, observationHistory: _history, ...summary } = result as Record<string, unknown>;
  const saved = await bucket.snapshots.write(
    key,
    { summary: { ...summary, observation }, listings: observed.listings, history: entries },
    stored ? { etagMatches: stored.etag } : { etagDoesNotMatch: '*' },
  );
  if (!saved) throw new Error('Source snapshot changed during refresh. Retry the manual refresh.');
}
