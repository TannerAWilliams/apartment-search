import type { AppEnv, Bucket } from './contracts.ts';
import { isRecord, oneOf, type ListingData, type SourceStatus as SearchSource, type SearchResult } from '../src/domain.ts';
import type { SourceStatus } from './refresh.ts';
import { CITYREALTY_ID } from './cityrealty.ts';
import { isCompleteCoverage, isCompleteSnapshot, WORKFLOW_SOURCE_IDS } from './source-registry.ts';
import { type ArchiveLoader, dashboardSnapshot } from './dashboard-snapshot.ts';
import { retrieveBuildingRecords } from './building-records.ts';
import { wholeSearchCheck } from './whole-search-check.ts';
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
import { decodeSourceImport } from '../src/source-import.ts';
import { log } from './log.ts';
import { addDevice, addRule, deleteRule, deliver, readDevices, readRecent, readRules, removeDevice, checkAlerts, type AlertChannels } from './alerts.ts';
import { VITAL_NAMES } from '../src/web-vitals-report.ts';
import { type SourceFetch, refreshCatalog, refreshPlan, refreshSources, refreshStatus, sourceExpiresAt, sourceRecent, storedDirectRentals, storedFeed, storedHdcRerentals, storedHousing, storedMarket,
  storedOpenigloo, storedRentHistory } from './refresh.ts';

const REQUEST_LIMIT = 4096;
const IMPORT_LIMIT = 2 * 1024 * 1024;
const API_PATHS = new Set(['/api/alerts', '/api/vitals', '/api/dashboard', '/api/building-report', '/api/config', '/api/search', '/api/search-check', '/api/geocode', '/api/market', '/api/housing', '/api/refresh']);

export function appConfig(env: AppEnv) {
  const feeds = configuredFeeds(env).filter(({ id }) => env.STREETEASY_SYNC_ENABLED !== 'false' || id !== STREETEASY_LIVE.marketplace);
  return {
    mode: feeds.length > 0 ? 'live' : 'snapshot',
    storageMode: env.BUCKET ? 'persistent' : 'none',
    browserImportAllowed: env.PUBLIC_APP !== 'true',
    dashboardAvailable: env.PUBLIC_APP === 'true' || Boolean(env.APP_ACCESS_TOKEN),
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
export function search(rawFilters: unknown, env: AppEnv, fetcher?: SourceFetch, observationsOnly?: false): Promise<SearchResponse>;
export function search(rawFilters: unknown, env: AppEnv, fetcher: SourceFetch | undefined, observationsOnly: true): Promise<ObservationResponse>;
export async function search(rawFilters: unknown, env: AppEnv, fetcher: SourceFetch = fetch, observationsOnly = false) {
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
        const selected = await routeCommutes(selectedIndexes.map(index => matched[index]), workplace, credentials, fetcher, new Date(), bucket);
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
        sample: data.transport !== STREETEASY_EXPORT_FORMAT && !isCompleteSnapshot(source.id, data.transport) });
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

const offline = () => { throw new Error('Alerts and saved-search checks read saved inventory only.'); };

/** The channels alerts can use: email when the Email Service binding and sender are set, push when VAPID keys are. */
export function alertChannels(env: AppEnv): AlertChannels {
  const to = (env.ACCESS_ALLOWED_EMAILS ?? '').split(',').map((email) => email.trim()).filter(Boolean);
  return {
    email: env.ALERT_EMAIL && env.ALERT_EMAIL_FROM && to.length ? env.ALERT_EMAIL : null, from: env.ALERT_EMAIL_FROM, to,
    vapid: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT } : null,
  };
}

const alertMatches = (env: AppEnv) => async (filters: object) => (await search(filters, env, offline, true)).matches;

/** Checks every saved alert against the saved inventory; runs after refreshes, never on a schedule. */
export async function runAlerts(env: AppEnv, origin = env.APP_ORIGIN ?? '') {
  if (!env.BUCKET) return null;
  return checkAlerts(env.BUCKET, alertMatches(env), alertChannels(env), { origin });
}

