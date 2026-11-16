import { recordListingHistory } from './listing-history.ts';
import type { ListingTransports } from './relay-client.ts';
import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { decodeMarketRows, marketSnapshot, packRentMonth, SNAPSHOT_MONTH } from '../src/market.ts';
import { bundledRentAreas, priorRentMonths } from '../src/rent-history.ts';
import { checkFirstMover, checkPublishedFirstMover } from './firstmover.ts';
import { configuredFeeds, loadFeed } from './listings.ts';
import { housingDate, loadHousingConnect } from './housing.ts';
import { HDC_RERENTALS, loadHdcRerentals } from './hdc-rerentals.ts';
import { AUTO_RENTAL_SOURCES, DIRECT_RENTAL_SOURCES, FEED_ONLY_SOURCES } from './direct-rentals.ts';
import { loadOpenigloo, OPENIGLOO_SAMPLE_LIMIT } from './openigloo.ts';
import { requestForRefresh, retrySchedule } from './source-requests.ts';

import { STREETEASY_LIVE } from './streeteasy.ts';

const STREETEASY_TRANSPORT = 'v6-daily';
const STREETEASY_SYNC_INTERVAL = 24 * 60 * 60_000;
const STATE_KEY = 'rentals/refresh.json';
const MARKET_KEY = 'rentals/firstmover.json.gz';
const MARKET_SCHEMA = 'companies-1';
const HISTORY_PREFIX = 'rentals/market-history/';
const OPENIGLOO_KEY = 'rentals/openigloo.json.gz';
const PUBLIC_IDS = ['firstmover', 'housingconnect'];
const LIVE_IDS = ['openigloo', ...DIRECT_RENTAL_SOURCES.map(({ id }) => id)];
const AUTO_IDS = ['openigloo', ...AUTO_RENTAL_SOURCES.map(({ id }) => id)];
const DIRECT_BY_ID = new Map(DIRECT_RENTAL_SOURCES.map((source) => [source.id, source]));
const HOUSING_KEY = 'rentals/housing-connect.json';
const HDC_KEY = 'rentals/hdc-rerentals.json';
const FEED_PREFIX = 'rentals/feeds/';
const LOCK_TIMEOUT = 5 * 60_000;
const LIVE_MAX_AGE = 2 * 60 * 60_000;
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
  month?: string;
  revision?: string;
  catalogEtag?: string;
  csvEtag?: string;
};

type SourceStatus = CheckResult & {
  requestTransport?: 'direct' | 'relay' | 'import' | 'not-recorded';
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
};

type RefreshOptions = {
  listingTransports?: ListingTransports;
  fetcher?: SourceFetch;
  now?: Date;
  imports?: Record<string, any>;
  onDemand?: boolean;
  skipStreetEasy?: boolean;
  onlyStreetEasy?: boolean;
  sourceId?: string;
  forceRefresh?: boolean;
  fallback?: boolean;
};

export function refreshCatalog(env) {
  return [
    { id: 'firstmover', name: 'FirstMover rent history', coverage: 'Historical rent charts, not active inventory', resyncable: true },
    { id: 'housingconnect', name: 'NYC Housing Connect', coverage: 'NYC affordable housing opportunities', resyncable: true },
    { ...HDC_RERENTALS, coverage: 'NYC affordable re-rentals', resyncable: true },
    { id: 'openigloo', name: 'Openigloo', coverage: 'Limited NYC sample', resyncable: true },
    ...DIRECT_RENTAL_SOURCES.map(({ id, name, marketplace, coverage }) => ({ id, name, marketplace, coverage,
      resyncable: AUTO_IDS.includes(id) })),
    ...configuredFeeds(env).map(({ id, name }) => ({ id, name, coverage: 'Configured feed', resyncable: true })),
  ].map(({ id, name, marketplace, coverage, resyncable }: any) => ({ id, name, marketplace, coverage, resyncable }));
}

let cachedMarket;

const compressed = (value) => gzipSync(strToU8(JSON.stringify(value)));
const unpack = async (object) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer()))));

async function readState(bucket): Promise<{ value: RefreshState; etag: string | null }> {
  const object = await bucket?.get(STATE_KEY);
  return object ? { value: await object.json(), etag: object.etag } : { value: {}, etag: null };
}

