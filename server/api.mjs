import { parseFilters, SearchInputError } from '../src/search.mjs';
import { localSearch, rentAreas, snapshotSearch, SNAPSHOT_MONTH } from '../src/market.mjs';
import { REGIONS } from '../src/regions.mjs';
import { buildingKey, mergeListings } from '../src/listings.mjs';
import { configuredFeeds, loadFeed } from './listings.mjs';
import { geocodeAddress, resolveWorkplace } from './commute.mjs';
import { refreshSources, refreshStatus, storedFeed, storedHousing, storedMarket } from './refresh.mjs';

const REQUEST_LIMIT = 4096;
const API_PATHS = new Set(['/api/config', '/api/search', '/api/geocode', '/api/market', '/api/housing', '/api/refresh']);

export function appConfig(env) {
  const feeds = configuredFeeds(env);
  return {
    mode: feeds.length > 0 ? 'live' : 'snapshot',
    snapshotMonth: SNAPSHOT_MONTH,
    sources: feeds.map(({ id, name }) => ({ id, name })),
  };
}

async function withHousingLinks(result, bucket) {
  if (!bucket || !result.matches.some(({ region }) => region === 'nyc')) return result;

  let housing;
  try {
    housing = await storedHousing(bucket);
  } catch {
    return result;
  }
  const byAddress = new Map();
  for (const { name, url, buildingKeys } of housing.opportunities) {
    for (const key of buildingKeys ?? []) {
      if (!byAddress.has(key)) byAddress.set(key, []);
      byAddress.get(key).push({ name, url });
    }
  }
  return { ...result, matches: result.matches.map((listing) => {
    const buildingLinks = byAddress.get(buildingKey(listing));
    return buildingLinks ? { ...listing, buildingLinks } : listing;
  }) };
}

export async function search(rawFilters, env, fetcher = fetch) {
  const filters = parseFilters(rawFilters);
  const feeds = configuredFeeds(env);
  const workplace = await resolveWorkplace(filters, fetcher);
  const bucket = env.BUCKET;
  if (!feeds.length) {
    return withHousingLinks(snapshotSearch(filters, workplace, await storedMarket(bucket)), bucket);
  }

  const status = bucket ? await refreshStatus(bucket) : null;
  const results = await Promise.allSettled(feeds.map((feed) => bucket ? storedFeed(bucket, feed) : loadFeed(feed, fetcher)));
  const listings = [];
  const sources = [];
  const notices = [];
  for (const [index, result] of results.entries()) {
    const { id, name } = feeds[index];
    if (result.status === 'rejected') {
      sources.push({ id, name, status: 'unavailable' });
      notices.push(`${name} has no available listings from its last successful refresh.`);
    } else {
      sources.push({ id, name, status: 'searched' });
      listings.push(...result.value.listings);
      if (result.value.limited) notices.push(`${name} returned partial inventory.`);
      if (status?.sources.some((source) => source.id === id && source.status === 'failed')) {
        notices.push(`${name} could not be refreshed. Showing its last successful data.`);
      }
    }
  }

  if (sources.every(({ status }) => status === 'unavailable')) {
    const fallback = snapshotSearch(filters, workplace, await storedMarket(bucket));
    return withHousingLinks({ ...fallback, sources: [...fallback.sources, ...sources],
      notices: [...notices, ...fallback.notices] }, bucket);
  }
  return withHousingLinks(localSearch(mergeListings(listings), filters, workplace, 'live', sources, notices), bucket);
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleApi(request, env, { requireToken = false } = {}) {
  const { pathname: path, searchParams } = new URL(request.url);
  if (!API_PATHS.has(path)) return json({ error: 'Endpoint not found.' }, 404);
  if (requireToken && request.headers.get('Authorization') !== `Bearer ${env.APP_ACCESS_TOKEN}`) {
    return json({ error: 'Enter your apartment search server access token.' }, 401);
  }
  if (path === '/api/config') {
    if (request.method !== 'GET') return json({ error: 'Use GET for app configuration.' }, 405);
    try {
      const config = appConfig(env);
      if (!env.BUCKET) return json(config);
      const refresh = await refreshStatus(env.BUCKET);
      return json({ ...config, refresh,
        snapshotMonth: refresh.sources.find(({ id }) => id === 'firstmover')?.month ?? SNAPSHOT_MONTH,
      });
    } catch {
      return json({ error: 'The free feed settings need to be corrected on the server.' }, 503);
    }
  }
  if (path === '/api/housing') {
    if (request.method !== 'GET') return json({ error: 'Use GET for affordable housing.' }, 405);
    try {
      return json(await storedHousing(env.BUCKET));
    } catch {
      return json({ error: 'The Housing Connect data could not be read.' }, 503);
    }
  }
  if (path === '/api/market') {
    if (request.method !== 'GET') return json({ error: 'Use GET for rent data.' }, 405);
    const region = searchParams.get('region') ?? 'all';
    const grouping = searchParams.get('grouping') ?? 'neighborhood';
    if (!Object.hasOwn(REGIONS, region) || !['neighborhood', 'city', 'zip'].includes(grouping)) {
      return json({ error: 'Choose a valid region and grouping.' }, 422);
    }
    try {
      const market = await storedMarket(env.BUCKET);
      return json({ month: market.month, areas: rentAreas(market.listings, { region, grouping }) });
    } catch {
      return json({ error: 'The refreshed rent data could not be read.' }, 503);
    }
  }
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405);
  if (path === '/api/refresh' && (!env.BUCKET || !request.headers.get('Content-Type')?.startsWith('application/json'))) {
    return json({ error: 'A private hosted site and a JSON request are required to refresh sources.' }, 400);
  }
  if (Number(request.headers.get('Content-Length')) > REQUEST_LIMIT) {
    return json({ error: 'The request is too large.' }, 413);
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > REQUEST_LIMIT) return json({ error: 'The request is too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Send a JSON request.' }, 400);
  }
  try {
    if (path === '/api/refresh') {
      const result = await refreshSources(env);
      const unavailable = result.state === 'partial' && result.sources.every(({ status }) => status === 'failed');
      return json(result, unavailable ? 502 : 200);
    }
    return json(path === '/api/geocode' ? await geocodeAddress(body?.address) : await search(body, env));
  } catch (error) {
    if (error instanceof SearchInputError) return json({ error: error.message }, 422);
    return json({ error: 'The address or listing feed could not be reached. Try again or use a workplace preset.' }, 502);
  }
}