async function alertState(env: AppEnv & { BUCKET: Bucket }) {
  const channels = alertChannels(env);
  const [rules, devices, recent] = await Promise.all([readRules(env.BUCKET), readDevices(env.BUCKET), readRecent(env.BUCKET)]);
  return { rules, recent, devices: devices.map(({ label, createdAt }) => ({ label, createdAt })),
    channels: { email: Boolean(channels.email), push: channels.vapid ? { publicKey: channels.vapid.publicKey } : null } };
}

async function alertAction(raw: unknown, env: AppEnv & { BUCKET: Bucket }, origin: string) {
  const bucket = env.BUCKET;
  const body = isRecord(raw) ? raw : {};
  if (body.action === 'add-rule') await addRule(bucket, body.rule, alertMatches(env));
  else if (body.action === 'delete-rule') await deleteRule(bucket, body.id);
  else if (body.action === 'add-device') await addDevice(bucket, body.subscription, body.label);
  else if (body.action === 'remove-device') await removeDevice(bucket, body.endpoint);
  else if (body.action === 'test') {
    const delivered = await deliver(bucket, [{ id: crypto.randomUUID(), at: new Date().toISOString(), ruleId: 'test', title: 'Test alert from Apartment Search',
      lines: ['Alerts are working. New apartments and price drops in your saved alerts will arrive like this.'], newCount: 0, dropCount: 0 }], alertChannels(env), origin);
    return { ...await alertState(env), delivered };
  } else throw new SearchInputError('Unknown alert action.');
  return alertState(env);
}

const noDashboardArchive: ArchiveLoader = async () => { throw new Error('No dashboard archive is configured.'); };

