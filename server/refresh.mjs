import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { decodeMarketRows, marketSnapshot, SNAPSHOT_MONTH } from '../src/market.mjs';
import { checkFirstMover } from './firstmover.mjs';
import { configuredFeeds, loadFeed } from './listings.mjs';
import { housingDate, loadHousingConnect } from './housing.mjs';

const STATE_KEY = 'rentals/refresh.json';
const MARKET_KEY = 'rentals/firstmover.json.gz';
const MARKET_SCHEMA = 'companies-1';
const OPENIGLOO_KEY = 'rentals/openigloo.json.gz';
const PUBLIC_IDS = ['firstmover', 'housingconnect'];
const HOUSING_KEY = 'rentals/housing-connect.json';
const FEED_PREFIX = 'rentals/feeds/';
const LOCK_TIMEOUT = 5 * 60_000;
const LIVE_MAX_AGE = 2 * 60 * 60_000;
let cachedMarket;

const compressed = (value) => gzipSync(strToU8(JSON.stringify(value)));
const unpack = async (object) => JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer()))));

async function readState(bucket) {
  const object = await bucket?.get(STATE_KEY);
  return object ? { value: await object.json(), etag: object.etag } : { value: {}, etag: null };
}

function publicStatus(state) {
  return { lastCheckedAt: state.lastCheckedAt ?? null, sources: state.sources ?? [] };
}

export async function refreshStatus(bucket) {
  return publicStatus((await readState(bucket)).value);
}

function checkedDuring(sources, ids, hour) {
  return ids.every((id) => sources?.some((source) =>
    source.id === id && source.status !== 'failed' && source.checkedAt?.slice(0, 13) === hour));
}

export function openiglooRecent(status, now = new Date()) {
  const source = status?.sources.find(({ id }) => id === 'openigloo');
  return now.getTime() - Date.parse(source?.updatedAt) <= LIVE_MAX_AGE;
}

export async function storedOpenigloo(bucket) {
  const object = await bucket?.get(OPENIGLOO_KEY);
  return object ? unpack(object) : null;
}

export async function refreshPlan(bucket, now = new Date()) {
  const [{ value }, object] = await Promise.all([readState(bucket), bucket?.head(MARKET_KEY)]);
  const market = object?.customMetadata?.schema === MARKET_SCHEMA ? { ...object.customMetadata, catalogEtag: value.market?.revision === object.customMetadata.revision ?
    value.market.catalogEtag : '' } : null;
  const hour = now.toISOString().slice(0, 13);
  const privateFeeds = value.sources?.map(({ id }) => id).filter((id) => !PUBLIC_IDS.includes(id) && id !== 'openigloo') ?? [];
  return { ready: Boolean(bucket), market,
    alreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, [...PUBLIC_IDS, 'openigloo', ...privateFeeds], hour),
    publicAlreadyChecked: Boolean(market) && !value.running && checkedDuring(value.sources, PUBLIC_IDS, hour),
    ...publicStatus(value) };
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

export async function storedFeed(bucket, feed) {
  const object = await bucket.get(FEED_PREFIX + feed.id + '.json.gz');
  if (!object) throw new Error('This feed has not completed its first refresh.');
  return unpack(object);
}

async function refreshMarket(bucket, previous, checkedAt, fetcher, imported, isImport) {
  const stored = await bucket.head(MARKET_KEY);
  const baseline = stored?.customMetadata?.schema === MARKET_SCHEMA ? { ...stored.customMetadata,
    catalogEtag: previous?.revision === stored.customMetadata.revision ? previous.catalogEtag : '',
  } : null;
  const result = isImport ? imported : await checkFirstMover(baseline, fetcher);
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
    await bucket.put(MARKET_KEY, compressed(result.rows), {
      customMetadata: { month: result.month, revision: result.revision, updatedAt, schema: MARKET_SCHEMA },
    });
  }
  return { status: result.changed ? 'updated' : 'current', month: result.month,
    revision: result.revision, catalogEtag: result.catalogEtag, updatedAt };
}

