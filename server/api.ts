import { companyCounts } from '../src/companies.ts';
import { matchListings, needsCommute, parseFilters, SearchInputError } from '../src/search.ts';
import { formatSearch, RENT_GROUPINGS, rentAreas, SNAPSHOT_MONTH } from '../src/market.ts';
import { NYC_SEARCH_AREAS, REGIONS } from '../src/regions.ts';
import { buildingKey, mergeListings } from '../src/listings.ts';
import { configuredFeeds, loadFeed } from './listings.ts';
import { CommuteError, geocodeAddress, resolveWorkplace, routeCommutes, routingCredentials } from './commute.ts';
import { OPENIGLOO } from './openigloo.ts';
import { DIRECT_RENTAL_SOURCES } from './direct-rentals.ts';
import { decodeSourceImport } from '../src/pull-sources.ts';
import { type SourceFetch, refreshPlan, refreshSources, refreshStatus, sourceRecent, storedDirectRentals, storedFeed, storedHdcRerentals, storedHousing, storedMarket,
  storedOpenigloo, storedRentHistory } from './refresh.ts';

const REQUEST_LIMIT = 4096;
const IMPORT_LIMIT = 2 * 1024 * 1024;
const API_PATHS = new Set(['/api/config', '/api/search', '/api/geocode', '/api/market', '/api/housing', '/api/refresh']);

