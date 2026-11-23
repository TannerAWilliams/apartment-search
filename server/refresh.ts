import type { PackedRentRow, RentHistory } from '../src/rent-history.ts';
import type { ListingData } from '../src/domain.ts';
import type { AppEnv, Bucket, BucketObject, BucketHead, HousingSnapshot, HdcSnapshot, SnapshotFilter } from './contracts.ts';
import { withoutCommuteEstimate } from '../src/commute-estimate.ts';
import { type ObservationHistory, type ObservedListing, type UnitHistory, recordListingHistory } from './storage/listing-history.ts';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { decodeMarketRows, packRentMonth, SNAPSHOT_MONTH, type MarketRow } from '../src/market.ts';
import { priorRentMonths } from '../src/rent-history.ts';
import { bundledRentAreas, marketSnapshot } from '../src/bundled-market.ts';
import { checkFirstMover, checkPublishedFirstMover } from './sources/firstmover.ts';
import {
  configuredFeeds,
  loadFeed,
  loadStreetEasyExport,
  STREETEASY_EXPORT_COVERAGE,
  STREETEASY_EXPORT_FORMAT,
  STREETEASY_EXPORT_MAX_AGE,
} from './sources/listings.ts';
import { housingDate, loadHousingConnect } from './sources/housing.ts';
import { HDC_RERENTALS, loadHdcRerentals } from './sources/hdc-rerentals.ts';
import { JERSEY_AFFORDABLE, refreshJerseyAffordable } from './sources/jersey-affordable.ts';
import { refreshHomeSeeker, WESTCHESTER_HOMESEEKER } from './sources/westchester-homeseeker.ts';
import { DIRECT_RENTAL_SOURCES } from './sources/direct-rentals.ts';
import {
  loadOpenigloo,
  OPENIGLOO_COVERAGE,
  OPENIGLOO_MAX_LISTINGS,
  OPENIGLOO_MIN_COVERAGE,
  OPENIGLOO_TRANSPORT,
} from './sources/openigloo.ts';
import { requestForRefresh, retrySchedule } from './sources/source-requests.ts';
import { checkedDocument, HdcSnapshotSchema, RefreshStateSchema, StoredHousingSchema } from './storage/stored-documents.ts';
import { log } from './log.ts';
import { MARKETPLACE_NAMES } from '../src/marketplaces.ts';
import { COMPLETE_SYNC_LIFETIME, completeSync, fullInventory, isCompleteSnapshot, WORKFLOW_SOURCE_IDS } from './sources/source-registry.ts';
import type { SourceDefinition } from '../src/source-status.ts';
import {
  loadStreetEasyPublicSearch,
  STREETEASY_LIVE,
  STREETEASY_PUBLIC_COVERAGE,
  STREETEASY_PUBLIC_TRANSPORT,
} from './sources/streeteasy.ts';

export { WORKFLOW_SOURCE_IDS };

type RentalSnapshot = {
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

const STREETEASY_TRANSPORT = 'v6-daily';
const STREETEASY_PARTNER_TRANSPORT = 'partner-feed';
const STREETEASY_SYNC_INTERVAL = 24 * 60 * 60_000;
const STATE_KEY = 'rentals/refresh.json';
const MARKET_KEY = 'rentals/firstmover.json.gz';
const MARKET_SCHEMA = 'companies-1';
const HISTORY_PREFIX = 'rentals/market-history/';
const OPENIGLOO_KEY = 'openigloo';
const DIRECT_BY_ID = new Map(DIRECT_RENTAL_SOURCES.map((source) => [source.id, source]));
const HOUSING_KEY = 'rentals/housing-connect.json';
const HDC_KEY = 'rentals/hdc-rerentals.json';
const FEED_PREFIX = 'feeds/';
const LOCK_TIMEOUT = 5 * 60_000;

const LIVE_MAX_AGE = 2 * 60 * 60_000;
const FEED_REQUIRED_IDS = ['bhs', 'citysnap', 'craigslist', 'rebny-rls'] as const;
const PAGE_FETCH_TIMEOUT = 25_000;
export type SourceFetch = (url: string, options?: RequestInit) => Response | Promise<Response>;

type CheckResult = {
  transport?: string;
  status: string;
  updatedAt: string | null;
  listingCount?: number;
  pages?: number;
  total?: number;
  sampleLimit?: number;
  partial?: boolean;
  requestedPages?: number;
  failedPages?: number;
  month?: string;
  revision?: string;
  catalogEtag?: string;
  csvEtag?: string;
};

export type SourceStatus = CheckResult & {
  requestTransport?: 'direct' | 'import' | 'partner-feed' | 'public-search' | typeof STREETEASY_EXPORT_FORMAT;
  id: string;
  name: string;
  checkedAt: string | null;
  marketplace?: string;
  transport?: string;
  retryAt?: string;
  retryAttempts?: number;
  error?: string;
};

type RefreshState = {
  sources?: SourceStatus[];
  running?: boolean;
  startedAt?: string;
  lastCheckedAt?: string;
  market?: Pick<CheckResult, 'revision' | 'catalogEtag' | 'csvEtag'> | null;
  activeSource?: string | null;
};

type RefreshOptions = {
  fetcher?: SourceFetch;
  now?: Date;
  /** Snapshots uploaded by the home sync, keyed by source id; each stands in for what that source's loader returns. */
  imports?: Readonly<Record<string, unknown>>;
  onDemand?: boolean;
  onlyStreetEasy?: boolean;
  sourceId?: string;
  fallback?: boolean;
  /** Skip the complete syncs because the Workflow runs them. */
  excludeWorkflowSources?: boolean;
};

let cachedMarket: { bucket: Bucket; etag: string; market: { month: string; listings: ListingData[] } } | undefined;

const compressed = (value: unknown) => gzipSync(strToU8(JSON.stringify(value)));
/** A gzipped JSON snapshot this Worker wrote, read back with the type it was written with. */
const unpack = async <T>(object: BucketObject) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer())))) as T;

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