export async function storedHousing(bucket, now = new Date()) {
  const object = await bucket?.get(HOUSING_KEY);
  if (!object) return { publishedAt: null, checkedAt: null, opportunities: [] };
  const data = await object.json();
  const today = housingDate(now);
  return { ...data, checkedAt: object.customMetadata.updatedAt,
    opportunities: data.opportunities.filter(({ closes }) => closes >= today) };
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

async function refreshOpenigloo(bucket, result, at) {
  if (!Array.isArray(result?.listings) || result.listings.length > 10 ||
      result.listings.some((listing) => listing.kind !== 'feed' || listing.region !== 'nyc' ||
        !Array.isArray(listing.sources) || listing.sources[0]?.id !== 'openigloo' ||
        !/^https:\/\/www\.openigloo\.com\/unit\/nyc\//.test(listing.sources[0]?.url ?? ''))) {
    throw new Error('Openigloo did not return a valid live sample.');
  }
  await bucket.put(OPENIGLOO_KEY, compressed(result), { customMetadata: { updatedAt: at } });
  return { status: 'updated', updatedAt: at, listingCount: result.listings.length,
    total: result.total, rentLimit: result.rentLimit, sampleLimit: result.sampleLimit };
}

export async function refreshSources(env, { fetcher = fetch, now = new Date(), imports } = {}) {
  const bucket = env.BUCKET;
  if (!bucket) throw new Error('Hourly source storage is unavailable.');
  const feeds = configuredFeeds(env);
  const current = await readState(bucket);
  const at = now.toISOString();
  const hour = at.slice(0, 13);
  const previous = current.value;
  if (previous.running && now.getTime() - Date.parse(previous.startedAt) < LOCK_TIMEOUT) {
    return { state: 'running', ...publicStatus(previous) };
  }
  const includeOpenigloo = imports && Object.hasOwn(imports, 'openigloo');
  const ids = [...PUBLIC_IDS, ...(includeOpenigloo ? ['openigloo'] : []), ...feeds.map(({ id }) => id)];
  if (!previous.running && !imports?.firstmover?.changed && checkedDuring(previous.sources, ids, hour)) {
    return { state: 'already_checked', ...publicStatus(previous) };
  }

  const lease = await bucket.put(STATE_KEY, JSON.stringify({ ...previous, running: true, startedAt: at }), {
    onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
  });
  if (!lease) return { state: 'running', ...publicStatus((await readState(bucket)).value) };

  const previousById = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  const checks = [
    { id: 'firstmover', name: 'FirstMover (StreetEasy)', work: () =>
      refreshMarket(bucket, previous.market, at, fetcher, imports?.firstmover, Boolean(imports)) },
    { id: 'housingconnect', name: 'NYC Housing Connect', work: () =>
      refreshHousing(bucket, at, fetcher, now, imports?.housingconnect, Boolean(imports)) },
    ...(includeOpenigloo ? [{ id: 'openigloo', name: 'Openigloo', work: () =>
      refreshOpenigloo(bucket, imports.openigloo, at) }] : []),
    ...feeds.map((feed) => ({ id: feed.id, name: feed.name, work: async () => {
      const result = await loadFeed(feed, fetcher);
      await bucket.put(FEED_PREFIX + feed.id + '.json.gz', compressed(result));
      return { status: 'updated', updatedAt: at };
    } })),
  ];
  const results = await Promise.allSettled(checks.map(({ work }) => work()));
  const attempted = checks.map(({ id, name }, index) => {
    const result = results[index];
    const older = previousById.get(id);
    const next = result.status === 'fulfilled' ? result.value : null;
    const item = { id, name, checkedAt: at, status: next?.status ?? 'failed',
      updatedAt: next?.updatedAt ?? older?.updatedAt ?? null };
    if (id === 'firstmover') {
      item.month = next?.month ?? older?.month ?? SNAPSHOT_MONTH;
      if (!next) item.error = result.reason instanceof Error &&
        /^FirstMover |^The (latest )?FirstMover /.test(result.reason.message) ? result.reason.message : 'The FirstMover import failed.';
    } else if (id === 'openigloo') {
      const counts = next ?? older;
      if (counts?.updatedAt) {
        item.listingCount = counts.listingCount;
        item.total = counts.total;
        item.rentLimit = counts.rentLimit;
        item.sampleLimit = counts.sampleLimit;
      }
      if (!next) item.error = 'The Openigloo live sample could not be refreshed.';
    } else if (!next) {
      item.error = id === 'housingconnect' ? 'NYC Open Data could not be refreshed.' : 'The configured feed could not be refreshed.';
    }
    return item;
  });

  const sources = [...attempted, ...(previousById.has('openigloo') && !includeOpenigloo ? [previousById.get('openigloo')] : [])];
  const market = results[0].status === 'fulfilled' ? results[0].value : previous.market;
  const state = { running: false, hour, lastCheckedAt: at, market: market ? {
    revision: market.revision, catalogEtag: market.catalogEtag,
  } : null, sources };
  const saved = await bucket.put(STATE_KEY, JSON.stringify(state), { onlyIf: { etagMatches: lease.etag } });
  if (!saved) return { state: 'superseded', ...publicStatus((await readState(bucket)).value) };
  return { state: attempted.some(({ status }) => status === 'failed') ? 'partial' : 'complete', ...publicStatus(state) };
}