function checkInProgress(state, now) {
  return state.running && now.getTime() - Date.parse(state.startedAt) < LOCK_TIMEOUT;
}

function publicStatus(state: RefreshState, now = new Date()) {
  const sources = new Map((state.sources ?? []).map((source) => [source.id, source]));
  for (const { id, name, marketplace } of FEED_ONLY_SOURCES) {
    const previous = sources.get(id);
    sources.set(id, { id, name, marketplace, status: 'feed_required', checkedAt: previous?.checkedAt ?? null,
      updatedAt: previous?.updatedAt ?? null, listingCount: previous?.listingCount });
  }
  return { lastCheckedAt: state.lastCheckedAt ?? null, sources: [...sources.values()],
    ...(checkInProgress(state, now) ? { checking: true } : {}) };
}

export async function refreshStatus(bucket) {
  return publicStatus((await readState(bucket)).value);
}

function checkedDuring(sources, ids, hour) {
  return ids.every((id) => sources?.some((source) =>
    source.id === id && source.status !== 'failed' && source.checkedAt?.slice(0, 13) === hour));
}

const coolingDown = (source, now) => Date.parse(source?.retryAt) > now.getTime();

export function sourceRecent(status, id, now = new Date()) {
  const source = status?.sources.find((item) => item.id === id);
  const age = now.getTime() - Date.parse(source?.updatedAt);
  return (source?.status === 'updated' || source?.status === 'current') && age >= 0 && age <= (id === STREETEASY_LIVE.id && source.transport === STREETEASY_TRANSPORT ? STREETEASY_SYNC_INTERVAL : LIVE_MAX_AGE);
}

export async function storedOpenigloo(bucket) {
  const object = await bucket?.get(OPENIGLOO_KEY);
  return object ? unpack(object) : null;
}

export async function storedDirectRentals(bucket, source) {
  const object = await bucket?.get('rentals/' + source.id + '.json.gz');
  return object ? unpack(object) : null;
}

export async function refreshPlan(bucket, now = new Date()) {
  const [{ value }, object] = await Promise.all([readState(bucket), bucket?.head(MARKET_KEY)]);
  const market = marketBaseline(object, value.market);
  const hour = now.toISOString().slice(0, 13);
  const privateFeeds = value.sources?.map(({ id }) => id).filter((id) => !PUBLIC_IDS.includes(id) && !LIVE_IDS.includes(id) && id !== HDC_RERENTALS.id) ?? [];
  return { ready: Boolean(bucket), market,
    alreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, [...PUBLIC_IDS, ...AUTO_IDS, HDC_RERENTALS.id, ...privateFeeds], hour),
    publicAlreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, PUBLIC_IDS, hour),
    ...publicStatus(value, now) };
}

export async function storedMarket(bucket) {
  const head = await bucket?.head(MARKET_KEY);
  if (!head) return { month: SNAPSHOT_MONTH, listings: marketSnapshot() };
  if (cachedMarket?.bucket === bucket && cachedMarket.etag === head.etag) return cachedMarket.market;

  const object = await bucket.get(MARKET_KEY);
  if (!object) return { month: SNAPSHOT_MONTH, listings: marketSnapshot() };
  const market = { month: object.customMetadata.month, listings: decodeMarketRows(await unpack(object)) };
  cachedMarket = { bucket, etag: object.etag, market };
  return market;
}

export async function storedRentHistory(bucket, latest, region, grouping) {
  return Promise.all(priorRentMonths(latest).map(async (month) => {
    const object = month >= SNAPSHOT_MONTH ? await bucket?.get(HISTORY_PREFIX + month + '.json.gz') : null;
    const areas = object ? (await unpack(object))[region]?.[grouping] : bundledRentAreas(month, region, grouping);
    return [month, areas ?? []];
  }));
}

export async function storedFeed(bucket, feed) {
  const object = await bucket.get(FEED_PREFIX + feed.id + '.json.gz');
  if (!object) throw new Error('This feed has not completed its first refresh.');
  return unpack(object);
}