async function readState(bucket: Bucket | undefined): Promise<{ value: RefreshState; etag: string | null }> {
  const object = await bucket?.get(STATE_KEY);
  if (!object) return { value: {}, etag: null };
  // A status document that does not match is read as empty, so the next check rebuilds it.
  const value = checkedDocument(RefreshStateSchema, await object.json().catch(() => null), STATE_KEY) as RefreshState | null;
  return { value: value ?? {}, etag: object.etag };
}

function checkInProgress(state: RefreshState, now: Date) {
  const sync = completeSync(state.activeSource);
  return state.running && now.getTime() - Date.parse(state.startedAt ?? '') < (sync ? sync.timeoutMs + 30_000 : LOCK_TIMEOUT);
}

function publicStatus(state: RefreshState, now = new Date()) {
  const sources = (state.sources ?? []).map((source) =>
    source.status === 'feed_required' && DIRECT_BY_ID.has(source.id) ? { ...source, status: 'pending' } : source,
  );
  return {
    lastCheckedAt: state.lastCheckedAt ?? null,
    sources,
    ...(checkInProgress(state, now) ? { checking: true, activeSource: state.activeSource ?? null } : {}),
  };
}

export async function refreshStatus(bucket: Bucket | undefined) {
  return publicStatus((await readState(bucket)).value);
}

function checkedDuring(sources: SourceStatus[] | undefined, ids: string[], hour: string) {
  return ids.every((id) =>
    sources?.some((source) => source.id === id && source.status !== 'failed' && source.checkedAt?.slice(0, 13) === hour),
  );
}

const coolingDown = (source: SourceStatus | undefined, now: Date) => Date.parse(source?.retryAt ?? '') > now.getTime();

/** How long a check counts as current: a day for full inventories and StreetEasy's daily sync, two hours for samples. */
const sourceLifetime = (id: string, transport: string | undefined) =>
  fullInventory(id)
    ? COMPLETE_SYNC_LIFETIME
    : id === STREETEASY_LIVE.id && transport === STREETEASY_EXPORT_FORMAT
      ? STREETEASY_EXPORT_MAX_AGE
      : id === STREETEASY_LIVE.id &&
          (transport === STREETEASY_TRANSPORT || transport === STREETEASY_PARTNER_TRANSPORT || transport === STREETEASY_PUBLIC_TRANSPORT)
        ? STREETEASY_SYNC_INTERVAL
        : LIVE_MAX_AGE;

export function sourceRecent(status: { sources: SourceStatus[] } | null | undefined, id: string, now = new Date()) {
  const source = status?.sources.find((item) => item.id === id);
  const age = now.getTime() - Date.parse(source?.updatedAt ?? '');
  return (source?.status === 'updated' || source?.status === 'current') && age >= 0 && age <= sourceLifetime(id, source.transport);
}

/** Expiry of a currently usable observation, never an extension of its checked time. */
export function sourceExpiresAt(status: { sources: SourceStatus[] } | null | undefined, id: string, now = new Date()): string | null {
  if (!sourceRecent(status, id, now)) return null;
  const source = status!.sources.find((item) => item.id === id)!;
  const lifetime = sourceLifetime(id, source.transport);
  return new Date(Date.parse(source.updatedAt!) + lifetime).toISOString();
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

export async function refreshPlan(bucket: Bucket | undefined, now = new Date()) {
  const [{ value }, object] = await Promise.all([readState(bucket), bucket?.head(MARKET_KEY)]);
  const market = marketBaseline(object, value.market);
  const hour = now.toISOString().slice(0, 13);
  // Configured feeds are not in SOURCES, which does not depend on the settings; the saved status lists them.
  const feeds = value.sources?.map(({ id }) => id).filter((id) => !SOURCES.some((source) => source.id === id)) ?? [];
  const publicIds = SOURCES.filter(({ kind }) => kind === 'public').map(({ id }) => id);
  return {
    ready: Boolean(bucket),
    market,
    alreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, [...SOURCES.map(({ id }) => id), ...feeds], hour),
    publicAlreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, publicIds, hour),
    ...publicStatus(value, now),
  };
}

export async function storedMarket(bucket: Bucket | undefined) {
  const head = await bucket?.head(MARKET_KEY);
  if (!head) return { month: SNAPSHOT_MONTH, listings: marketSnapshot() };
  if (cachedMarket && cachedMarket.bucket === bucket && cachedMarket.etag === head.etag) return cachedMarket.market;

  const object = await bucket!.get(MARKET_KEY);
  if (!object) return { month: SNAPSHOT_MONTH, listings: marketSnapshot() };
  const market = { month: object.customMetadata.month, listings: decodeMarketRows(await unpack<MarketRow[]>(object)) };
  cachedMarket = { bucket: bucket!, etag: object.etag, market };
  return market;
}

export async function storedRentHistory(
  bucket: Bucket | undefined,
  latest: string,
  region: string,
  grouping: string,
): Promise<RentHistory> {
  return Promise.all(
    priorRentMonths(latest).map(async (month) => {
      const object = month >= SNAPSHOT_MONTH ? await bucket?.get(HISTORY_PREFIX + month + '.json.gz') : null;
      const areas = object
        ? (await unpack<Record<string, Record<string, PackedRentRow[]> | undefined>>(object))[region]?.[grouping]
        : bundledRentAreas(month, region, grouping);
      return [month, areas ?? []] as const;
    }),
  );
}

