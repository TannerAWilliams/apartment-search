import type { AppEnv, Bucket } from './contracts.ts';
import type { ListingData, SourceStatus as SearchSource, SearchResult } from '../src/domain.ts';
import type { SourceStatus } from './refresh.ts';
import { CITYREALTY_COVERAGE, CITYREALTY_ID, CITYREALTY_TRANSPORT } from './cityrealty.ts';
import { ZUMPER_COVERAGE, ZUMPER_TRANSPORT } from './zumper.ts';
import { dashboardSnapshot } from './dashboard-snapshot.ts';
import { retrieveBuildingRecords } from './building-records.ts';
import { wholeSearchCheck } from './whole-search-check.ts';
import { relayConfig, type ListingTransports } from './relay-client.ts';
import { companyCounts } from '../src/companies.ts';
import { localWorkplace, matchListings, needsCommute, parseFilters, SearchInputError } from '../src/search.ts';
import { formatSearch, RENT_GROUPINGS, rentAreas, SNAPSHOT_MONTH } from '../src/market.ts';
import { parentRegion, REGIONS } from '../src/regions.ts';
import { buildingKey, listingWithVerifiedLinks, mergeListings } from '../src/listings.ts';
import { configuredFeeds, loadFeed, loadStreetEasyExport, STREETEASY_EXPORT_COVERAGE, STREETEASY_EXPORT_FORMAT } from './listings.ts';
import { CommuteError, geocodeAddress, resolveWorkplace, routeCommutes, routingCredentials } from './commute.ts';
import { OPENIGLOO } from './openigloo.ts';
import { DIRECT_RENTAL_SOURCES } from './direct-rentals.ts';
import { STREETEASY_LIVE, STREETEASY_PUBLIC_COVERAGE, STREETEASY_PUBLIC_TRANSPORT } from './streeteasy.ts';
import { decodeSourceImport } from '../src/pull-sources.ts';
import { type SourceFetch, refreshCatalog, refreshPlan, refreshSources, refreshStatus, sourceExpiresAt, sourceRecent, storedDirectRentals, storedFeed, storedHdcRerentals, storedHousing, storedMarket,
  storedOpenigloo, storedRentHistory, WORKFLOW_SOURCE_IDS } from './refresh.ts';

const REQUEST_LIMIT = 4096;
const IMPORT_LIMIT = 2 * 1024 * 1024;
const API_PATHS = new Set(['/api/dashboard', '/api/building-report', '/api/config', '/api/search', '/api/search-check', '/api/geocode', '/api/market', '/api/housing', '/api/refresh']);

export function appConfig(env: AppEnv) {
  const feeds = configuredFeeds(env).filter(({ id }) => env.STREETEASY_SYNC_ENABLED !== 'false' || id !== STREETEASY_LIVE.marketplace);
  return {
    mode: feeds.length > 0 ? 'live' : 'snapshot',
    storageMode: env.TEMPORARY_CACHE === 'true' ? 'temporary' : env.BUCKET ? 'persistent' : 'none',
    browserImportAllowed: env.PUBLIC_APP !== 'true',
    dashboardAvailable: env.PUBLIC_APP === 'true' || Boolean(env.APP_ACCESS_TOKEN),
    listingRequestTransport: relayConfig(env) ? 'relay' : 'direct',
    snapshotMonth: SNAPSHOT_MONTH,
    sources: feeds.map(({ id, name }) => ({ id, name })),
    ...(routingCredentials(env) ? { commuteConfigured: true } : {}),
  };
}

async function withHousingLinks<T extends { matches: ListingData[] }>(result: T, bucket: Bucket | undefined) {
  if (!bucket || !result.matches.some(({ region }) => region === 'nyc')) return result;

  let housing;
  try {
    housing = await storedHousing(bucket);
  } catch {
    return result;
  }
  const byAddress = new Map<string | null, { name: string; url: string }[]>();
  for (const { name, url, buildingKeys } of housing.opportunities) {
    for (const key of buildingKeys ?? []) {
      if (!byAddress.has(key)) byAddress.set(key, []);
      byAddress.get(key)!.push({ name, url });
    }
  }
  return { ...result, matches: result.matches.map((listing) => {
    const buildingLinks = byAddress.get(buildingKey(listing));
    return buildingLinks ? { ...listing, buildingLinks } : listing;
  }) };
}

