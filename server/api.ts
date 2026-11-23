import { vValidator } from '@hono/valibot-validator';
import { type Context, Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as v from 'valibot';
import type { AppEnv, Bucket } from './contracts.ts';
import { readRequestBody, RequestTooLarge } from './request-body.ts';
import type { ListingData, SourceStatus as SearchSource, SearchResult } from '../src/domain.ts';
import { AlertRequest, BuildingAddress, DashboardQuery, GeocodeRequest, MarketQuery, RefreshRequest, VitalMetric, VitalsReport } from './api-inputs.ts';
import type { RentHistory } from '../src/rent-history.ts';
import type { SourceStatus } from './refresh.ts';
import { CITYREALTY_ID } from './cityrealty.ts';
import { isCompleteCoverage, isCompleteSnapshot, WORKFLOW_SOURCE_IDS } from './source-registry.ts';
import { type ArchiveLoader, dashboardSnapshot } from './dashboard-snapshot.ts';
import { retrieveBuildingRecords } from './building-records.ts';
import { wholeSearchCheck } from './whole-search-check.ts';
import { companyCounts } from '../src/companies.ts';
import { localWorkplace, matchListings, needsCommute, parseFilters, SearchFiltersInput, SearchInputError } from '../src/search.ts';
import { formatSearch, rentAreas, SNAPSHOT_MONTH } from '../src/market.ts';
import { parentRegion } from '../src/regions.ts';
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

async function alertAction(body: v.InferOutput<typeof AlertRequest>, env: AppEnv & { BUCKET: Bucket }, origin: string) {
  const bucket = env.BUCKET;
  if (body.action === 'add-rule') await addRule(bucket, body.rule, alertMatches(env));
  else if (body.action === 'delete-rule') await deleteRule(bucket, body.id);
  else if (body.action === 'add-device') await addDevice(bucket, body.subscription, body.label);
  else if (body.action === 'remove-device') await removeDevice(bucket, body.endpoint);
  else {
    const delivered = await deliver(bucket, [{ id: crypto.randomUUID(), at: new Date().toISOString(), ruleId: 'test', title: 'Test alert from Apartment Search',
      lines: ['Alerts are working. New apartments and price drops in your saved alerts will arrive like this.'], newCount: 0, dropCount: 0 }], alertChannels(env), origin);
    return { ...await alertState(env), delivered };
  }
  return alertState(env);
}

const REFRESH_STORAGE = 'A private hosted site with saved storage is required to refresh sources.';
const noDashboardArchive: ArchiveLoader = async () => { throw new Error('No dashboard archive is configured.'); };

export type SyncJob = { start(delay: boolean, sources?: string[]): Promise<void>; pending(): Promise<string | boolean | null> };
/** What a request can use besides the settings and storage. The Worker entry passes the real ones; tests pass stand-ins. */
export type ApiServices = {
  /** Signed in with Cloudflare Access or the app access token. */
  privateAuthenticated: boolean;
  fetcher: SourceFetch;
  /** Runs work after the response is sent: the Worker's `ctx.waitUntil`. */
  waitUntil?: (work: Promise<unknown>) => void;
  syncJob?: SyncJob;
  /** Reads the StreetEasy dashboard archive, which is kept out of the Worker script. */
  dashboardArchive: ArchiveLoader;
};
export type ApiVariables = { appEnv: AppEnv; services: ApiServices };
type ApiContext = Context<{ Variables: ApiVariables }>;

const fail = <S extends ContentfulStatusCode>(c: Context, status: S, error: string) => c.json({ error }, status);
type Checked = { success: boolean; issues?: readonly { message: string }[] };
/** Refuses input that does not match a route's schema, with the first problem. */
const refuseWith = <S extends ContentfulStatusCode>(status: S) => (result: Checked, c: Context) =>
  result.success ? undefined : fail(c, status, result.issues?.[0]?.message ?? 'Check the request and try again.');
const refuse = refuseWith(422);
/** The Content-Type Hono's JSON validator reads; any other body would reach the handler as {}. */
const JSON_TYPE = /^application\/([a-z-.]+\+)?json(;\s*[a-zA-Z0-9-]+=([^;]+))*$/i;

/**
 * A POST body is JSON, within the route's size limit, read before the route runs so a body that is too large
 * or breaks off is refused. Requiring the JSON type also stops cross-site form posts.
 */
export const jsonBodies = (limit: (path: string) => number) => createMiddleware(async (c, next) => {
  if (!JSON_TYPE.test(c.req.header('Content-Type') ?? '')) return fail(c, 400, 'Send a JSON request.');
  const maxBytes = limit(c.req.path);
  if (Number(c.req.header('Content-Length')) > maxBytes) return fail(c, 413, 'The request is too large.');
  let body;
  try { body = await readRequestBody(c.req.raw, maxBytes); }
  catch (cause) { return cause instanceof RequestTooLarge ? fail(c, 413, 'The request is too large.') : fail(c, 400, 'Send a JSON request.'); }
  c.req.raw = new Request(c.req.raw, { body });
  await next();
});
const apiBodies = jsonBodies((path) => path === '/api/refresh' ? IMPORT_LIMIT : REQUEST_LIMIT);

/** Routes that save something need storage; without it they refuse before reading the request. */
const needsStorage = (message: string) => createMiddleware<{ Variables: ApiVariables }>(async (c, next) =>
  c.var.appEnv.BUCKET ? next() : fail(c, 400, message));

/** A refresh that saved anything is followed by an alert check, after the response is sent. */
function afterRefresh(c: ApiContext, result: { state: string }) {
  const { appEnv: env, services } = c.var;
  if (['complete', 'partial'].includes(result.state)) services.waitUntil?.(runAlerts(env, env.APP_ORIGIN ?? new URL(c.req.url).origin)
    .catch((cause) => log.error('alert_check_failed', cause)));
}

/** The API under /api/. Its type gives the app the shape of every reply. */
export const api = new Hono<{ Variables: ApiVariables }>().basePath('/api')
  .use(async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); })
  .post('/vitals', apiBodies, vValidator('json', VitalsReport, refuseWith(400)), (c) => {
    const { page, metrics } = c.req.valid('json');
    let logged = 0;
    for (const metric of metrics.slice(0, VITAL_NAMES.length)) {
      const result = v.safeParse(VitalMetric, metric);
      if (!result.success) continue;
      log.info('web_vital', { ...result.output, page });
      logged++;
    }
    return logged ? c.body(null, 204) : fail(c, 400, 'Send Core Web Vitals measurements.');
  })
  .get('/dashboard', vValidator('query', DashboardQuery, refuse), async (c) => {
    const { appEnv: env, services } = c.var;
    if (env.PUBLIC_APP !== 'true' && !services.privateAuthenticated) return fail(c, 403, 'Private authenticated access is required for this research snapshot.');
    try {
      const result = await dashboardSnapshot(c.req.valid('query').file, services.dashboardArchive);
      return result ? c.json(result, 200) : fail(c, 404, 'Unknown dashboard file.');
    } catch (cause) {
      log.error('dashboard_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The historical dashboard data could not be read.');
    }
  })
  .get('/config', async (c) => {
    const env = c.var.appEnv;
    let config;
    try { config = appConfig(env); }
    catch (cause) {
      log.error('feed_settings_invalid', cause);
      return fail(c, 503, 'The free feed settings need to be corrected on the server.');
    }
    if (!env.BUCKET) return c.json(config, 200);
    try {
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
      return c.json({ ...config, refresh, companies, sourceCatalog,
        mode: refresh.sources.some(({ id }) => sourceRecent(refresh, id)) ? 'live' : config.mode,
        sources: [...liveSources, ...config.sources.filter(({ id }) => !liveSources.some((item) => item.id === id))],
        snapshotMonth: refresh.sources.find(({ id }) => id === 'firstmover')?.month ?? SNAPSHOT_MONTH,
      }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'Saved source data could not be read. Try again shortly.');
    }
  })
  .get('/housing', async (c) => {
    const env = c.var.appEnv;
    try {
      const [housing, rerentals] = await Promise.all([storedHousing(env.BUCKET), storedHdcRerentals(env.BUCKET).catch(() => null)]);
      return c.json({ ...housing, rerentals }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The Housing Connect data could not be read.');
    }
  })
  .get('/market', vValidator('query', MarketQuery, refuse), async (c) => {
    const env = c.var.appEnv;
    const { region, grouping } = c.req.valid('query');
    try {
      const market = await storedMarket(env.BUCKET);
      const areas = rentAreas(market.listings, { region, grouping });
      const scoped = parentRegion(region) !== region;
      const history = await storedRentHistory(env.BUCKET, market.month, parentRegion(region), grouping);
      const areaIds = new Set(areas.filter(({ id }) => id !== 'overall').map(({ id }) => id));
      return c.json({ month: market.month, areas, history: scoped ?
        history.map(([month, rows]): RentHistory[number] => [month, rows.filter(([id]) => areaIds.has(id))]) : history }, 200);
    } catch (cause) {
      log.error('storage_read_failed', cause, { path: c.req.path });
      return fail(c, 503, 'The refreshed rent data could not be read.');
    }
  })
  .get('/alerts', async (c) => {
    const env = c.var.appEnv;
    if (!env.BUCKET) return fail(c, 400, 'Alerts need saved storage.');
    try { return c.json(await alertState({ ...env, BUCKET: env.BUCKET }), 200); }
    catch (cause) { log.error('storage_read_failed', cause, { path: c.req.path }); return fail(c, 503, 'Alerts could not be read. Try again shortly.'); }
  })
  .post('/alerts', needsStorage('Alerts need saved storage.'), apiBodies, vValidator('json', AlertRequest, refuse), async (c) => {
    const env = c.var.appEnv;
    if (!env.BUCKET) return fail(c, 400, 'Alerts need saved storage.');
    return c.json(await alertAction(c.req.valid('json'), { ...env, BUCKET: env.BUCKET }, env.APP_ORIGIN ?? new URL(c.req.url).origin), 200);
  })
  .get('/refresh', async (c) => {
    const { appEnv: env, services: { syncJob } } = c.var;
    const plan = await refreshPlan(env.BUCKET);
    const running = plan.checking || !syncJob ? null : await syncJob.pending();
    // The Workflow names the source it is on; a job that only reports "running" is CityRealty's.
    return c.json(running ? { ...plan, checking: true, activeSource: typeof running === 'string' ? running : CITYREALTY_ID } : plan, 200);
  })
  .post('/refresh', needsStorage(REFRESH_STORAGE), apiBodies, vValidator('json', RefreshRequest, refuse), async (c) => {
    const { appEnv: env, services: { fetcher, syncJob, waitUntil } } = c.var;
    const body = c.req.valid('json');
    if (!env.BUCKET) return fail(c, 400, REFRESH_STORAGE);
    const source = body.source;
    if ('check' in body) {
      // The app no longer checks sources when it opens. A page loaded before that change still asks
      // with sessionStart; it gets the saved status and nothing is fetched.
      if (body.sessionStart === true) return c.json({ ...await refreshPlan(env.BUCKET), state: 'already_checked' }, 200);
      if (source !== undefined && !refreshCatalog(env).some((item) => item.id === source && item.resyncable)) {
        return fail(c, 422, 'Unknown or disconnected refresh source.');
      }
      if (syncJob && source !== undefined && WORKFLOW_SOURCE_IDS.includes(source)) {
        const current = await refreshPlan(env.BUCKET);
        const previous = current.sources.find(item => item.id === source);
        if (previous?.retryAt && Date.parse(previous.retryAt) > Date.now()) return c.json({ ...current, state: 'already_checked' }, 200);
        if (!current.checking || current.activeSource !== source) await syncJob.start(Boolean(current.checking), [source]);
        return c.json({ ...current, state: 'running', checking: true, activeSource: source }, 202);
      }
      const work = refreshSources(env, { fetcher, onDemand: true, sourceId: source, excludeWorkflowSources: Boolean(syncJob) });
      if (syncJob && source === undefined) {
        try { await syncJob.start(true); }
        catch (cause) { await work.catch(() => {}); throw cause; }
      }
      waitUntil?.(work.then((result) => afterRefresh(c, result), () => {}));
      return c.json(await work, 200);
    }
    let imports;
    try { imports = decodeSourceImport(body); }
    catch { return fail(c, 422, 'Send a valid compressed source import.'); }
    const result = await refreshSources(env, { fetcher, imports, fallback: body.fallback === true, onlyStreetEasy: source === 'streeteasy-live' });
    afterRefresh(c, result);
    const unavailable = result.state === 'partial' && result.sources.every(({ status }) => status === 'failed' || status === 'feed_required');
    return c.json(result, unavailable ? 502 : 200);
  })
  .post('/building-report', apiBodies, vValidator('json', BuildingAddress, refuse), async (c) => {
    const { fetcher } = c.var.services;
    return c.json(await retrieveBuildingRecords(c.req.valid('json'), (url, options) => fetcher(url, options), new Date(), c.req.raw.signal), 200);
  })
  .post('/search-check', apiBodies, vValidator('json', SearchFiltersInput, refuse), async (c) => {
    const env = c.var.appEnv;
    return c.json(await wholeSearchCheck(c.req.valid('json'), env, (filters) => search(filters, env, offline, true)), 200);
  })
  .post('/geocode', apiBodies, vValidator('json', GeocodeRequest, refuse), async (c) =>
    c.json(await geocodeAddress(c.req.valid('json').address, c.var.services.fetcher), 200))
  .post('/search', apiBodies, vValidator('json', SearchFiltersInput, refuse), async (c) =>
    c.json(await search(c.req.valid('json'), c.var.appEnv, c.var.services.fetcher), 200));

/** The routes and the shape of each reply, for the app's API client. */
export type ApiRoutes = typeof api;

// Wrong methods and unknown paths.
for (const [path, message] of [['/vitals', 'Use POST for performance measurements.'], ['/dashboard', 'Use GET for dashboard data.'],
  ['/config', 'Use GET for app configuration.'], ['/housing', 'Use GET for affordable housing.'], ['/market', 'Use GET for rent data.']]) {
  api.all(path, (c) => fail(c, 405, message));
}
api.all('*', (c) => ['/api/alerts', '/api/refresh', '/api/search', '/api/search-check', '/api/geocode', '/api/building-report'].includes(c.req.path)
  ? fail(c, 405, 'Use POST for this endpoint.') : fail(c, 404, 'Endpoint not found.'));

api.onError((error, c) => {
  if (error instanceof HTTPException) return error.status === 413 ? fail(c, 413, 'The request is too large.') : fail(c, 400, 'Send a JSON request.');
  if (error instanceof CommuteError) return c.json({ error: error.message, commuteError: true }, error.status as ContentfulStatusCode);
  if (error instanceof SearchInputError) return fail(c, 422, error.message);
  log.error('request_failed', error, { path: c.req.path, method: c.req.method });
  if (c.req.method !== 'POST') return fail(c, 503, 'Apartment Search could not complete the request.');
  if (c.req.path === '/api/refresh') return fail(c, 502, 'The listing sources could not be checked. Try reloading the page.');
  return fail(c, 502, 'The address or listing feed could not be reached. Try again or use a workplace preset.');
});

/** The API on its own, with the settings and services passed in; the Worker entry mounts `api` instead. */
const standalone = new Hono<{ Bindings: ApiVariables; Variables: ApiVariables }>()
  .use(async (c, next) => { c.set('appEnv', c.env.appEnv); c.set('services', c.env.services); await next(); })
  .route('/', api);

export function handleApi(request: Request, env: AppEnv, services: Partial<ApiServices> = {}) {
  return standalone.fetch(request, { appEnv: env, services: { privateAuthenticated: false, fetcher: (url, options) => globalThis.fetch(url, options),
    dashboardArchive: noDashboardArchive, ...services } });
}
