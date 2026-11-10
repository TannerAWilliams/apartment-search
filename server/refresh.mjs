import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { decodeMarketRows, marketSnapshot, SNAPSHOT_MONTH } from '../src/market.mjs';
import { checkFirstMover } from './firstmover.mjs';
import { configuredFeeds, loadFeed } from './listings.mjs';
import { housingDate, loadHousingConnect } from './housing.mjs';

const STATE_KEY = 'rentals/refresh.json';
const MARKET_KEY = 'rentals/firstmover.json.gz';
const HOUSING_KEY = 'rentals/housing-connect.json';
const FEED_PREFIX = 'rentals/feeds/';
const LOCK_TIMEOUT = 5 * 60_000;
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

async function refreshMarket(bucket, previous, checkedAt, fetcher) {
  const stored = await bucket.head(MARKET_KEY);
  const baseline = stored ? { ...stored.customMetadata,
    catalogEtag: previous?.revision === stored.customMetadata.revision ? previous.catalogEtag : '',
  } : null;
  const result = await checkFirstMover(baseline, fetcher);
  const updatedAt = result.changed ? checkedAt : baseline.updatedAt;
  if (result.changed) {
    await bucket.put(MARKET_KEY, compressed(result.rows), {
      customMetadata: { month: result.month, revision: result.revision, updatedAt },
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

async function refreshHousing(bucket, checkedAt, fetcher, now) {
  const data = JSON.stringify(await loadHousingConnect(fetcher, now));
  const previous = await bucket.get(HOUSING_KEY);
  if (previous && await previous.text() === data) {
    return { status: 'current', updatedAt: previous.customMetadata.updatedAt };
  }
  await bucket.put(HOUSING_KEY, data, { customMetadata: { updatedAt: checkedAt } });
  return { status: 'updated', updatedAt: checkedAt };
}

export async function refreshSources(env, { fetcher = fetch, now = new Date() } = {}) {
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
  if (!previous.running && previous.hour === hour && previous.sources?.every(({ status }) => status !== 'failed')) {
    return { state: 'already_checked', ...publicStatus(previous) };
  }

  const lease = await bucket.put(STATE_KEY, JSON.stringify({ ...previous, running: true, startedAt: at }), {
    onlyIf: current.etag ? { etagMatches: current.etag } : { etagDoesNotMatch: '*' },
  });
  if (!lease) return { state: 'running', ...publicStatus((await readState(bucket)).value) };

  const previousById = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  const checks = [
    { id: 'firstmover', name: 'FirstMover (StreetEasy)', work: () =>
      refreshMarket(bucket, previous.market, at, fetcher) },
    { id: 'housingconnect', name: 'NYC Housing Connect', work: () =>
      refreshHousing(bucket, at, fetcher, now) },
    ...feeds.map((feed) => ({ id: feed.id, name: feed.name, work: async () => {
      const result = await loadFeed(feed, fetcher);
      await bucket.put(FEED_PREFIX + feed.id + '.json.gz', compressed(result));
      return { status: 'updated', updatedAt: at };
    } })),
  ];
  const results = await Promise.allSettled(checks.map(({ work }) => work()));
  const sources = checks.map(({ id, name }, index) => {
    const result = results[index];
    const older = previousById.get(id);
    const next = result.status === 'fulfilled' ? result.value : null;
    const item = { id, name, checkedAt: at, status: next?.status ?? 'failed',
      updatedAt: next?.updatedAt ?? older?.updatedAt ?? null };
    if (id === 'firstmover') {
      item.month = next?.month ?? older?.month ?? SNAPSHOT_MONTH;
      if (!next) item.error = result.reason instanceof Error &&
        /^FirstMover |^The (latest )?FirstMover /.test(result.reason.message) ? result.reason.message : 'The FirstMover import failed.';
    } else if (!next) {
      item.error = id === 'housingconnect' ? 'NYC Open Data could not be refreshed.' : 'The configured feed could not be refreshed.';
    }
    return item;
  });

  const market = results[0].status === 'fulfilled' ? results[0].value : previous.market;
  const state = { running: false, hour, lastCheckedAt: at, market: market ? {
    revision: market.revision, catalogEtag: market.catalogEtag,
  } : null, sources };
  const saved = await bucket.put(STATE_KEY, JSON.stringify(state), { onlyIf: { etagMatches: lease.etag } });
  if (!saved) return { state: 'superseded', ...publicStatus((await readState(bucket)).value) };
  return { state: sources.some(({ status }) => status === 'failed') ? 'partial' : 'complete', ...publicStatus(state) };
}