async function storedSample(status: { sources: SourceStatus[] } | null, id: string, liveOnly: boolean, load: () => ReturnType<typeof storedOpenigloo>, strict = false, includeCached = false) {
  const sourceStatus = status?.sources.find((source) => source.id === id);
  const recent = sourceRecent(status, id);
  const data = recent || ((!liveOnly || includeCached) && sourceStatus?.updatedAt) ? await load().catch(error => { if (strict) throw error; return null; }) : null;
  const listings = data?.listings.map((listing) => recent ? listing : {
    ...listing, kind: 'cached', sources: listing.sources.map((source) => ({ ...source, kind: 'cached' })),
  }) ?? [];
  return { sourceStatus, recent, data, listings };
}

type SearchResponse = SearchResult & { snapshotMonth?: string; commute?: boolean; commuteNotice?: string };
type ObservationResponse = { matches: ListingData[]; sources: SearchSource[]; notices: string[] };
export function search(rawFilters: Record<string, unknown>, env: AppEnv, fetcher?: SourceFetch, observationsOnly?: false): Promise<SearchResponse>;
export function search(rawFilters: Record<string, unknown>, env: AppEnv, fetcher: SourceFetch | undefined, observationsOnly: true): Promise<ObservationResponse>;
export async function search(rawFilters: Record<string, unknown>, env: AppEnv, fetcher: SourceFetch = fetch, observationsOnly = false) {
  const filters = parseFilters(rawFilters);
  const requireCommute = needsCommute(filters);
  const credentials = routingCredentials(env);
  if (requireCommute && !credentials) throw new CommuteError('Automatic commute estimates are unavailable because the routing service is disconnected.');
  const configured = configuredFeeds(env);
  const feeds = configured.filter(({ id }) => id !== STREETEASY_LIVE.marketplace ||
    (!env.BUCKET && env.STREETEASY_SYNC_ENABLED !== 'false'));
  const workplace = observationsOnly ? localWorkplace(filters) : await resolveWorkplace(filters, fetcher);
  const bucket = env.BUCKET;
  async function finish(listings: ListingData[], mode: string, sources: SearchSource[], notices: string[], snapshotMonth?: string) {
    const matched = matchListings(listings, filters, workplace).map(listingWithVerifiedLinks);
    let routed = matched;
    const commute: { commute?: boolean; commuteNotice?: string } = {};
    if (credentials && (requireCommute || filters.includeCommute)) {
      try {
        // Source selection is a privacy boundary: do not transmit origins for
        // apartments the user excluded. Preserve the full inventory for counts.
        const selectedIndexes = matched.flatMap((listing, index) => !filters.source ||
          listing.sources.some(source => source.id === filters.source && source.url) ? [index] : []);
        const selected = await routeCommutes(selectedIndexes.map(index => matched[index]), workplace, credentials, fetcher);
        const byIndex = new Map(selectedIndexes.map((index, position) => [index, selected[position]]));
        routed = matched.map((listing, index) => byIndex.get(index) ?? {
          ...listing, transitSeconds: null, drivingSeconds: null, commuteEstimate: undefined,
        });
        if (filters.source && (filters.maxTransitMinutes != null || filters.maxDrivingMinutes != null)) {
          notices = [...notices, 'Commute limits and eligible counts use only routes for the selected website. Other websites were not routed; their unknown travel times are excluded.'];
        }
        commute.commute = true;
      } catch (error) {
        if (requireCommute || !(error instanceof CommuteError)) throw error;
        commute.commuteNotice = error.message;
      }
    }
    if (observationsOnly) return { matches: filters.source ? routed.filter(listing => listing.sources.some(source => source.id === filters.source && source.url)) : routed, sources, notices };
    const result = formatSearch(routed, filters, workplace!, mode, sources, notices);
    // The client may warn when any contributing live inventory ages out, without
    // initiating another search or transmitting a destination in the background.
    const searched = new Set(sources.filter(source => source.status === 'searched').map(source => source.id));
    const expires = refreshCatalog(env).flatMap(definition => {
      if (!searched.has(definition.marketplace ?? definition.id) && !searched.has(definition.id)) return [];
      const at = sourceExpiresAt(status, definition.id, observedAt);
      return at ? [at] : [];
    }).sort();
    const inventoryExpiresAt = filters.liveOnly && !filters.includeCached ? expires[0] : undefined;
    return withHousingLinks({ ...result, ...(snapshotMonth ? { snapshotMonth } : {}), ...commute,
      ...(inventoryExpiresAt ? { inventoryExpiresAt } : {}) }, bucket);
  }
  const status = bucket ? await refreshStatus(bucket) : null;
  const observedAt = new Date();
  const sourceRegion = parentRegion(filters.region);
  const directSources = DIRECT_RENTAL_SOURCES.filter(({ regions }) => sourceRegion === 'all' || regions.includes(sourceRegion));
  const [openigloo, direct, results] = await Promise.all([
    storedSample(status, OPENIGLOO.id, filters.liveOnly, () => storedOpenigloo(bucket), observationsOnly, filters.includeCached),
    Promise.all(directSources.map(async (source) => ({
      source,
      ...await storedSample(status, source.id, filters.liveOnly, () => storedDirectRentals(bucket, source), observationsOnly, filters.includeCached),
    }))),
    Promise.allSettled(feeds.map(async (feed) => {
      if (bucket) return storedSample(status, feed.id, filters.liveOnly, () => storedFeed(bucket, feed), observationsOnly, filters.includeCached);
      const data = feed.format === STREETEASY_EXPORT_FORMAT ? await loadStreetEasyExport(feed, fetcher, observedAt) :
        await loadFeed(feed, fetcher);
      return { data, listings: data.listings, recent: true };
    })),
  ]);
  const listings: ListingData[] = [...openigloo.listings];
  const sources: { id: string; name: string; status: string; sample?: boolean }[] = openigloo.data ? [{ id: OPENIGLOO.id, name: OPENIGLOO.name, status: openigloo.recent ? 'searched' : 'cached' }] : [];
  const notices = openigloo.data ? [
    'Openigloo · ' + openigloo.listings.length + ' apartments from ' + (openigloo.recent ? 'its recent check.' : 'its last saved check.'),
  ] : [];
  for (const { source, sourceStatus, recent, data, listings: rows } of direct) {
    if (data) {
      listings.push(...rows);
      sources.push({ id: source.marketplace, name: source.name, status: recent ? 'searched' : 'cached',
        sample: data.transport !== STREETEASY_EXPORT_FORMAT && data.transport !== CITYREALTY_TRANSPORT && data.transport !== ZUMPER_TRANSPORT });
      const coverage = data.transport === STREETEASY_EXPORT_FORMAT ? STREETEASY_EXPORT_COVERAGE :
        data.transport === STREETEASY_PUBLIC_TRANSPORT ? STREETEASY_PUBLIC_COVERAGE :
        source.id === STREETEASY_LIVE.id && data.transport === 'partner-feed' ? 'the configured StreetEasy partner feed' : source.coverage;
      notices.push(source.name + ' · ' + rows.length + (recent ? ' apartments checked in ' : ' saved apartments in ') + coverage + '.');
    }
    if (sourceStatus?.status === 'failed') {
      if (!data) sources.push({ id: source.marketplace, name: source.name, status: 'unavailable', sample: true });
    }
  }

  for (const [index, result] of results.entries()) {
    if (observationsOnly && result.status === 'rejected') throw result.reason;
    const { id, name } = feeds[index];
    const value = result.status === 'fulfilled' ? result.value : null;
    if (!value?.data) {
      sources.push({ id, name, status: 'unavailable' });
      notices.push(`${name} has no listings for this view.`);
    } else {
      sources.push({ id, name, status: value.recent ? 'searched' : 'cached' });
      listings.push(...value.listings);
      if ('limited' in value.data && value.data.limited) notices.push(`${name} returned partial inventory.`);
      if (!value.recent) notices.push(`${name} · showing its last saved listings.`);
    }
  }

  const hasLive = sources.some(({ status: state }) => state === 'searched');
  const hasSavedSamples = openigloo.data || direct.some(({ data }) => data) || sources.some(({ status }) => status === 'cached');
  if (!hasLive && !filters.liveOnly && !hasSavedSamples) {
    const market = await storedMarket(bucket);
    return finish(market.listings, 'snapshot', [{ id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' }, ...sources], notices, market.month);
  }
  if (!hasLive && filters.liveOnly && !(filters.includeCached && hasSavedSamples)) {
    return finish([], 'live', sources, [...notices, 'No sources have recently confirmed active rentals.']);
  }
  if (!filters.liveOnly && (bucket || hasSavedSamples)) {
    const market = await storedMarket(bucket);
    const historical = new Map<string | null | undefined, { id: string; company?: string }>(market.listings.map((listing) => [listing.sources[0].url, listing]));
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

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleApi(request: Request, env: AppEnv, { privateAuthenticated = false, requireToken = false, fetcher = (url, options) => globalThis.fetch(url, options), waitUntil, prepareListingSources, listingTransports, backgroundRefresh = false, cityRealtyJob }: { privateAuthenticated?: boolean; requireToken?: boolean; fetcher?: SourceFetch; waitUntil?: (work: Promise<unknown>) => void; prepareListingSources?: () => Promise<void>; listingTransports?: ListingTransports; backgroundRefresh?: boolean; cityRealtyJob?: { start(delay: boolean, sources?: string[]): Promise<void>; pending(): Promise<boolean> } } = {}) {
  const { pathname: path, searchParams } = new URL(request.url);
  if (!API_PATHS.has(path)) return json({ error: 'Endpoint not found.' }, 404);
  if (requireToken && request.headers.get('Authorization') !== `Bearer ${env.APP_ACCESS_TOKEN}`) {
    return json({ error: 'Enter your apartment search server access token.' }, 401);
  }
  if (path === '/api/dashboard') {
    if (env.PUBLIC_APP !== 'true' && (!env.APP_ACCESS_TOKEN || (!privateAuthenticated && request.headers.get('Authorization') !== `Bearer ${env.APP_ACCESS_TOKEN}`))) return json({ error: 'Private authenticated access is required for this research snapshot.' }, 403);
    if (request.method !== 'GET') return json({ error: 'Use GET for dashboard data.' }, 405);
    const result = dashboardSnapshot(searchParams.get('file') ?? undefined);
    return result ? json(result) : json({ error: 'Unknown dashboard file.' }, 404);
  }
  if (path === '/api/config') {
    if (request.method !== 'GET') return json({ error: 'Use GET for app configuration.' }, 405);
    try {
      const config = appConfig(env);
      if (!env.BUCKET) return json(config);
      const refresh = await refreshStatus(env.BUCKET);
      const sourceCatalog = refreshCatalog(env);
      const coverageById = new Map(sourceCatalog.map((source) => [source.id, source.coverage]));
      const liveSources = [
        ...DIRECT_RENTAL_SOURCES.map(({ marketplace, id, name }) => {
          const coverage = coverageById.get(id);
          return { id: marketplace, name, coverage, sample: coverage !== STREETEASY_EXPORT_COVERAGE && coverage !== CITYREALTY_COVERAGE && coverage !== ZUMPER_COVERAGE };
        }),
        { id: OPENIGLOO.id, name: OPENIGLOO.name, sample: false, coverage: coverageById.get(OPENIGLOO.id) ?? 'NYC' },
      ];
      const companies = companyCounts((await storedMarket(env.BUCKET)).listings);
      return json({ ...config, refresh, companies, sourceCatalog,
        mode: refresh.sources.some(({ id }) => sourceRecent(refresh, id)) ? 'live' : config.mode,
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
      const scoped = parentRegion(region) !== region;
      const history = await storedRentHistory(env.BUCKET, market.month, parentRegion(region), grouping);
      const areaIds = new Set(areas.filter(({ id }) => id !== 'overall').map(({ id }) => id));
      return json({ month: market.month, areas, history: scoped ?
        history.map(([month, rows]) => [month, rows.filter(([id]) => areaIds.has(id))]) : history });
    } catch {
      return json({ error: 'The refreshed rent data could not be read.' }, 503);
    }
  }
  if (path === '/api/refresh' && request.method === 'GET') {
    const plan = await refreshPlan(env.BUCKET);
    return json(plan.checking || !cityRealtyJob || !(await cityRealtyJob.pending()) ? plan : { ...plan, checking: true, activeSource: CITYREALTY_ID });
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
        if (body.source !== undefined && !refreshCatalog(env).some((source) => source.id === body.source && source.resyncable)) return json({ error: 'Unknown or disconnected refresh source.' }, 422);
        if (cityRealtyJob && WORKFLOW_SOURCE_IDS.includes(body.source)) {
          const current = await refreshPlan(env.BUCKET);
          const previous = current.sources.find(item => item.id === body.source);
          if (previous?.retryAt && Date.parse(previous.retryAt) > Date.now()) return json({ ...current, state: 'already_checked' });
          if (!current.checking || current.activeSource !== body.source) await cityRealtyJob.start(Boolean(current.checking), [body.source]);
          return json({ ...current, state: 'running', checking: true, activeSource: body.source }, 202);
        }
        let started!: () => void;
        const starting = new Promise<void>(resolve => { started = resolve; });
        const work = refreshSources(env, { fetcher, listingTransports, onDemand: true, prepareListingSources,
          sourceId: body.source, forceRefresh: body.sessionStart !== true, onStarted: started, excludeCityRealty: Boolean(cityRealtyJob) });
        if (cityRealtyJob && body.source === undefined && body.sessionStart !== true) {
          try { await cityRealtyJob.start(true); }
          catch (cause) { await work.catch(() => {}); throw cause; }
        }
        waitUntil?.(work.catch(() => {}));
        if (backgroundRefresh) {
          // Bun keeps this process alive independently of the initiating HTTP request.
          void work.catch(() => {});
          const outcome = await Promise.race([
            work.then(result => ({ result, status: 200 })),
            starting.then(async () => ({ result: { state: 'running', ...await refreshPlan(env.BUCKET) }, status: 202 })),
          ]);
          return json(outcome.result, outcome.status);
        }
        return json(await work);
      }
      let imports;
      try { imports = decodeSourceImport(body); }
      catch { return json({ error: 'Send a valid compressed source import.' }, 422); }
      if (body.source !== undefined && body.source !== 'streeteasy-live') return json({ error: 'Unknown refresh source.' }, 422);
      const result = await refreshSources(env, { fetcher, imports, fallback: body.fallback === true, onlyStreetEasy: body.source === 'streeteasy-live' });
      const unavailable = result.state === 'partial' && result.sources.every(({ status }) =>
        status === 'failed' || status === 'feed_required');
      return json(result, unavailable ? 502 : 200);
    }
    if (path === '/api/building-report') return json(await retrieveBuildingRecords(body, async (url, options) => fetcher(url, options), new Date(), request.signal));
    if (path === '/api/search-check') return json(await wholeSearchCheck(body, env, filters => search(filters, env, () => { throw new Error('External requests are disabled for saved search checks.'); }, true)));
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