export async function storedFeed(bucket: Bucket, feed: { id: string }, filter?: SnapshotFilter): Promise<StoredRentalSnapshot> {
  const snapshot = await readListings(bucket, FEED_PREFIX + feed.id, filter);
  if (!snapshot) throw new Error('This feed has not completed its first refresh.');
  return snapshot;
}

function marketBaseline(
  object: BucketHead | null | undefined,
  previous: RefreshState['market'],
): { month: string; revision: string; updatedAt: string; catalogEtag?: string; csvEtag?: string } | null {
  const metadata = object?.customMetadata;
  if (metadata?.schema !== MARKET_SCHEMA) return null;
  const sameRelease = previous?.revision === metadata.revision;
  return {
    ...metadata,
    month: metadata.month,
    revision: metadata.revision,
    updatedAt: metadata.updatedAt,
    catalogEtag: sameRelease ? previous?.catalogEtag : '',
    csvEtag: sameRelease ? previous?.csvEtag : '',
  };
}

async function refreshMarket(
  bucket: Bucket,
  previous: RefreshState['market'],
  checkedAt: string,
  fetcher: SourceFetch,
  imported: Awaited<ReturnType<typeof checkFirstMover>> | undefined,
  isImport: boolean,
  onDemand: boolean,
) {
  const stored = await bucket.head(MARKET_KEY);
  const baseline = marketBaseline(stored, previous);
  const check = onDemand ? checkPublishedFirstMover : checkFirstMover;
  const result = isImport ? imported : await check(baseline, fetcher);
  const month = result?.month,
    revision = result?.revision;
  if (
    !result ||
    typeof month !== 'string' ||
    !/^20\d{2}-(0[1-9]|1[0-2])$/.test(month) ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/.test(revision) ||
    (baseline && month < baseline.month)
  )
    throw new Error('The FirstMover import failed.');
  if (!result.changed && revision !== baseline?.revision) throw new Error('The FirstMover release has changed.');
  if (
    result.changed &&
    (!Array.isArray(result.rows) ||
      result.rows.length === 0 ||
      result.rows.length > 60000 ||
      result.rows.some(
        (row: unknown) =>
          !Array.isArray(row) || row.length !== 15 || typeof row[12] !== 'string' || !/^\/(rental|building)\//.test(row[12]),
      ))
  ) {
    throw new Error('The FirstMover import had invalid listings.');
  }
  const updatedAt = result.changed ? checkedAt : baseline!.updatedAt;
  if (result.changed) {
    if (stored && stored.customMetadata.month >= SNAPSHOT_MONTH && stored.customMetadata.month < month) {
      const previousMarket = await storedMarket(bucket);
      await bucket.put(HISTORY_PREFIX + previousMarket.month + '.json.gz', compressed(packRentMonth(previousMarket.listings)));
    }
    await bucket.put(MARKET_KEY, compressed(result.rows), {
      customMetadata: { month: month, revision: revision, updatedAt, schema: MARKET_SCHEMA },
    });
  }
  return {
    status: result.changed ? 'updated' : 'current',
    month: month,
    revision: revision,
    catalogEtag: 'catalogEtag' in result ? result.catalogEtag : undefined,
    csvEtag: result.csvEtag,
    updatedAt,
  };
}

export async function storedHousing(bucket: Bucket | undefined, now = new Date()): Promise<HousingSnapshot> {
  const object = await bucket?.get(HOUSING_KEY);
  if (!object) return { publishedAt: null, checkedAt: null, opportunities: [] };
  const data = checkedDocument(StoredHousingSchema, await object.json().catch(() => null), HOUSING_KEY);
  if (!data) return { publishedAt: null, checkedAt: null, opportunities: [] };
  const today = housingDate(now);
  return { ...data, checkedAt: object.customMetadata.updatedAt, opportunities: data.opportunities.filter(({ closes }) => closes >= today) };
}

export async function storedHdcRerentals(bucket: Bucket | undefined): Promise<HdcSnapshot | null> {
  const object = await bucket?.get(HDC_KEY);
  return object ? checkedDocument(HdcSnapshotSchema, await object.json().catch(() => null), HDC_KEY) : null;
}