export async function handleApi(request: Request, env: AppEnv, { privateAuthenticated = false, fetcher = (url, options) => globalThis.fetch(url, options), waitUntil, syncJob, dashboardArchive = noDashboardArchive }: {
  privateAuthenticated?: boolean; fetcher?: SourceFetch; waitUntil?: (work: Promise<unknown>) => void;
  syncJob?: { start(delay: boolean, sources?: string[]): Promise<void>; pending(): Promise<string | boolean | null> };
  /** Reads the StreetEasy dashboard archive, which is kept out of the Worker script. */
  dashboardArchive?: ArchiveLoader;
} = {}) {
  const { pathname: path, searchParams } = new URL(request.url);
  /** A refresh that saved anything is followed by an alert check, after the response is sent. */
  const afterRefresh = (result: { state: string }) => {
    if (['complete', 'partial'].includes(result.state)) waitUntil?.(runAlerts(env, env.APP_ORIGIN ?? new URL(request.url).origin)
      .catch((cause) => log.error('alert_check_failed', cause)));
  };
  if (!API_PATHS.has(path)) return json({ error: 'Endpoint not found.' }, 404);
  if (path === '/api/vitals') {
    if (request.method !== 'POST') return json({ error: 'Use POST for performance measurements.' }, 405);
    const report = await request.json().catch(() => null) as { page?: unknown; metrics?: unknown } | null;
    const metrics = Array.isArray(report?.metrics) ? report.metrics.slice(0, VITAL_NAMES.length) : [];
    const page = typeof report?.page === 'string' && /^[a-z-]{1,20}$/.test(report.page) ? report.page : 'other';
    let logged = 0;
    for (const metric of metrics) {
      const { name, value, rating, navigationType }: Record<string, unknown> = isRecord(metric) ? metric : {};
      if (!oneOf(VITAL_NAMES, name) || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 600_000 ||
          !oneOf(['good', 'needs-improvement', 'poor'], rating)) continue;
      log.info('web_vital', { name, value, rating, page, navigationType: typeof navigationType === 'string' ? navigationType.slice(0, 20) : undefined });
      logged++;
    }
    return logged ? new Response(null, { status: 204 }) : json({ error: 'Send Core Web Vitals measurements.' }, 400);
  }
  if (path === '/api/dashboard') {
    if (env.PUBLIC_APP !== 'true' && !privateAuthenticated) return json({ error: 'Private authenticated access is required for this research snapshot.' }, 403);
    if (request.method !== 'GET') return json({ error: 'Use GET for dashboard data.' }, 405);
    try {
      const result = await dashboardSnapshot(searchParams.get('file') ?? undefined, dashboardArchive);
      return result ? json(result) : json({ error: 'Unknown dashboard file.' }, 404);
    } catch (cause) {
      log.error('dashboard_read_failed', cause, { path });
      return json({ error: 'The historical dashboard data could not be read.' }, 503);
    }
  }
  if (path === '/api/config') {
    if (request.method !== 'GET') return json({ error: 'Use GET for app configuration.' }, 405);
    let config;
    try { config = appConfig(env); }
    catch (cause) {
      log.error('feed_settings_invalid', cause);
      return json({ error: 'The free feed settings need to be corrected on the server.' }, 503);
    }
    try {
      if (!env.BUCKET) return json(config);
      const refresh = await refreshStatus(env.BUCKET);
      const sourceCatalog = refreshCatalog(env);
      const coverageById = new Map(sourceCatalog.map((source) => [source.id, source.coverage]));
      const liveSources = [
        ...DIRECT_RENTAL_SOURCES.map(({ marketplace, id, name }) => {
          const coverage = coverageById.get(id);
          return { id: marketplace, name, coverage, sample: coverage !== STREETEASY_EXPORT_COVERAGE && !isCompleteCoverage(coverage) };
        }),
        { id: OPENIGLOO.id, name: OPENIGLOO.name, sample: false, coverage: coverageById.get(OPENIGLOO.id) ?? 'NYC' },
      ];
      const companies = companyCounts((await storedMarket(env.BUCKET)).listings);
      return json({ ...config, refresh, companies, sourceCatalog,
        mode: refresh.sources.some(({ id }) => sourceRecent(refresh, id)) ? 'live' : config.mode,
        sources: [...liveSources, ...config.sources.filter(({ id }) => !liveSources.some((item) => item.id === id))],
        snapshotMonth: refresh.sources.find(({ id }) => id === 'firstmover')?.month ?? SNAPSHOT_MONTH,
      });
    } catch (cause) {
      log.error('storage_read_failed', cause, { path });
      return json({ error: 'Saved source data could not be read. Try again shortly.' }, 503);
    }
  }
  if (path === '/api/housing') {
    if (request.method !== 'GET') return json({ error: 'Use GET for affordable housing.' }, 405);
    try {
      const [housing, rerentals] = await Promise.all([storedHousing(env.BUCKET), storedHdcRerentals(env.BUCKET).catch(() => null)]);
      return json({ ...housing, rerentals });
    } catch (cause) {
      log.error('storage_read_failed', cause, { path });
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
    } catch (cause) {
      log.error('storage_read_failed', cause, { path });
      return json({ error: 'The refreshed rent data could not be read.' }, 503);
    }
  }
  if (path === '/api/alerts' && request.method === 'GET') {
    if (!env.BUCKET) return json({ error: 'Alerts need saved storage.' }, 400);
    try { return json(await alertState({ ...env, BUCKET: env.BUCKET })); }
    catch (cause) { log.error('storage_read_failed', cause, { path }); return json({ error: 'Alerts could not be read. Try again shortly.' }, 503); }
  }
  if (path === '/api/refresh' && request.method === 'GET') {
    const plan = await refreshPlan(env.BUCKET);
    const running = plan.checking || !syncJob ? null : await syncJob.pending();
    // The Workflow names the source it is on; a job that only reports "running" is CityRealty's.
    return json(running ? { ...plan, checking: true, activeSource: typeof running === 'string' ? running : CITYREALTY_ID } : plan);
  }
  if (request.method !== 'POST') return json({ error: 'Use POST for this endpoint.' }, 405);
  if (path === '/api/refresh' && (!env.BUCKET || !request.headers.get('Content-Type')?.startsWith('application/json'))) {
    return json({ error: 'A private hosted site and a JSON request are required to refresh sources.' }, 400);
  }
  const maxBytes = path === '/api/refresh' ? IMPORT_LIMIT : REQUEST_LIMIT;
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    return json({ error: 'The request is too large.' }, 413);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > maxBytes) return json({ error: 'The request is too large.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Send a JSON request.' }, 400);
  }
  const fields: Record<string, unknown> = isRecord(body) ? body : {};
  try {
    if (path === '/api/refresh') {
      const source = fields.source;
      if (fields.check === 'now') {
        // The app no longer checks sources when it opens. A page loaded before that change still asks
        // with sessionStart; it gets the saved status and nothing is fetched.
        if (fields.sessionStart === true) return json({ ...await refreshPlan(env.BUCKET), state: 'already_checked' });
        if (source !== undefined && (typeof source !== 'string' || !refreshCatalog(env).some((item) => item.id === source && item.resyncable))) {
          return json({ error: 'Unknown or disconnected refresh source.' }, 422);
        }
        if (syncJob && source !== undefined && WORKFLOW_SOURCE_IDS.includes(source)) {
          const current = await refreshPlan(env.BUCKET);
          const previous = current.sources.find(item => item.id === source);
          if (previous?.retryAt && Date.parse(previous.retryAt) > Date.now()) return json({ ...current, state: 'already_checked' });
          if (!current.checking || current.activeSource !== source) await syncJob.start(Boolean(current.checking), [source]);
          return json({ ...current, state: 'running', checking: true, activeSource: source }, 202);
        }
        const work = refreshSources(env, { fetcher, onDemand: true,
          sourceId: source, excludeWorkflowSources: Boolean(syncJob) });
        if (syncJob && source === undefined) {
          try { await syncJob.start(true); }
          catch (cause) { await work.catch(() => {}); throw cause; }
        }
        waitUntil?.(work.then(afterRefresh, () => {}));
        return json(await work);
      }
      let imports;
      try { imports = decodeSourceImport(body); }
      catch { return json({ error: 'Send a valid compressed source import.' }, 422); }
      if (source !== undefined && source !== 'streeteasy-live') return json({ error: 'Unknown refresh source.' }, 422);
      const result = await refreshSources(env, { fetcher, imports, fallback: fields.fallback === true, onlyStreetEasy: source === 'streeteasy-live' });
      afterRefresh(result);
      const unavailable = result.state === 'partial' && result.sources.every(({ status }) =>
        status === 'failed' || status === 'feed_required');
      return json(result, unavailable ? 502 : 200);
    }
    if (path === '/api/alerts') {
      if (!env.BUCKET) return json({ error: 'Alerts need saved storage.' }, 400);
      return json(await alertAction(body, { ...env, BUCKET: env.BUCKET }, env.APP_ORIGIN ?? new URL(request.url).origin));
    }
    if (path === '/api/building-report') return json(await retrieveBuildingRecords(body, async (url, options) => fetcher(url, options), new Date(), request.signal));
    if (path === '/api/search-check') return json(await wholeSearchCheck(body, env, filters => search(filters, env, offline, true)));
    if (path === '/api/geocode') return json(await geocodeAddress(fields.address, fetcher));
    if ((fields.includeCommute || needsCommute(fields)) && !request.headers.get('Content-Type')?.startsWith('application/json')) {
      return json({ error: 'Send commute searches as JSON.' }, 400);
    }
    return json(await search(body, env, fetcher));
  } catch (error) {
    if (error instanceof CommuteError) return json({ error: error.message, commuteError: true }, error.status);
    if (error instanceof SearchInputError) return json({ error: error.message }, 422);
    log.error('request_failed', error, { path });
    if (path === '/api/refresh') return json({ error: 'The listing sources could not be checked. Try reloading the page.' }, 502);
    return json({ error: 'The address or listing feed could not be reached. Try again or use a workplace preset.' }, 502);
  }
}