export function appConfig(env) {
  const feeds = configuredFeeds(env);
  return {
    mode: feeds.length > 0 ? 'live' : 'snapshot',
    snapshotMonth: SNAPSHOT_MONTH,
    sources: feeds.map(({ id, name }) => ({ id, name })),
    ...(routingCredentials(env) ? { commuteConfigured: true } : {}),
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

async function storedSample(status, id, liveOnly, load) {
  const sourceStatus = status?.sources.find((source) => source.id === id);
  const recent = sourceRecent(status, id);
  const data = recent || (!liveOnly && sourceStatus?.updatedAt) ? await load().catch(() => null) : null;
  const listings = data?.listings.map((listing) => recent ? listing : {
    ...listing, kind: 'cached', sources: listing.sources.map((source) => ({ ...source, kind: 'cached' })),
  }) ?? [];
  return { sourceStatus, recent, data, listings };
}

export async function search(rawFilters, env, fetcher: SourceFetch = fetch) {
  const filters = parseFilters(rawFilters);
  const requireCommute = needsCommute(filters);
  const credentials = routingCredentials(env);
  if (requireCommute && !credentials) throw new CommuteError('Automatic commute estimates are unavailable because the routing service is disconnected.');
  const feeds = configuredFeeds(env);
  const workplace = await resolveWorkplace(filters, fetcher);
  const bucket = env.BUCKET;
  async function finish(listings, mode, sources, notices, snapshotMonth?: string) {
    const matched = matchListings(listings, filters, workplace);
    let routed = matched;
    const commute: { commute?: boolean; commuteNotice?: string } = {};
    if (credentials && (requireCommute || filters.includeCommute)) {
      try {
        routed = await routeCommutes(matched, workplace, credentials, fetcher);
        commute.commute = true;
      } catch (error) {
        if (requireCommute || !(error instanceof CommuteError)) throw error;
        commute.commuteNotice = error.message;
      }
    }
    const result = formatSearch(routed, filters, workplace, mode, sources, notices);
    return withHousingLinks({ ...result, ...(snapshotMonth ? { snapshotMonth } : {}), ...commute }, bucket);
  }
  const status = bucket ? await refreshStatus(bucket) : null;
  const sourceRegion = Object.hasOwn(NYC_SEARCH_AREAS, filters.region) ? 'nyc' : filters.region;
  const directSources = DIRECT_RENTAL_SOURCES.filter(({ regions }) => sourceRegion === 'all' || regions.includes(sourceRegion));
  const [openigloo, direct, results] = await Promise.all([
    storedSample(status, OPENIGLOO.id, filters.liveOnly, () => storedOpenigloo(bucket)),
    Promise.all(directSources.map(async (source) => ({
      source,
      ...await storedSample(status, source.id, filters.liveOnly, () => storedDirectRentals(bucket, source)),
    }))),
    Promise.allSettled(feeds.map(async (feed) => {
      if (bucket) return storedSample(status, feed.id, filters.liveOnly, () => storedFeed(bucket, feed));
      const data = await loadFeed(feed, fetcher);
      return { data, listings: data.listings, recent: true };
    })),
  ]);
  const listings = [...openigloo.listings];
  const sources: { id: string; name: string; status: string; sample?: boolean }[] = openigloo.data ? [{ id: OPENIGLOO.id, name: OPENIGLOO.name, status: openigloo.recent ? 'searched' : 'cached' }] : [];
  const notices = openigloo.data ? [
    'Openigloo · ' + openigloo.listings.length + ' apartments from ' + (openigloo.recent ? 'its recent check.' : 'its last saved check.'),
  ] : [];
  for (const { source, sourceStatus, recent, data, listings: rows } of direct) {
    if (data) {
      listings.push(...rows);
      sources.push({ id: source.marketplace, name: source.name, status: recent ? 'searched' : 'cached', sample: true });
      notices.push(source.name + ' · ' + rows.length + (recent ? ' apartments checked in ' : ' saved apartments in ') + source.coverage + '.');
    }
    if (sourceStatus?.status === 'failed') {
      if (!data) sources.push({ id: source.marketplace, name: source.name, status: 'unavailable', sample: true });
    }
  }

  for (const [index, result] of results.entries()) {
    const { id, name } = feeds[index];
    const value = result.status === 'fulfilled' ? result.value : null;
    if (!value?.data) {
      sources.push({ id, name, status: 'unavailable' });
      notices.push(`${name} has no listings for this view.`);
    } else {
      sources.push({ id, name, status: value.recent ? 'searched' : 'cached' });
      listings.push(...value.listings);
      if (value.data.limited) notices.push(`${name} returned partial inventory.`);
      if (!value.recent) notices.push(`${name} · showing its last saved listings.`);
    }
  }

  const hasLive = sources.some(({ status: state }) => state === 'searched');
  const hasSavedSamples = openigloo.data || direct.some(({ data }) => data) || sources.some(({ status }) => status === 'cached');
  if (!hasLive && !filters.liveOnly && !hasSavedSamples) {
    const market = await storedMarket(bucket);
    return finish(market.listings, 'snapshot', [{ id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' }, ...sources], notices, market.month);
  }
  if (!hasLive && filters.liveOnly) {
    return finish([], 'live', sources, [...notices, 'No sources have recently confirmed active rentals.']);
  }
  if (!filters.liveOnly && (bucket || hasSavedSamples)) {
    const market = await storedMarket(bucket);
    const historical = new Map<string, { id: string; company?: string }>(market.listings.map((listing) => [listing.sources[0].url, listing]));
    const live = mergeListings(listings.filter(({ kind }) => kind === 'feed'));
    const cached = mergeListings(listings.filter(({ kind }) => kind === 'cached'));
    const current = mergeListings([...live, ...cached], { preferFirst: true }).map((listing) => {
      const prior = historical.get(listing.sources.find(({ id }) => id === 'streeteasy')?.url);
      return prior ? { ...listing, id: prior.id, companyFromSnapshot: !listing.company && Boolean(prior.company) } : listing;
    });
    return finish(mergeListings([...current, ...market.listings], { preferFirst: true }), 'mixed',
      [{ id: 'firstmover', name: 'FirstMover (StreetEasy)', status: 'snapshot' }, ...sources], notices, market.month);
  }
  return finish(mergeListings(listings), 'live', sources, notices);
}

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleApi(request, env, { requireToken = false, fetcher = (url, options) => globalThis.fetch(url, options), waitUntil }: { requireToken?: boolean; fetcher?: SourceFetch; waitUntil?: (work: Promise<unknown>) => void } = {}) {
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
      const liveSources = [
        ...DIRECT_RENTAL_SOURCES.filter(({ id }) => sourceRecent(refresh, id))
          .map(({ marketplace: id, name, coverage }) => ({ id, name, sample: true, coverage })),
        ...(sourceRecent(refresh, OPENIGLOO.id) ? [{ id: OPENIGLOO.id, name: OPENIGLOO.name, sample: true, coverage: 'NYC' }] : []),
      ];
      const companies = companyCounts((await storedMarket(env.BUCKET)).listings);
      return json({ ...config, refresh, companies,
        mode: liveSources.length ? 'live' : config.mode,
        sources: [...liveSources, ...config.sources.filter(({ id }) => !liveSources.some((item) => item.id === id))],
        snapshotMonth: refresh.sources.find(({ id }) => id === 'firstmover')?.month ?? SNAPSHOT_MONTH,
      });
    } catch {
      return json({ error: 'The free feed settings need to be corrected on the server.' }, 503);
    }
  }
  if (path === '/api/housing') {
    if (request.method !== 'GET') return json({ error: 'Use GET for affordable housing.' }, 405);
    try {
      const [housing, rerentals] = await Promise.all([storedHousing(env.BUCKET), storedHdcRerentals(env.BUCKET).catch(() => null)]);
      return json({ ...housing, rerentals });
    } catch {
      return json({ error: 'The Housing Connect data could not be read.' }, 503);
    }
  }
  if (path === '/api/market') {
    if (request.method !== 'GET') return json({ error: 'Use GET for rent data.' }, 405);
    const region = searchParams.get('region') ?? 'all';
    const grouping = searchParams.get('grouping') ?? 'neighborhood';
    if (!Object.hasOwn(REGIONS, region) || !Object.hasOwn(RENT_GROUPINGS, grouping)) {
      return json({ error: 'Choose a valid region and grouping.' }, 422);
    }
    try {
      const market = await storedMarket(env.BUCKET);
      const areas = rentAreas(market.listings, { region, grouping });
      const scoped = Object.hasOwn(NYC_SEARCH_AREAS, region);
      const history = await storedRentHistory(env.BUCKET, market.month, scoped ? 'nyc' : region, grouping);
      const areaIds = new Set(areas.filter(({ id }) => id !== 'overall').map(({ id }) => id));
      return json({ month: market.month, areas, history: scoped ?
        history.map(([month, rows]) => [month, rows.filter(([id]) => areaIds.has(id))]) : history });
    } catch {
      return json({ error: 'The refreshed rent data could not be read.' }, 503);
    }
  }
  if (path === '/api/refresh' && request.method === 'GET') {
    return json(await refreshPlan(env.BUCKET));
  }
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405);
  if (path === '/api/refresh' && (!env.BUCKET || !request.headers.get('Content-Type')?.startsWith('application/json'))) {
    return json({ error: 'A private hosted site and a JSON request are required to refresh sources.' }, 400);
  }
  const maxBytes = path === '/api/refresh' ? IMPORT_LIMIT : REQUEST_LIMIT;
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    return json({ error: 'The request is too large.' }, 413);
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return json({ error: 'The request is too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Send a JSON request.' }, 400);
  }
  try {
    if (path === '/api/refresh') {
      if (body?.check === 'now') {
        const work = refreshSources(env, { fetcher, onDemand: true });
        waitUntil?.(work.catch(() => {}));
        return json(await work);
      }
      let imports;
      try { imports = decodeSourceImport(body); }
      catch { return json({ error: 'Send a valid compressed source import.' }, 422); }
      const result = await refreshSources(env, { fetcher, imports, fallback: body.fallback === true });
      const unavailable = result.state === 'partial' && result.sources.every(({ status }) =>
        status === 'failed' || status === 'feed_required');
      return json(result, unavailable ? 502 : 200);
    }
    if (path === '/api/geocode') return json(await geocodeAddress(body?.address, fetcher));
    if ((body?.includeCommute || needsCommute(body ?? {})) && !request.headers.get('Content-Type')?.startsWith('application/json')) {
      return json({ error: 'Send commute searches as JSON.' }, 400);
    }
    return json(await search(body, env, fetcher));
  } catch (error) {
    if (error instanceof CommuteError) return json({ error: error.message, commuteError: true }, error.status);
    if (error instanceof SearchInputError) return json({ error: error.message }, 422);
    if (path === '/api/refresh') return json({ error: 'The listing sources could not be checked. Try reloading the page.' }, 502);
    return json({ error: 'The address or listing feed could not be reached. Try again or use a workplace preset.' }, 502);
  }
}
