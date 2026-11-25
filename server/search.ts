/**
 * Search across saved inventory: every source's latest check, merged, matched against the filters, with
 * commute times when asked and links to affordable-housing lotteries in the same building.
 */
import type { AppEnv, Bucket, SnapshotFilter } from './contracts.ts';
import type { ListingData, SearchFilters, SearchResult, SourceStatus as SearchSource } from '../src/domain.ts';
import { localWorkplace, matchListings, needsCommute, parseFilters } from '../src/search.ts';
import { formatSearch } from '../src/market.ts';
import { withInsights } from '../src/insights.ts';
import { withTransitEstimates as estimated } from '../src/answer.ts';
import type { Station } from '../src/subway.ts';
import { readBuildingFacts } from './building-facts.ts';
import { openData } from './open-data.ts';
import { directListings } from './direct-listings.ts';
import { parentRegion } from '../src/regions.ts';
import { buildingKey, listingWithVerifiedLinks, mergeListings } from '../src/listings.ts';
import { isCompleteSnapshot } from './sources/source-registry.ts';
import {
  configuredFeeds,
  loadFeed,
  loadStreetEasyExport,
  STREETEASY_EXPORT_COVERAGE,
  STREETEASY_EXPORT_FORMAT,
} from './sources/listings.ts';
import { CommuteError, resolveWorkplace, routeCommutes, routingCredentials } from './commute.ts';
import { OPENIGLOO } from './sources/openigloo.ts';
import { DIRECT_RENTAL_SOURCES } from './sources/direct-rentals.ts';
import { STREETEASY_LIVE, STREETEASY_PUBLIC_COVERAGE, STREETEASY_PUBLIC_TRANSPORT } from './sources/streeteasy.ts';
import type { SourceFetch } from './contracts.ts';
import { type SourceStatus, refreshStatus, sourceExpiresAt, sourceRecent } from './refresh/status.ts';
import { refreshCatalog } from './refresh/sources.ts';
import { log } from './log.ts';
import { timed, type Timings } from './timing.ts';
import { storedDirectRentals, storedFeed, storedHousing, storedOpenigloo } from './refresh/snapshots.ts';
import { storedMarket } from './refresh/market.ts';

/** For checks that must read saved inventory only, such as alerts and whole-search checks. */
export const offline: SourceFetch = () => {
  throw new Error('Alerts and saved-search checks read saved inventory only.');
};

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
  return {
    ...result,
    matches: result.matches.map((listing) => {
      const buildingLinks = byAddress.get(buildingKey(listing));
      return buildingLinks ? { ...listing, buildingLinks } : listing;
    }),
  };
}

/**
 * How long a source's last good listings are still shown after its syncs start failing. Past this, apartments
 * in them may well be rented, so they are dropped until the source syncs again.
 */
export const KEPT_MAX_MS = 2 * 86_400_000;

async function storedSample(
  status: { sources: SourceStatus[] } | null,
  id: string,
  liveOnly: boolean,
  load: () => ReturnType<typeof storedOpenigloo>,
  strict = false,
  includeCached = false,
) {
  const sourceStatus = status?.sources.find((source) => source.id === id);
  const recent = sourceRecent(status, id);
  const keptAge = Date.now() - Date.parse(sourceStatus?.updatedAt ?? '');
  const data =
    recent || (!liveOnly && sourceStatus?.updatedAt) || (includeCached && keptAge <= KEPT_MAX_MS)
      ? await load().catch((error) => {
          if (strict) throw error;
          return null;
        })
      : null;
  const listings =
    data?.listings.map((listing) =>
      recent
        ? listing
        : {
            ...listing,
            kind: 'cached',
            sources: listing.sources.map((source) => ({ ...source, kind: 'cached' })),
          },
    ) ?? [];
  return { sourceStatus, recent, data, listings };
}