async function refreshHousing(
  bucket: Bucket,
  checkedAt: string,
  fetcher: SourceFetch,
  now: Date,
  imported: HousingSnapshot | undefined,
  isImport: boolean,
) {
  const result = isImport ? imported : await loadHousingConnect(fetcher, now);
  if (
    !Array.isArray(result?.opportunities) ||
    result.opportunities.length > 250 ||
    result.opportunities.some(({ id, url }) => !/^\d{1,12}$/.test(id) || url !== 'https://housingconnect.nyc.gov/PublicWeb/details/' + id)
  ) {
    throw new Error('NYC Open Data could not be imported.');
  }
  const data = JSON.stringify(result);
  const previous = await bucket.get(HOUSING_KEY);
  if (previous && (await previous.text()) === data) {
    return { status: 'current', updatedAt: previous.customMetadata.updatedAt };
  }
  await bucket.put(HOUSING_KEY, data, { customMetadata: { updatedAt: checkedAt } });
  return { status: 'updated', updatedAt: checkedAt };
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

async function refreshOpenigloo(bucket: Bucket, result: RentalSnapshot, at: string) {
  const total = result?.total;
  if (
    result?.transport !== OPENIGLOO_TRANSPORT ||
    !Number.isSafeInteger(total) ||
    total! < 0 ||
    total! > OPENIGLOO_MAX_LISTINGS ||
    !Array.isArray(result.listings) ||
    result.listings.length < total! * OPENIGLOO_MIN_COVERAGE ||
    new Set(result.listings.map((listing) => listing?.id)).size !== result.listings.length ||
    result.listings.some(
      (listing) =>
        listing.kind !== 'feed' ||
        listing.region !== 'nyc' ||
        !Array.isArray(listing.sources) ||
        listing.sources[0]?.id !== 'openigloo' ||
        !/^https:\/\/www\.openigloo\.com\/unit\/nyc\//.test(listing.sources[0]?.url ?? ''),
    )
  ) {
    throw new Error('Openigloo did not return a verifiable complete inventory.');
  }
  const listings = result.listings.map((listing: ListingData) => ({ ...withoutCommuteEstimate(listing), checkedAt: at }));
  await saveObservedSnapshot(bucket, OPENIGLOO_KEY, result, listings, 'openigloo', at);
  return {
    status: 'updated',
    updatedAt: at,
    listingCount: result.listings.length,
    total,
    pages: result.pages,
    transport: result.transport,
  };
}

async function refreshDirectRentals(
  bucket: Bucket,
  source: (typeof DIRECT_RENTAL_SOURCES)[number],
  result: RentalSnapshot,
  at: string,
  verifiedPartner = false,
) {
  const complete = fullInventory(source.id);
  const verifiedComplete = isCompleteSnapshot(source.id, result?.transport);
  if (
    complete &&
    (!verifiedComplete ||
      !Number.isSafeInteger(result.total) ||
      result.rawCount !== result.total ||
      result.listings.length > result.rawCount!)
  ) {
    throw new Error(complete.name + ' did not return a verifiable complete inventory.');
  }
  const verifiedStreetEasy = source.id === STREETEASY_LIVE.id && result?.transport === STREETEASY_TRANSPORT;
  if (
    verifiedStreetEasy &&
    (!Number.isSafeInteger(result.total) ||
      result.total! < 0 ||
      result.total! > 20000 ||
      result.rawCount !== result.total ||
      !Array.isArray(result.listings) ||
      result.listings.length > result.total! ||
      !Number.isFinite(Date.parse(result.checkedAt ?? '')) ||
      Date.parse(result.checkedAt ?? '') > Date.parse(at) ||
      Date.parse(at) - Date.parse(result.checkedAt ?? '') > 10 * 60_000)
  ) {
    throw new Error('StreetEasy import is incomplete or stale.');
  }
  const validPartial =
    source.id !== STREETEASY_LIVE.id &&
    result?.partial === true &&
    Number.isInteger(result.requestedPages) &&
    result.requestedPages! >= source.minPages &&
    result.requestedPages! <= source.maxPages &&
    Number.isInteger(result.failedPages) &&
    result.failedPages! > 0 &&
    result.pages! + result.failedPages! === result.requestedPages;
  if (
    !Number.isInteger(result?.pages) ||
    result.pages! < (validPartial ? 1 : source.minPages) ||
    result.pages! > source.maxPages ||
    !Array.isArray(result.listings) ||
    (!result.listings.length && result.total !== 0) ||
    (!verifiedPartner && result.listings.length > result.pages! * source.rowsPerPage) ||
    new Set(result.listings.map((listing: ListingData) => listing?.id)).size !== result.listings.length ||
    result.listings.some(
      (listing) =>
        listing?.kind !== 'feed' ||
        !source.regions.includes(listing.region ?? '') ||
        typeof listing.id !== 'string' ||
        !listing.id.startsWith(source.marketplace + ':') ||
        typeof listing.address !== 'string' ||
        !listing.address ||
        typeof listing.unit !== 'string' ||
        typeof listing.city !== 'string' ||
        !listing.city ||
        !/^\d{5}$/.test(listing.zip) ||
        !Number.isFinite(listing.rent) ||
        listing.rent <= 0 ||
        listing.rent > ('maxRent' in source ? source.maxRent : 100000) ||
        !Number.isInteger(listing.bedrooms) ||
        listing.bedrooms < 0 ||
        listing.bedrooms > (('maxBedrooms' in source ? (source.maxBedrooms as number) : undefined) ?? 4) ||
        !Array.isArray(listing.sources) ||
        !listing.sources.length ||
        listing.sources.some((link) => link?.id !== source.marketplace || link.kind !== 'feed' || !source.listingUrl(link.url)) ||
        !Number.isFinite(Date.parse(listing.seenAt ?? '')),
    )
  ) {
    throw new Error(source.name + ' did not return a valid live sample.');
  }
  const listings = result.listings.map((listing: ListingData) => ({ ...withoutCommuteEstimate(listing), checkedAt: at }));
  await saveObservedSnapshot(bucket, source.id, result, listings, source.id, at);
  return {
    status: 'updated',
    updatedAt: at,
    listingCount: result.listings.length,
    pages: result.pages,
    total: result.total,
    ...(validPartial ? { partial: true, requestedPages: result.requestedPages, failedPages: result.failedPages } : {}),
    ...(result.sampleLimit !== undefined ? { sampleLimit: result.sampleLimit } : {}),
    ...(verifiedStreetEasy || verifiedPartner || verifiedComplete ? { transport: result.transport } : {}),
  };
}

type PartnerFeed = ReturnType<typeof configuredFeeds>[number];

/** How StreetEasy is read: an authorized complete export or partner feed, its public search page, or the v6 API. */
function streetEasyTransportFor(env: AppEnv, partner: PartnerFeed | undefined) {
  if (partner) return partner.format === STREETEASY_EXPORT_FORMAT ? STREETEASY_EXPORT_FORMAT : STREETEASY_PARTNER_TRANSPORT;
  return env.STREETEASY_PUBLIC_SEARCH === 'true' ? STREETEASY_PUBLIC_TRANSPORT : STREETEASY_TRANSPORT;
}

/** Reads StreetEasy from an authorized partner: a complete export, or a feed whose total must reconcile. */
async function refreshStreetEasyPartner(
  bucket: Bucket,
  source: (typeof DIRECT_RENTAL_SOURCES)[number],
  partner: PartnerFeed,
  fetcher: SourceFetch,
  now: Date,
  at: string,
) {
  if (partner.format === STREETEASY_EXPORT_FORMAT) {
    const result = await loadStreetEasyExport(partner, fetcher, now);
    const stored = await storedDirectRentals(bucket, source);
    if (stored?.transport === STREETEASY_EXPORT_FORMAT && Date.parse(stored.checkedAt ?? '') > Date.parse(result.checkedAt)) {
      throw new Error('StreetEasy export was older than the saved export.');
    }
    return refreshDirectRentals(bucket, source, result, result.checkedAt, true);
  }
  const result = await loadFeed({ ...partner, maxBedrooms: STREETEASY_LIVE.maxBedrooms }, fetcher, { requireTotal: true });
  if (result.total === undefined || (result.total > 0 && result.listings.length === 0)) {
    throw new Error('StreetEasy partner feed did not return a verifiable rental inventory.');
  }
  const listings = result.listings.map((listing) => ({ ...listing, seenAt: listing.seenAt ?? at }));
  return refreshDirectRentals(bucket, source, { ...result, listings, transport: STREETEASY_PARTNER_TRANSPORT }, at, true);
}

/** What one refresh run gives each source's check. */
type Run = {
  bucket: Bucket;
  at: string;
  now: Date;
  onDemand: boolean;
  /** True when the home sync uploaded snapshots, which then stand in for what the loaders return. */
  isImport: boolean;
  previous: RefreshState;
  fetch: SourceFetch;
  /** The uploaded snapshot for a source. It was made by this app's own sync, so it has the loader's result type. */
  imported: <T>(id: string) => T | undefined;
  /** The source's own data: loaded now when checking on demand, otherwise its uploaded snapshot. */
  liveData: <T>(id: string, load: (fetcher: SourceFetch, now: Date) => T) => T;
  streetEasyPartner: PartnerFeed | undefined;
  streetEasyTransport: ReturnType<typeof streetEasyTransportFor>;
};

type StatusContext = {
  at: string;
  now: Date;
  onDemand: boolean;
  streetEasyTransport: ReturnType<typeof streetEasyTransportFor>;
  previousById: Map<string, SourceStatus>;
};
/** Why a check failed: whatever the source's loader threw. */
type Failure = PromiseRejectedResult['reason'];

/**
 * One source the refresh checks. Each source is declared once, in SOURCES (or as a configured feed), with
 * everything the refresh and the source list need to know about it.
 * - public: FirstMover and Housing Connect, open data checked on every refresh and uploaded by the home sync.
 * - reference: affordable housing notices, checked only on demand.
 * - live: listing inventories (Openigloo and the direct rental sources), checked on demand or uploaded.
 * - feed: partner feeds configured in the settings.
 */
type RefreshSource = {
  id: string;
  /** The name in check status and errors. */
  name: string;
  kind: 'public' | 'reference' | 'live' | 'feed';
  /** The entry in the source list the app shows. */
  catalog(env: AppEnv): SourceDefinition;
  check(run: Run): Promise<CheckResult>;
  /** Adds this source's counts and a readable error to its status. Without it, the counts are copied and the error is generic. */
  describe?(item: SourceStatus, next: CheckResult | null, older: SourceStatus | undefined, failure: Failure, context: StatusContext): void;
  /** What a failed HTTP request is called in the error, when not the source's name. */
  endpoint?(context: StatusContext): string;
};

/** Counts copied from this check, or the last good one, and a generic error. */
function describeCounts(item: SourceStatus, next: CheckResult | null, older: SourceStatus | undefined, failure: Failure) {
  const listingCount = next?.listingCount ?? older?.listingCount;
  if (listingCount !== undefined) item.listingCount = listingCount;
  const pages = next?.pages ?? older?.pages;
  if (pages !== undefined) item.pages = pages;
  const total = next ? next.total : older?.total;
  if (total !== undefined) item.total = total;
  if (!next)
    item.error =
      failure?.code === 'incomplete_feed' ? item.name + ' returned an incomplete inventory.' : item.name + ' could not be refreshed.';
}

function describeDirect(
  item: SourceStatus,
  next: CheckResult | null,
  older: SourceStatus | undefined,
  failure: Failure,
  { onDemand, streetEasyTransport }: StatusContext,
) {
  const { id, name } = item;
  if (id === STREETEASY_LIVE.id || id === 'hotpads-live') item.requestTransport = onDemand ? 'direct' : 'import';
  if (id === STREETEASY_LIVE.id && (onDemand || next?.transport === STREETEASY_TRANSPORT)) {
    item.transport = onDemand ? streetEasyTransport : STREETEASY_TRANSPORT;
    if (onDemand && streetEasyTransport !== STREETEASY_TRANSPORT) item.requestTransport = streetEasyTransport;
  }
  if (fullInventory(id) && next?.transport) item.transport = next.transport;
  const counts = next ?? older;
  if (counts?.updatedAt) {
    item.listingCount = counts.listingCount;
    item.pages = counts.pages;
    if (counts.sampleLimit !== undefined) item.sampleLimit = counts.sampleLimit;
    if (counts.partial) {
      item.partial = true;
      item.requestedPages = counts.requestedPages;
      item.failedPages = counts.failedPages;
    }
    if (counts.total !== undefined) item.total = counts.total;
  }
  if (!next)
    item.error =
      failure?.code === 'incomplete_feed'
        ? name + ' returned an incomplete inventory.'
        : failure instanceof Error && failure.message.startsWith(name + ' ')
          ? failure.message
          : 'The ' + name + ' live sample could not be refreshed.';
}

/** A direct rental source: StreetEasy can also be read from an authorized partner or its public search page. */
function directSource(source: (typeof DIRECT_RENTAL_SOURCES)[number]): RefreshSource {
  const streetEasy = source.id === STREETEASY_LIVE.id;
  return {
    id: source.id,
    name: source.name,
    kind: 'live',
    catalog(env) {
      const partner = configuredFeeds(env).find(({ id }) => id === STREETEASY_LIVE.marketplace);
      const paused = streetEasy && env.STREETEASY_SYNC_ENABLED === 'false';
      return {
        id: source.id,
        name: source.name,
        marketplace: source.marketplace,
        coverage: !streetEasy
          ? source.coverage
          : partner?.format === STREETEASY_EXPORT_FORMAT
            ? STREETEASY_EXPORT_COVERAGE
            : partner
              ? 'Configured StreetEasy partner feed'
              : env.STREETEASY_PUBLIC_SEARCH === 'true'
                ? STREETEASY_PUBLIC_COVERAGE
                : source.coverage,
        resyncable: !paused,
        ...(paused ? { paused: true } : {}),
      };
    },
    async check(run) {
      if (streetEasy && run.onDemand && run.streetEasyPartner) {
        return refreshStreetEasyPartner(run.bucket, source, run.streetEasyPartner, run.fetch, run.now, run.at);
      }
      if (streetEasy && run.onDemand && run.streetEasyTransport === STREETEASY_PUBLIC_TRANSPORT) {
        return refreshDirectRentals(run.bucket, source, await loadStreetEasyPublicSearch(run.fetch, run.now), run.at);
      }
      return refreshDirectRentals(run.bucket, source, await run.liveData(source.id, source.load), run.at);
    },
    describe: describeDirect,
    ...(streetEasy
      ? {
          endpoint: ({ streetEasyTransport }: StatusContext) =>
            streetEasyTransport === STREETEASY_PUBLIC_TRANSPORT
              ? 'StreetEasy public rentals page'
              : streetEasyTransport === STREETEASY_TRANSPORT
                ? 'StreetEasy API'
                : source.name,
        }
      : {}),
  };
}

/** Every source except configured feeds, in the order the app lists them. */
const SOURCES: readonly RefreshSource[] = [
  {
    id: 'firstmover',
    name: 'FirstMover (StreetEasy)',
    kind: 'public',
    catalog: () => ({
      id: 'firstmover',
      name: 'FirstMover rent history',
      coverage: 'Historical rent charts, not active inventory',
      resyncable: true,
    }),
    check: (run) =>
      refreshMarket(run.bucket, run.previous.market, run.at, run.fetch, run.imported('firstmover'), run.isImport, run.onDemand),
    describe(item, next, older, failure) {
      item.month = next?.month ?? older?.month ?? SNAPSHOT_MONTH;
      if (!next)
        item.error =
          failure instanceof Error && /^FirstMover |^The (latest )?FirstMover /.test(failure.message)
            ? failure.message
            : 'The FirstMover import failed.';
    },
  },
  {
    id: 'housingconnect',
    name: 'NYC Housing Connect',
    kind: 'public',
    catalog: () => ({
      id: 'housingconnect',
      name: 'NYC Housing Connect',
      coverage: 'NYC affordable housing opportunities',
      resyncable: true,
    }),
    check: (run) => refreshHousing(run.bucket, run.at, run.fetch, run.now, run.imported('housingconnect'), run.isImport),
  },
  {
    ...HDC_RERENTALS,
    kind: 'reference',
    catalog: () => ({ ...HDC_RERENTALS, coverage: 'NYC affordable re-rentals', resyncable: true }),
    async check(run) {
      const data = await loadHdcRerentals(run.fetch);
      await run.bucket.put(HDC_KEY, JSON.stringify({ ...data, checkedAt: run.at }));
      return { status: 'updated', updatedAt: run.at, listingCount: data.results.length };
    },
  },
  {
    ...JERSEY_AFFORDABLE,
    kind: 'reference',
    catalog: () => ({
      ...JERSEY_AFFORDABLE,
      coverage: 'Jersey City income-restricted application notices, not market inventory',
      resyncable: true,
    }),
    check: (run) => refreshJerseyAffordable(run.bucket, run.fetch, run.now, run.at),
  },
  {
    ...WESTCHESTER_HOMESEEKER,
    kind: 'reference',
    catalog: () => ({
      ...WESTCHESTER_HOMESEEKER,
      coverage: 'Westchester County affordable rental lotteries, waitlists and first-come rentals, not market inventory',
      resyncable: true,
    }),
    check: (run) => refreshHomeSeeker(run.bucket, run.fetch, run.now, run.at),
  },
  {
    id: 'openigloo',
    name: 'Openigloo',
    kind: 'live',
    catalog: () => ({ id: 'openigloo', name: 'Openigloo', coverage: OPENIGLOO_COVERAGE, resyncable: true }),
    check: async (run) => refreshOpenigloo(run.bucket, await run.liveData('openigloo', loadOpenigloo), run.at),
    describe(item, next, older, failure) {
      const counts = next ?? older;
      if (counts?.updatedAt) {
        item.listingCount = counts.listingCount;
        item.total = counts.total;
        if (counts.pages !== undefined) item.pages = counts.pages;
        if (counts.transport) item.transport = counts.transport;
      }
      if (!next)
        item.error =
          failure instanceof Error && /^Openigloo /.test(failure.message)
            ? failure.message
            : 'The Openigloo inventory could not be refreshed.';
    },
  },
  ...DIRECT_RENTAL_SOURCES.map(directSource),
];

/** A partner feed from the settings. StreetEasy's partner feed is read by the StreetEasy source instead. */
const feedSource = (feed: PartnerFeed): RefreshSource => ({
  id: feed.id,
  name: feed.name,
  kind: 'feed',
  catalog: () => ({ id: feed.id, name: feed.name, coverage: 'Configured feed', resyncable: true }),
  async check(run) {
    const result = await loadFeed(feed, run.fetch);
    const listings = result.listings.map((listing: ListingData) => ({ ...withoutCommuteEstimate(listing), checkedAt: run.at }));
    await saveObservedSnapshot(run.bucket, FEED_PREFIX + feed.id, result, listings, feed.id, run.at);
    return { status: 'updated', updatedAt: run.at, listingCount: listings.length, pages: result.pages, total: result.total };
  },
});

/** Every source these settings check, in the order the app lists them. */
const sourcesFor = (env: AppEnv) => [
  ...SOURCES,
  ...configuredFeeds(env)
    .filter(({ id }) => id !== STREETEASY_LIVE.marketplace)
    .map(feedSource),
];

export function refreshCatalog(env: AppEnv): SourceDefinition[] {
  const feedIds = new Set(configuredFeeds(env).map(({ id }) => id));
  return [
    ...sourcesFor(env).map((source) => source.catalog(env)),
    // Marketplaces that need an authorized feed, listed so the app can say so.
    ...FEED_REQUIRED_IDS.filter((id) => !feedIds.has(id)).map((id) => ({
      id,
      name: MARKETPLACE_NAMES[id],
      coverage: id === 'citysnap' ? 'REBNY listing feed access required' : 'Authorized listing feed required',
      resyncable: false,
    })),
  ];
}

/** The status saved for one source after its check: this run's counts or the last good ones, and a readable failure. */
function checkStatus(source: RefreshSource, result: PromiseSettledResult<CheckResult>, context: StatusContext): SourceStatus {
  const { id, name } = source;
  const { at, now, onDemand, previousById } = context;
  const older = previousById.get(id);
  const next = result.status === 'fulfilled' ? result.value : null;
  const failure = result.status === 'rejected' ? result.reason : null;
  const item: SourceStatus = {
    id,
    name,
    checkedAt: at,
    status: next?.status ?? 'failed',
    updatedAt: next?.updatedAt ?? older?.updatedAt ?? null,
  };
  (source.describe ?? describeCounts)(item, next, older, failure, context);
  if (!next && onDemand) {
    const status = failure?.httpStatus;
    if (status) {
      item.error =
        (source.endpoint?.(context) ?? name) +
        ' returned HTTP ' +
        status +
        (failure?.providerDenial ? ' (' + failure.providerDenial + ')' : '') +
        '.';
    } else if (failure?.name === 'TimeoutError') item.error = name + ' did not respond in time.';
    Object.assign(item, retrySchedule(failure, older?.transport === item.transport ? older : undefined, now.getTime()));
  }
  return item;
}

export async function refreshSources(
  env: AppEnv,
  {
    fetcher = fetch,
    now = new Date(),
    imports,
    onDemand = false,
    fallback = false,
    onlyStreetEasy = false,
    sourceId,
    excludeWorkflowSources = false,
  }: RefreshOptions = {},
) {
  const selected = sourceId ?? (onlyStreetEasy ? STREETEASY_LIVE.id : null);
  if (selected && !refreshCatalog(env).some((source) => source.id === selected && source.resyncable))
    throw new Error('Unknown or disconnected refresh source.');
  const bucket = env.BUCKET;
  if (!bucket) throw new Error('Source storage is unavailable.');
  const current = await readState(bucket);
  const at = now.toISOString();
  const hour = at.slice(0, 13);
  const previous = current.value;
  if (checkInProgress(previous, now)) {
    return { state: 'running', ...publicStatus(previous, now) };
  }
  const previousById = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  const sources = sourcesFor(env);
  const streetEasyPartner = configuredFeeds(env).find(({ id }) => id === STREETEASY_LIVE.marketplace);
  const streetEasyTransport = streetEasyTransportFor(env, streetEasyPartner);
  /** Whether a source can be checked now: not waiting out a retry, and not paused or left to the Workflow. */
  const ready = (id: string) => {
    const prior = previousById.get(id);
    if (completeSync(id) && excludeWorkflowSources) return false;
    if (id !== STREETEASY_LIVE.id) return !coolingDown(prior, now);
    if (env.STREETEASY_SYNC_ENABLED === 'false') return false;
    // A different way of reading StreetEasy is tried even while the previous one waits out a retry.
    return (onDemand && Boolean(prior?.transport) && prior?.transport !== streetEasyTransport) || !coolingDown(prior, now);
  };
  const imported = <T>(id: string) => imports?.[id] as T | undefined;
  const priorStreetEasy = previousById.get(STREETEASY_LIVE.id);
  // A StreetEasy upload from the home sync replaces a failed or day-old StreetEasy check.
  const recoveredStreetEasy =
    imported<{ transport?: string }>(STREETEASY_LIVE.id)?.transport === STREETEASY_TRANSPORT &&
    (!priorStreetEasy ||
      priorStreetEasy.status === 'failed' ||
      now.getTime() - Date.parse(priorStreetEasy.updatedAt ?? '') >= STREETEASY_SYNC_INTERVAL);
  /**
   * Whether this run checks a source. A regular run checks everything due; an on-demand one what is ready;
   * a StreetEasy-only run just StreetEasy; a fallback (the home sync filling in) only what failed or is stale.
   */
  const included = ({ id, kind }: RefreshSource) => {
    if (kind === 'public')
      return (
        !onlyStreetEasy &&
        (fallback ? Boolean(imports?.[id]) && previousById.get(id)?.status === 'failed' && ready(id) : !onDemand || ready(id))
      );
    if (kind === 'reference') return onDemand && !onlyStreetEasy && !fallback && ready(id);
    if (kind === 'feed') return !onlyStreetEasy && !fallback && (!onDemand || ready(id));
    const streetEasy = id === STREETEASY_LIVE.id;
    const requested = onlyStreetEasy
      ? streetEasy && ready(id)
      : fallback
        ? streetEasy && recoveredStreetEasy
        : onDemand
          ? ready(id)
          : Boolean(imports) && Object.hasOwn(imports!, id);
    // StreetEasy is skipped when paused, and in uploads when a partner feed supplies it.
    return requested && !(streetEasy && (env.STREETEASY_SYNC_ENABLED === 'false' || (!onDemand && streetEasyPartner)));
  };
  const checks = sources.filter(included).filter(({ id }) => !selected || id === selected);
  const ids = checks.map(({ id }) => id);
  if (
    ids.length === 0 ||
    (!onDemand &&
      !selected &&
      !onlyStreetEasy &&
      !previous.running &&
      !imported<{ changed?: boolean }>('firstmover')?.changed &&
      checkedDuring(previous.sources, ids, hour))
  ) {
    return { state: 'already_checked', ...publicStatus(previous) };
  }

  const activeSource = WORKFLOW_SOURCE_IDS.find((id) => ids.includes(id)) ?? selected;
  const lease = await bucket.put(STATE_KEY, JSON.stringify({ ...previous, running: true, startedAt: at, activeSource }), {
    onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
  });
  if (!lease) return { state: 'running', ...publicStatus((await readState(bucket)).value, now) };

  const sourceFetch = onDemand
    ? requestForRefresh(fetcher, AbortSignal.timeout(ids.includes(STREETEASY_LIVE.id) ? 120_000 : PAGE_FETCH_TIMEOUT))
    : fetcher;
  const run: Run = {
    bucket,
    at,
    now,
    onDemand,
    isImport: Boolean(imports),
    previous,
    fetch: sourceFetch,
    imported,
    liveData: <T>(id: string, load: (fetcher: SourceFetch, now: Date) => T): T =>
      onDemand
        ? load(completeSync(id) ? requestForRefresh(fetcher, AbortSignal.timeout(completeSync(id)!.timeoutMs)) : sourceFetch, now)
        : (imported<T>(id) as T),
    streetEasyPartner,
    streetEasyTransport,
  };
  const statusContext: StatusContext = { at, now, onDemand, streetEasyTransport, previousById };
  const statusFor = (check: RefreshSource, result: PromiseSettledResult<CheckResult>) => checkStatus(check, result, statusContext);

  // Publish each successful provider immediately, even while another is slow.
  let currentEtag = lease.etag;
  const progress = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  let writes = Promise.resolve();
  const persist = (item: SourceStatus) => {
    writes = writes.then(async () => {
      progress.set(item.id, item);
      const receipt = await bucket.put(
        STATE_KEY,
        JSON.stringify({ ...previous, running: true, startedAt: at, activeSource, lastCheckedAt: at, sources: [...progress.values()] }),
        { onlyIf: { etagMatches: currentEtag } },
      );
      if (!receipt) throw new Error('Source refresh was superseded.');
      currentEtag = receipt.etag;
    });
    return writes;
  };
  const results = await Promise.all(
    checks.map(async (check): Promise<PromiseSettledResult<CheckResult>> => {
      let result: PromiseSettledResult<CheckResult>;
      try {
        result = { status: 'fulfilled', value: await check.check(run) };
      } catch (reason) {
        result = { status: 'rejected', reason };
      }
      await persist(statusFor(check, result));
      return result;
    }),
  );
  const attempted = checks.map((check, index) => statusFor(check, results[index]));
  for (const [index, item] of attempted.entries()) {
    const result = results[index];
    if (result.status === 'rejected')
      log.warn('source_check_failed', {
        source: item.id,
        error: item.error,
        cause: result.reason instanceof Error ? result.reason.message : String(result.reason),
        httpStatus: result.reason?.httpStatus,
      });
  }

  // Sources no longer declared or configured drop out of the saved status.
  const declared = new Set(sources.map(({ id }) => id));
  const saved = [...attempted, ...(previous.sources ?? []).filter(({ id }) => !ids.includes(id) && declared.has(id))];
  const marketResult = results[checks.findIndex(({ id }) => id === 'firstmover')];
  const market = marketResult?.status === 'fulfilled' ? marketResult.value : previous.market;
  const state = {
    running: false,
    hour,
    lastCheckedAt: at,
    market: market
      ? {
          revision: market.revision,
          catalogEtag: market.catalogEtag,
          csvEtag: market.csvEtag,
        }
      : null,
    sources: saved,
  };
  const written = await bucket.put(STATE_KEY, JSON.stringify(state), { onlyIf: { etagMatches: currentEtag } });
  if (!written) return { state: 'superseded', ...publicStatus((await readState(bucket)).value) };
  const result = publicStatus(state);
  return { state: result.sources.some(({ status }) => status === 'failed') ? 'partial' : 'complete', ...result };
}