function marketBaseline(object, previous) {
  const metadata = object?.customMetadata;
  if (metadata?.schema !== MARKET_SCHEMA) return null;
  const sameRelease = previous?.revision === metadata.revision;
  return { ...metadata, catalogEtag: sameRelease ? previous?.catalogEtag : '', csvEtag: sameRelease ? previous?.csvEtag : '' };
}

async function refreshMarket(bucket, previous, checkedAt, fetcher, imported, isImport, onDemand) {
  const stored = await bucket.head(MARKET_KEY);
  const baseline = marketBaseline(stored, previous);
  const check = onDemand ? checkPublishedFirstMover : checkFirstMover;
  const result = isImport ? imported : await check(baseline, fetcher);
  if (!result || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(result.month) || !/^[a-f0-9]{40}$/.test(result.revision) ||
      (baseline && result.month < baseline.month)) throw new Error('The FirstMover import failed.');
  if (!result.changed && result.revision !== baseline?.revision) throw new Error('The FirstMover release has changed.');
  if (result.changed && (!Array.isArray(result.rows) || result.rows.length === 0 || result.rows.length > 60000 ||
      result.rows.some((row) => !Array.isArray(row) || row.length !== 15 ||
        typeof row[12] !== 'string' || !/^\/(rental|building)\//.test(row[12])))) {
    throw new Error('The FirstMover import had invalid listings.');
  }
  const updatedAt = result.changed ? checkedAt : baseline.updatedAt;
  if (result.changed) {
    if (stored?.customMetadata?.month >= SNAPSHOT_MONTH && stored.customMetadata.month < result.month) {
      const previousMarket = await storedMarket(bucket);
      await bucket.put(HISTORY_PREFIX + previousMarket.month + '.json.gz', compressed(packRentMonth(previousMarket.listings)));
    }
    await bucket.put(MARKET_KEY, compressed(result.rows), {
      customMetadata: { month: result.month, revision: result.revision, updatedAt, schema: MARKET_SCHEMA },
    });
  }
  return { status: result.changed ? 'updated' : 'current', month: result.month,
    revision: result.revision, catalogEtag: result.catalogEtag, csvEtag: result.csvEtag, updatedAt };
}

export async function storedHousing(bucket, now = new Date()) {
  const object = await bucket?.get(HOUSING_KEY);
  if (!object) return { publishedAt: null, checkedAt: null, opportunities: [] };
  const data = await object.json();
  const today = housingDate(now);
  return { ...data, checkedAt: object.customMetadata.updatedAt,
    opportunities: data.opportunities.filter(({ closes }) => closes >= today) };
}

export async function storedHdcRerentals(bucket) {
  const object = await bucket?.get(HDC_KEY);
  return object ? object.json() : null;
}

async function refreshHousing(bucket, checkedAt, fetcher, now, imported, isImport) {
  const result = isImport ? imported : await loadHousingConnect(fetcher, now);
  if (!Array.isArray(result?.opportunities) || result.opportunities.length > 250 ||
      result.opportunities.some(({ id, url }) => !/^\d{1,12}$/.test(id) ||
        url !== 'https://housingconnect.nyc.gov/PublicWeb/details/' + id)) {
    throw new Error('NYC Open Data could not be imported.');
  }
  const data = JSON.stringify(result);
  const previous = await bucket.get(HOUSING_KEY);
  if (previous && await previous.text() === data) {
    return { status: 'current', updatedAt: previous.customMetadata.updatedAt };
  }
  await bucket.put(HOUSING_KEY, data, { customMetadata: { updatedAt: checkedAt } });
  return { status: 'updated', updatedAt: checkedAt };
}

export async function saveObservedSnapshot(bucket, key, result, listings, sourceId, at, customMetadata = {}) {
  const object = await bucket.get(key);
  const previous = object ? await unpack(object) : null;
  const observed = recordListingHistory(listings, previous?.observationHistory, sourceId, at);
  const saved = await bucket.put(key, compressed({ ...result, ...observed }), {
    customMetadata,
    onlyIf: object ? { etagMatches: object.etag } : { etagDoesNotMatch: '*' },
  });
  if (!saved) throw new Error('Source snapshot changed during refresh. Retry the manual refresh.');
}

async function refreshOpenigloo(bucket, result, at) {
  if (!Array.isArray(result?.listings) || result.listings.length > OPENIGLOO_SAMPLE_LIMIT ||
      result.listings.some((listing) => listing.kind !== 'feed' || listing.region !== 'nyc' ||
        !Array.isArray(listing.sources) || listing.sources[0]?.id !== 'openigloo' ||
        !/^https:\/\/www\.openigloo\.com\/unit\/nyc\//.test(listing.sources[0]?.url ?? ''))) {
    throw new Error('Openigloo did not return a valid live sample.');
  }
  const listings = result.listings.map((listing) => ({ ...listing, checkedAt: at }));
  await saveObservedSnapshot(bucket, OPENIGLOO_KEY, result, listings, 'openigloo', at, { updatedAt: at });
  return { status: 'updated', updatedAt: at, listingCount: result.listings.length,
    total: result.total, sampleLimit: result.sampleLimit };
}

async function refreshDirectRentals(bucket, source, result, at) {
  const verifiedStreetEasy = source.id === STREETEASY_LIVE.id && result?.transport === STREETEASY_TRANSPORT;
  if (verifiedStreetEasy && (!Number.isSafeInteger(result.total) || result.total < 0 || result.total > 20000 ||
      result.rawCount !== result.total || !Array.isArray(result.listings) || result.listings.length > result.total ||
      !Number.isFinite(Date.parse(result.checkedAt)) || Date.parse(result.checkedAt) > Date.parse(at) ||
      Date.parse(at) - Date.parse(result.checkedAt) > 10 * 60_000)) {
    throw new Error('StreetEasy import is incomplete or stale.');
  }
  if (!Number.isInteger(result?.pages) || result.pages < source.minPages || result.pages > source.maxPages ||
      !Array.isArray(result.listings) || (!result.listings.length && result.total !== 0) || result.listings.length > result.pages * source.rowsPerPage ||
      new Set(result.listings.map((listing) => listing?.id)).size !== result.listings.length ||
      result.listings.some((listing) => listing?.kind !== 'feed' || !source.regions.includes(listing.region) ||
        typeof listing.id !== 'string' || !listing.id.startsWith(source.marketplace + ':') ||
        typeof listing.address !== 'string' || !listing.address || typeof listing.unit !== 'string' ||
        typeof listing.city !== 'string' || !listing.city || !/^\d{5}$/.test(listing.zip) ||
        !Number.isFinite(listing.rent) || listing.rent <= 0 || listing.rent > 100000 ||
        !Number.isInteger(listing.bedrooms) || listing.bedrooms < 0 || listing.bedrooms > (source.maxBedrooms ?? 4) ||
        !Array.isArray(listing.sources) || !listing.sources.length ||
        listing.sources.some((link) => link?.id !== source.marketplace || link.kind !== 'feed' ||
          !source.listingUrl(link.url)) || !Number.isFinite(Date.parse(listing.seenAt)))) {
    throw new Error(source.name + ' did not return a valid live sample.');
  }
  const listings = result.listings.map((listing) => ({ ...listing, checkedAt: at }));
  await saveObservedSnapshot(bucket, 'rentals/' + source.id + '.json.gz', result, listings, source.id, at);
  return { status: 'updated', updatedAt: at, listingCount: result.listings.length, pages: result.pages, total: result.total,
    ...(verifiedStreetEasy ? { transport: STREETEASY_TRANSPORT } : {}) };
}

export async function refreshSources(env, { fetcher = fetch, now = new Date(), imports, onDemand = false, fallback = false, skipStreetEasy = false, onlyStreetEasy = false, sourceId, forceRefresh = false, listingTransports }: RefreshOptions = {}) {
  const selected = sourceId ?? (onlyStreetEasy ? STREETEASY_LIVE.id : null);
  if (selected && !refreshCatalog(env).some((source) => source.id === selected && source.resyncable)) throw new Error('Unknown or disconnected refresh source.');
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
  const ready = (id) => {
    const prior = previousById.get(id);
    if ((selected === STREETEASY_LIVE.id || forceRefresh) && id === STREETEASY_LIVE.id) return !coolingDown(prior, now);
    if (id !== STREETEASY_LIVE.id) return !coolingDown(prior, now);
    if (prior?.transport !== STREETEASY_TRANSPORT) return true;
    return !coolingDown(prior, now) && now.getTime() - Date.parse(prior.checkedAt) >= STREETEASY_SYNC_INTERVAL;
  };
  const feeds = configuredFeeds(env);
  const feedChecks = onlyStreetEasy ? [] : fallback ? [] : feeds.filter(({ id }) => !onDemand || ready(id));
  const publicChecks = onlyStreetEasy ? [] : fallback ? PUBLIC_IDS.filter((id) => imports?.[id] && previousById.get(id)?.status === 'failed' && ready(id)) :
    PUBLIC_IDS.filter((id) => !onDemand || ready(id));
  const priorStreetEasy = previousById.get(STREETEASY_LIVE.id);
  const recoveredStreetEasy = imports?.[STREETEASY_LIVE.id]?.transport === STREETEASY_TRANSPORT &&
    (!priorStreetEasy || priorStreetEasy.status === 'failed' ||
      now.getTime() - Date.parse(priorStreetEasy.updatedAt) >= STREETEASY_SYNC_INTERVAL);
  const liveChecks = onlyStreetEasy ? (ready(STREETEASY_LIVE.id) ? [STREETEASY_LIVE.id] : []) : fallback ? (recoveredStreetEasy ? [STREETEASY_LIVE.id] : []) : onDemand ? AUTO_IDS.filter((id) => ready(id) && (!skipStreetEasy || id !== STREETEASY_LIVE.id)) : LIVE_IDS.filter((id) => imports && Object.hasOwn(imports, id));
  const checkHdc = onDemand && !onlyStreetEasy && !fallback && ready(HDC_RERENTALS.id);
  const ids = [...publicChecks, ...liveChecks, ...feedChecks.map(({ id }) => id), ...(checkHdc ? [HDC_RERENTALS.id] : [])].filter((id) => !selected || id === selected);
  if (ids.length === 0 || (!onDemand && !onlyStreetEasy && !previous.running && !imports?.firstmover?.changed && checkedDuring(previous.sources, ids, hour))) {
    return { state: 'already_checked', ...publicStatus(previous) };
  }

  const lease = await bucket.put(STATE_KEY, JSON.stringify({ ...previous, running: true, startedAt: at }), {
    onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
  });
  if (!lease) return { state: 'running', ...publicStatus((await readState(bucket)).value, now) };

  const sourceFetch = onDemand ? requestForRefresh(fetcher, AbortSignal.timeout(ids.includes(STREETEASY_LIVE.id) ? 120_000 : PAGE_FETCH_TIMEOUT)) : fetcher;
  const liveData = (id, load) => onDemand ? load(sourceFetch, now) : imports[id];
  const candidates: { id: string; name: string; work: () => Promise<CheckResult> }[] = [
    ...(publicChecks.includes('firstmover') ? [{ id: 'firstmover', name: 'FirstMover (StreetEasy)', work: () =>
      refreshMarket(bucket, previous.market, at, sourceFetch, imports?.firstmover, Boolean(imports), onDemand) }] : []),
    ...(publicChecks.includes('housingconnect') ? [{ id: 'housingconnect', name: 'NYC Housing Connect', work: () =>
      refreshHousing(bucket, at, sourceFetch, now, imports?.housingconnect, Boolean(imports)) }] : []),
    ...(checkHdc ? [{ ...HDC_RERENTALS, work: async () => {
      const data = await loadHdcRerentals(sourceFetch);
      await bucket.put(HDC_KEY, JSON.stringify({ ...data, checkedAt: at }));
      return { status: 'updated', updatedAt: at, listingCount: data.results.length };
    } }] : []),
    ...(liveChecks.includes('openigloo') ? [{ id: 'openigloo', name: 'Openigloo', work: async () =>
      refreshOpenigloo(bucket, await liveData('openigloo', loadOpenigloo), at) }] : []),
    ...DIRECT_RENTAL_SOURCES.filter(({ id }) => liveChecks.includes(id)).map((source) => ({
      id: source.id, name: source.name, work: async () =>
        refreshDirectRentals(bucket, source, await liveData(source.id, source.load), at),
    })),
    ...feedChecks.map((feed) => ({ id: feed.id, name: feed.name, work: async () => {
      const result = await loadFeed(feed, sourceFetch);
      const listings = result.listings.map((listing) => ({ ...listing, checkedAt: at }));
      await saveObservedSnapshot(bucket, FEED_PREFIX + feed.id + '.json.gz', result, listings, feed.id, at);
      return { status: 'updated', updatedAt: at, listingCount: listings.length, pages: result.pages };
    } })),
  ];
  const checks = selected ? candidates.filter(({ id }) => id === selected) : candidates;
  const results = await Promise.allSettled(checks.map(({ work }) => work()));
  const attempted = checks.map(({ id, name }, index) => {
    const result = results[index];
    const older = previousById.get(id);
    const next = result.status === 'fulfilled' ? result.value : null;
    const failure = result.status === 'rejected' ? result.reason : null;
    const item: SourceStatus = { id, name, checkedAt: at, status: next?.status ?? 'failed',
      updatedAt: next?.updatedAt ?? older?.updatedAt ?? null };
    if (id === STREETEASY_LIVE.id || id === 'hotpads-live') item.requestTransport = onDemand ? listingTransports?.[id] ?? 'not-recorded' : 'import';
    if (id === STREETEASY_LIVE.id && (onDemand || next?.transport === STREETEASY_TRANSPORT)) item.transport = STREETEASY_TRANSPORT;
    if (id === HDC_RERENTALS.id) item.listingCount = next?.listingCount ?? older?.listingCount;
    if (id === 'firstmover') {
      item.month = next?.month ?? older?.month ?? SNAPSHOT_MONTH;
      if (!next) item.error = failure instanceof Error &&
        /^FirstMover |^The (latest )?FirstMover /.test(failure.message) ? failure.message : 'The FirstMover import failed.';
    } else if (id === 'openigloo') {
      const counts = next ?? older;
      if (counts?.updatedAt) {
        item.listingCount = counts.listingCount;
        item.total = counts.total;
        item.sampleLimit = counts.sampleLimit;
      }
      if (!next) item.error = 'The Openigloo live sample could not be refreshed.';
    } else if (DIRECT_BY_ID.has(id)) {
      const counts = next ?? older;
      if (counts?.updatedAt) {
        item.listingCount = counts.listingCount;
        item.pages = counts.pages;
        if (counts.total !== undefined) item.total = counts.total;
      }
      if (!next) item.error = 'The ' + name + ' live sample could not be refreshed.';
    } else {
      const listingCount = next?.listingCount ?? older?.listingCount;
      if (listingCount !== undefined) item.listingCount = listingCount;
      const pages = next?.pages ?? older?.pages;
      if (pages !== undefined) item.pages = pages;
      if (!next) item.error = failure?.code === 'incomplete_feed' ?
        name + ' returned an incomplete inventory.' : name + ' could not be refreshed.';
    }
    if (!next && onDemand) {
      const status = failure?.httpStatus;
      if (status) item.error = name + ' returned HTTP ' + status + '.';
      else if (failure?.name === 'TimeoutError') item.error = name + ' did not respond in time.';
      Object.assign(item, retrySchedule(failure, older?.transport === item.transport ? older : undefined, now.getTime()));
    }
    return item;
  });

  const retainedIds = new Set([...PUBLIC_IDS, ...LIVE_IDS, HDC_RERENTALS.id, ...feeds.map(({ id }) => id)]);
  const sources = [...attempted, ...(previous.sources ?? []).filter(({ id }) => !ids.includes(id) && retainedIds.has(id))];
  const marketResult = results[checks.findIndex(({ id }) => id === 'firstmover')];
  const market = marketResult?.status === 'fulfilled' ? marketResult.value : previous.market;
  const state = { running: false, hour, lastCheckedAt: at, market: market ? {
    revision: market.revision, catalogEtag: market.catalogEtag, csvEtag: market.csvEtag,
  } : null, sources };
  const saved = await bucket.put(STATE_KEY, JSON.stringify(state), { onlyIf: { etagMatches: lease.etag } });
  if (!saved) return { state: 'superseded', ...publicStatus((await readState(bucket)).value) };
  const result = publicStatus(state);
  return { state: result.sources.some(({ status }) => status === 'failed') ? 'partial' : 'complete', ...result };
}