/** A feed read directly, for a server without saved storage. */
const readFeed = (feed: ReturnType<typeof configuredFeeds>[number], fetcher: SourceFetch, at: Date) =>
  feed.format === STREETEASY_EXPORT_FORMAT ? loadStreetEasyExport(feed, fetcher, at) : loadFeed(feed, fetcher);

type Gathered = { listings: ListingData[]; mode: string; sources: SearchSource[]; notices: string[]; snapshotMonth?: string };
const gathered = (listings: ListingData[], mode: string, sources: SearchSource[], notices: string[], snapshotMonth?: string): Gathered => ({
  listings,
  mode,
  sources,
  notices,
  ...(snapshotMonth ? { snapshotMonth } : {}),
});

/** How long a search's listings are reused, and how many different sets (regions, rent limits) are kept. */
export const GATHER_MS = 15 * 60_000;
const GATHERED_KEPT = 2;
const recent = new WeakMap<Bucket, Map<string, { at: number; value: Promise<Gathered> }>>();

/** The listings for this key from the last 15 minutes (a new source check changes the key sooner), or read now; a failed read is not kept. */
export async function recentlyGathered(bucket: Bucket, key: string, gather: () => Promise<Gathered>, now = Date.now()) {
  const kept = recent.get(bucket) ?? new Map<string, { at: number; value: Promise<Gathered> }>();
  recent.set(bucket, kept);
  const hit = kept.get(key);
  if (hit && now - hit.at < GATHER_MS) return hit.value;
  const value = gather();
  kept.delete(key);
  kept.set(key, { at: now, value });
  while (kept.size > GATHERED_KEPT) kept.delete(kept.keys().next().value!);
  value.catch(() => kept.delete(key));
  return value;
}

/** The listings kept for this key, if they were read in the last 15 minutes. */
export function keptGathered(bucket: Bucket, key: string, now = Date.now()) {
  const hit = recent.get(bucket)?.get(key);
  return hit && now - hit.at < GATHER_MS ? hit.value : undefined;
}

/** Every listing with its comparison with similar apartments and its building's facts. */
async function score(listings: ListingData[], bucket: Bucket | undefined, timings?: Timings) {
  // Three independent reads, read together. Owners' own no-fee listings join every search.
  const [buildings, lists, direct] = bucket
    ? await Promise.all([
        timed(timings, 'facts', () => readBuildingFacts(bucket).catch(() => ({}))),
        timed(timings, 'open-data', () => openData(bucket)),
        timed(timings, 'owners', () => directListings(bucket).catch(() => [])),
      ])
    : [{}, undefined, []];
  return withInsights([...listings, ...direct], buildings, lists);
}
/** The scored listings of a kept set, worked out once while the set is kept. */
const scored = new WeakMap<Gathered, Promise<ListingData[]>>();
function scoredOnce(found: Gathered, bucket: Bucket, timings?: Timings) {
  const known = scored.get(found);
  if (known !== undefined) return known;
  const work = score(found.listings, bucket, timings);
  // Scoring reads only stored lists, each of which falls back to empty, so it does not fail on its own.
  scored.set(found, work);
  return work;
}

