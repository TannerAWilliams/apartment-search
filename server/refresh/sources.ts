/**
 * Every source a refresh checks, each declared once with how it is checked, listed and described. The
 * checks validate what a source returned before anything is saved.
 */
import { withoutCommuteEstimate } from '../../src/commute-estimate.ts';
import type { ListingData } from '../../src/domain.ts';
import { SNAPSHOT_MONTH } from '../../src/market.ts';
import { MARKETPLACE_NAMES } from '../../src/marketplaces.ts';
import type { SourceDefinition } from '../../src/source-status.ts';
import type { AppEnv, Bucket, HousingSnapshot, SourceFetch } from '../contracts.ts';
import { DIRECT_RENTAL_SOURCES } from '../sources/direct-rentals.ts';
import { HDC_RERENTALS, loadHdcRerentals } from '../sources/hdc-rerentals.ts';
import { loadHousingConnect } from '../sources/housing.ts';
import { JERSEY_AFFORDABLE, refreshJerseyAffordable } from '../sources/jersey-affordable.ts';
import {
  STREETEASY_EXPORT_COVERAGE,
  STREETEASY_EXPORT_FORMAT,
  configuredFeeds,
  loadFeed,
  loadStreetEasyExport,
} from '../sources/listings.ts';
import {
  OPENIGLOO_COVERAGE,
  OPENIGLOO_MAX_LISTINGS,
  OPENIGLOO_MIN_COVERAGE,
  OPENIGLOO_TRANSPORT,
  loadOpenigloo,
} from '../sources/openigloo.ts';
import { BLOCKED_SOURCES, fullInventory, isCompleteSnapshot } from '../sources/source-registry.ts';
import { retrySchedule } from '../sources/source-requests.ts';
import {
  STREETEASY_LIVE,
  STREETEASY_PUBLIC_COVERAGE,
  STREETEASY_PUBLIC_TRANSPORT,
  loadStreetEasyPublicSearch,
} from '../sources/streeteasy.ts';
import { WESTCHESTER_HOMESEEKER, refreshHomeSeeker } from '../sources/westchester-homeseeker.ts';
import { refreshMarket } from './market.ts';
import { refreshMarketHistory } from '../storage/market-history.ts';
import {
  FEED_PREFIX,
  HDC_KEY,
  HOUSING_KEY,
  OPENIGLOO_KEY,
  type RentalSnapshot,
  saveObservedSnapshot,
  storedDirectRentals,
} from './snapshots.ts';
import { type CheckResult, type RefreshState, STREETEASY_PARTNER_TRANSPORT, STREETEASY_TRANSPORT, type SourceStatus } from './status.ts';

const FEED_REQUIRED_IDS = ['bhs', 'citysnap', 'craigslist', 'rebny-rls'] as const;

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
export function streetEasyTransportFor(env: AppEnv, partner: PartnerFeed | undefined) {
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
export type Run = {
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

export type StatusContext = {
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
export type RefreshSource = {
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
      const blocked = BLOCKED_SOURCES[source.id];
      return {
        id: source.id,
        name: source.name,
        marketplace: source.marketplace,
        coverage: blocked
          ? blocked + ' Open it from Rental platforms.'
          : !streetEasy
            ? source.coverage
            : partner?.format === STREETEASY_EXPORT_FORMAT
              ? STREETEASY_EXPORT_COVERAGE
              : partner
                ? 'Configured StreetEasy partner feed'
                : env.STREETEASY_PUBLIC_SEARCH === 'true'
                  ? STREETEASY_PUBLIC_COVERAGE
                  : source.coverage,
        resyncable: !paused && !blocked,
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
      return refreshDirectRentals(run.bucket, source, await run.liveData<Promise<RentalSnapshot>>(source.id, source.load), run.at);
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
export const SOURCES: readonly RefreshSource[] = [
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
    id: 'streeteasy-dashboard',
    name: 'StreetEasy Data Dashboard',
    kind: 'reference',
    catalog: () => ({
      id: 'streeteasy-dashboard',
      name: 'StreetEasy Data Dashboard',
      coverage: 'Monthly market figures since 2010 for Market history (rents, inventory, price cuts, sales), not listings',
      resyncable: true,
    }),
    async check(run) {
      if (!run.bucket.database) throw new Error('StreetEasy Data Dashboard: market history needs the D1 database.');
      const result = await refreshMarketHistory(run.bucket.database, run.fetch, run.now);
      return { status: result.changed ? 'updated' : 'current', updatedAt: run.at, listingCount: result.changed, total: result.files };
    },
    describe(item, next, older, failure) {
      if (next) Object.assign(item, { listingCount: next.listingCount, total: next.total });
      else
        item.error =
          failure instanceof Error && failure.message.startsWith('StreetEasy Data Dashboard')
            ? failure.message
            : 'The StreetEasy Data Dashboard files could not be downloaded.';
      if (!next && older?.total !== undefined) item.total = older.total;
    },
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
export const sourcesFor = (env: AppEnv) => [
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
export function checkStatus(source: RefreshSource, result: PromiseSettledResult<CheckResult>, context: StatusContext): SourceStatus {
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