type SearchExtra = {
  /** The sources' status when the caller has already read it (cachedSearch), so it is not read twice. */
  status?: Awaited<ReturnType<typeof refreshStatus>> | null;
  /** Where the request's time goes, by phase (server/timing.ts). */
  timings?: Timings;
  /**
   * With observationsOnly: answer from the listings this Worker instance already holds, when it holds them. For
   * pages that show listings (an apartment's page, a neighborhood). Alerts and whole-search checks leave it off:
   * they decide what changed, so they read the database each time.
   */
  kept?: boolean;
  /**
   * With observationsOnly: every listing as scored, before any matching, with the affordable-housing links of
   * its building. What the inventory file is built from (server/inventory.ts).
   */
  scored?: boolean;
};
/** Every listing, merged and scored, with what a search over them reports. */
export type ScoredListings = { listings: ListingData[]; mode: string; sources: SearchSource[]; notices: string[]; snapshotMonth?: string };
type SearchResponse = SearchResult & { snapshotMonth?: string; commute?: boolean; commuteNotice?: string };
type ObservationResponse = { matches: ListingData[]; sources: SearchSource[]; notices: string[] };
/** Searches with checked filters (see SearchFiltersSchema). With observationsOnly, returns the matches alone, from saved inventory. */
export function search(
  filters: SearchFilters,
  env: AppEnv,
  fetcher?: SourceFetch,
  observationsOnly?: false,
  extra?: SearchExtra,
): Promise<SearchResponse>;
export function search(
  filters: SearchFilters,
  env: AppEnv,
  fetcher: SourceFetch | undefined,
  observationsOnly: true,
  extra: SearchExtra & { scored: true },
): Promise<ScoredListings>;
export function search(
  filters: SearchFilters,
  env: AppEnv,
  fetcher: SourceFetch | undefined,
  observationsOnly: true,
  extra?: SearchExtra,
): Promise<ObservationResponse>;
export async function search(
  filters: SearchFilters,
  env: AppEnv,
  fetcher: SourceFetch = fetch,
  observationsOnly = false,
  { status: known, timings, kept: reuseKept = false, scored: scoredOnly = false }: SearchExtra = {},
): Promise<SearchResponse | ObservationResponse | ScoredListings> {
  const requireCommute = needsCommute(filters);
  const credentials = routingCredentials(env);
  if (requireCommute && !credentials)
    throw new CommuteError('Automatic commute estimates are unavailable because the routing service is disconnected.');
  const configured = configuredFeeds(env);
  const feeds = configured.filter(
    ({ id }) => id !== STREETEASY_LIVE.marketplace || (!env.BUCKET && env.STREETEASY_SYNC_ENABLED !== 'false'),
  );
  // A typed destination is looked up on a map while the listings are read; nothing waits for it until matching.
  const workplaceFound = observationsOnly ? Promise.resolve(localWorkplace(filters)) : resolveWorkplace(filters, fetcher);
  // Read later; a failed lookup is reported there, not as an unhandled rejection if reading fails first.
  workplaceFound.catch(() => {});
  const bucket = env.BUCKET;
  /** The kept set being searched, whose scores are reused; none for a one-off read. */
  let kept: Gathered | null = null;
  async function finish(listings: ListingData[], mode: string, sources: SearchSource[], notices: string[], snapshotMonth?: string) {
    const [scoredListings, workplace] = await Promise.all([
      timed(timings, 'score', () => (kept && bucket ? scoredOnce(kept, bucket, timings) : score(listings, bucket, timings))),
      timed(timings, 'destination', () => workplaceFound),
    ]);
    if (scoredOnly) {
      const linked = await withHousingLinks({ matches: scoredListings }, bucket);
      return { listings: linked.matches, mode, sources, notices, ...(snapshotMonth ? { snapshotMonth } : {}) };
    }
    const matched = matchListings(scoredListings, filters, workplace).map(listingWithVerifiedLinks);
    let routed = matched;
    const commute: { commute?: boolean; commuteNotice?: string } = {};
    if (credentials && (requireCommute || filters.includeCommute)) {
      try {
        // Source selection is a privacy boundary: do not transmit origins for
        // apartments the user excluded. Preserve the full inventory for counts.
        const selectedIndexes = matched.flatMap((listing, index) =>
          !filters.source || listing.sources.some((source) => source.id === filters.source && source.url) ? [index] : [],
        );
        const selected = await routeCommutes(
          selectedIndexes.map((index) => matched[index]),
          workplace,
          credentials,
          fetcher,
          new Date(),
          bucket,
        );
        const byIndex = new Map(selectedIndexes.map((index, position) => [index, selected[position]]));
        routed = matched.map(
          (listing, index) =>
            byIndex.get(index) ?? {
              ...listing,
              transitSeconds: null,
              drivingSeconds: null,
              commuteEstimate: undefined,
            },
        );
        if (filters.source && (filters.maxTransitMinutes != null || filters.maxDrivingMinutes != null)) {
          notices = [
            ...notices,
            'Commute limits and eligible counts use only routes for the selected website. Other websites were not routed; their unknown travel times are excluded.',
          ];
        }
        commute.commute = true;
      } catch (error) {
        if (requireCommute || !(error instanceof CommuteError)) throw error;
        commute.commuteNotice = error.message;
      }
    }
    if (observationsOnly)
      return {
        matches: filters.source
          ? routed.filter((listing) => listing.sources.some((source) => source.id === filters.source && source.url))
          : routed,
        sources,
        notices,
      };
    // A commute limit needs every listing's estimate before the limit is applied, not only those shown.
    if (filters.maxCommuteMinutes != null && !commute.commute && bucket) routed = await withTransitEstimates(routed, bucket, workplace!);
    const formatted = formatSearch(routed, filters, workplace!, mode, sources, notices);
    // Without a routing service, each listing shown gets an estimated transit time to the destination.
    const result =
      commute.commute || !bucket ? formatted : { ...formatted, matches: await withTransitEstimates(formatted.matches, bucket, workplace!) };
    // The client may warn when any contributing live inventory ages out, without
    // initiating another search or transmitting a destination in the background.
    const searched = new Set(sources.filter((source) => source.status === 'searched').map((source) => source.id));
    const expires = refreshCatalog(env)
      .flatMap((definition) => {
        if (!searched.has(definition.marketplace ?? definition.id) && !searched.has(definition.id)) return [];
        const at = sourceExpiresAt(status, definition.id, observedAt);
        return at ? [at] : [];
      })
      .sort();
    const inventoryExpiresAt = filters.liveOnly && !filters.includeCached ? expires[0] : undefined;
    return withHousingLinks(
      { ...result, ...(snapshotMonth ? { snapshotMonth } : {}), ...commute, ...(inventoryExpiresAt ? { inventoryExpiresAt } : {}) },
      bucket,
    );
  }
  const status = known === undefined ? (bucket ? await timed(timings, 'status', () => refreshStatus(bucket)) : null) : known;
  const observedAt = new Date();
  // Searches that people run share one set of listings per Worker instance: every listing, read once and kept, with
  // each search's area and rent matched in memory (matchListings). Reading only what one search could match made
  // every new rent or area a fresh database read, and compared rents with only the listings under that rent.
  const keeps = bucket && (!observationsOnly || reuseKept) ? bucket : undefined;
  const sourceRegion = keeps ? 'all' : parentRegion(filters.region);
  // A one-off read (an alert's check) asks the database for only what it can match: a top-level region and the rent.
  // Official-only searches leave out every source read from a listing site's own pages: Openigloo and the direct rental sources.
  const narrow: SnapshotFilter = keeps
    ? {}
    : {
        ...(filters.region !== 'all' && parentRegion(filters.region) === filters.region ? { region: filters.region } : {}),
        ...(filters.maxRent !== null ? { maxRent: filters.maxRent } : {}),
      };
  const directSources = filters.officialOnly
    ? []
    : DIRECT_RENTAL_SOURCES.filter(({ regions }) => sourceRegion === 'all' || regions.includes(sourceRegion));
  /** The listings this search reads, before its category, bedroom and other filters. */
  async function gather(): Promise<Gathered> {
    const [openigloo, direct, results] = await Promise.all([
      filters.officialOnly
        ? { sourceStatus: undefined, recent: false, data: null, listings: [] }
        : storedSample(
            status,
            OPENIGLOO.id,
            filters.liveOnly,
            () => storedOpenigloo(bucket, narrow),
            observationsOnly,
            filters.includeCached,
          ),
      Promise.all(
        directSources.map(async (source) => ({
          source,
          ...(await storedSample(
            status,
            source.id,
            filters.liveOnly,
            () => storedDirectRentals(bucket, source, narrow),
            observationsOnly,
            filters.includeCached,
          )),
        })),
      ),
      Promise.allSettled(
        feeds.map(async (feed) => {
          if (bucket)
            return storedSample(
              status,
              feed.id,
              filters.liveOnly,
              () => storedFeed(bucket, feed, narrow),
              observationsOnly,
              filters.includeCached,
            );
          const data = await readFeed(feed, fetcher, observedAt);
          return { data, listings: data.listings, recent: true };
        }),
      ),
    ]);
    const listings: ListingData[] = [...openigloo.listings];
    const sources: { id: string; name: string; status: string; sample?: boolean }[] = openigloo.data
      ? [{ id: OPENIGLOO.id, name: OPENIGLOO.name, status: openigloo.recent ? 'searched' : 'cached' }]
      : [];
    const notices = filters.officialOnly
      ? ['This app shows official feeds and open data. Browse listing websites from their links.']
      : openigloo.data
        ? [
            'Openigloo · ' +
              (openigloo.data?.saved ?? openigloo.listings.length) +
              ' apartments from ' +
              (openigloo.recent ? 'its recent check.' : 'its last saved check.'),
          ]
        : [];
    for (const { source, sourceStatus, recent, data, listings: rows } of direct) {
      if (data) {
        listings.push(...rows);
        sources.push({
          id: source.marketplace,
          name: source.name,
          status: recent ? 'searched' : 'cached',
          sample: data.transport !== STREETEASY_EXPORT_FORMAT && !isCompleteSnapshot(source.id, data.transport),
        });
        const coverage =
          data.transport === STREETEASY_EXPORT_FORMAT
            ? STREETEASY_EXPORT_COVERAGE
            : data.transport === STREETEASY_PUBLIC_TRANSPORT
              ? STREETEASY_PUBLIC_COVERAGE
              : source.id === STREETEASY_LIVE.id && data.transport === 'partner-feed'
                ? 'the configured StreetEasy partner feed'
                : source.coverage;
        notices.push(
          source.name +
            ' · ' +
            (data.saved ?? rows.length) +
            (recent ? ' apartments checked in ' : ' saved apartments in ') +
            coverage +
            '.',
        );
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
      return gathered(
        market.listings,
        'snapshot',
        [{ id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' }, ...sources],
        notices,
        market.month,
      );
    }
    if (!hasLive && filters.liveOnly && !(filters.includeCached && hasSavedSamples)) {
      return gathered([], 'live', sources, [...notices, 'No sources have recently confirmed active rentals.']);
    }
    if (!filters.liveOnly && (bucket || hasSavedSamples)) {
      const market = await storedMarket(bucket);
      const historical = new Map<string | null | undefined, { id: string; company?: string }>(
        market.listings.map((listing) => [listing.sources[0].url, listing]),
      );
      const live = mergeListings(listings.filter(({ kind }) => kind === 'feed'));
      const cached = mergeListings(listings.filter(({ kind }) => kind === 'cached'));
      const current = mergeListings([...live, ...cached], { preferFirst: true }).map((listing) => {
        const prior = historical.get(listing.sources.find(({ id }) => id === 'streeteasy')?.url);
        return prior ? { ...listing, id: prior.id, companyFromSnapshot: !listing.company && Boolean(prior.company) } : listing;
      });
      return gathered(
        mergeListings([...current, ...market.listings], { preferFirst: true }),
        'mixed',
        [{ id: 'firstmover', name: 'FirstMover (StreetEasy)', status: 'snapshot' }, ...sources],
        notices,
        market.month,
      );
    }
    return gathered(mergeListings(listings), 'live', sources, notices);
  }
  // Kept for 15 minutes, or until a source check changes them: a later search re-filters them instead of reading
  // and scoring every listing again.
  const key = JSON.stringify({
    narrow,
    sourceRegion,
    officialOnly: filters.officialOnly,
    liveOnly: filters.liveOnly,
    includeCached: filters.includeCached,
    status,
  });
  if (keeps) timings?.note('listings', keptGathered(keeps, key) !== undefined ? 'kept' : 'read');
  const found = await timed(timings, 'read', () => (keeps ? recentlyGathered(keeps, key, gather) : gather()));
  kept = keeps ? found : null;
  return finish(found.listings, found.mode, found.sources, [...found.notices], found.snapshotMonth);
}

/**
 * One listing with its estimated transit time to the person's destination, for its own page (search adds it to
 * every listing shown). A destination that cannot be found leaves the listing as it is.
 */
export async function withTransitEstimate<T extends ListingData>(
  listing: T,
  env: AppEnv,
  place: Pick<SearchFilters, 'workplace' | 'customWorkplace'>,
  fetcher: SourceFetch,
): Promise<T> {
  if (!env.BUCKET) return listing;
  const destination = await Promise.resolve()
    .then(() => resolveWorkplace(parseFilters({ ...place, region: 'all' }), fetcher))
    .catch(() => null);
  if (!destination) return listing;
  const [estimated] = await withTransitEstimates([listing], env.BUCKET, destination);
  return estimated!;
}

/** The subway and PATH stations estimates use, as one list per set read (openData keeps a set ten minutes). */
const estimateStations = new WeakMap<object, Station[]>();
export async function stationsForEstimates(bucket: Bucket) {
  const lists = await openData(bucket);
  const known = estimateStations.get(lists) ?? [...lists.stations, ...lists.path];
  estimateStations.set(lists, known);
  return known;
}
async function withTransitEstimates<T extends ListingData>(
  listings: T[],
  bucket: Bucket,
  destination: { latitude: number; longitude: number },
) {
  return estimated(listings, await stationsForEstimates(bucket), destination);
}

/** The part of Cloudflare's Cache API a search uses. */
type SearchCache = Pick<Cache, 'match' | 'put'>;

/**
 * A search answered from Cloudflare's cache in this data center when the same search ran in the last 15 minutes
 * against the same source checks; every Worker instance there shares it, unlike the listings kept in memory.
 * A new source check changes the key, so new listings show at once.
 */
export async function cachedSearch(
  filters: SearchFilters,
  env: AppEnv,
  fetcher: SourceFetch,
  cache: SearchCache | undefined = (globalThis as { caches?: { default?: Cache } }).caches?.default,
  {
    timings,
    waitUntil,
  }: { timings?: Timings /** Runs work after the response is sent. */; waitUntil?: (work: Promise<unknown>) => void } = {},
): Promise<SearchResponse> {
  if (!cache || !env.BUCKET) return search(filters, env, fetcher, false, { timings });
  const bucket = env.BUCKET;
  const status = await timed(timings, 'status', () => refreshStatus(bucket));
  // Kept per deployed version: a deploy that changes ranking or matching must not serve the old answers.
  const version = env.CF_VERSION_METADATA?.id ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ filters, status, version })));
  const key = new Request(
    `https://search-cache.internal/${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`,
  );
  const hit = await timed(timings, 'cache', () => cache.match(key));
  timings?.note('answer', hit ? 'cached' : 'computed');
  if (hit) return (await hit.json()) as SearchResponse;
  const result = await search(filters, env, fetcher, false, { status, timings });
  // Kept for the next person after this one has their answer, where the Worker allows work after the response.
  const keep = cache
    .put(
      key,
      new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${GATHER_MS / 1000}` },
      }),
    )
    .catch((cause) => log.warn('search_cache_write_failed', { error: cause instanceof Error ? cause.message : String(cause) }));
  if (waitUntil) waitUntil(keep);
  else await keep;
  return result;
}
