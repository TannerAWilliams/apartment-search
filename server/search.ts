/**
 * Search across saved inventory: every source's latest check, merged, matched against the filters, with
 * commute times when asked and links to affordable-housing lotteries in the same building.
 */
import type { AppEnv, Bucket, SnapshotFilter } from './contracts.ts';
import type { ListingData, SearchFilters, SearchResult, SourceStatus as SearchSource } from '../src/domain.ts';
import { localWorkplace, matchListings, needsCommute } from '../src/search.ts';
import { formatSearch } from '../src/market.ts';
import { withInsights } from '../src/insights.ts';
import { readBuildingFacts } from './building-facts.ts';
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
  const data =
    recent || ((!liveOnly || includeCached) && sourceStatus?.updatedAt)
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

type SearchResponse = SearchResult & { snapshotMonth?: string; commute?: boolean; commuteNotice?: string };
type ObservationResponse = { matches: ListingData[]; sources: SearchSource[]; notices: string[] };
/** Searches with checked filters (see SearchFiltersSchema). With observationsOnly, returns the matches alone, from saved inventory. */
export function search(filters: SearchFilters, env: AppEnv, fetcher?: SourceFetch, observationsOnly?: false): Promise<SearchResponse>;
export function search(
  filters: SearchFilters,
  env: AppEnv,
  fetcher: SourceFetch | undefined,
  observationsOnly: true,
): Promise<ObservationResponse>;
export async function search(filters: SearchFilters, env: AppEnv, fetcher: SourceFetch = fetch, observationsOnly = false) {
  const requireCommute = needsCommute(filters);
  const credentials = routingCredentials(env);
  if (requireCommute && !credentials)
    throw new CommuteError('Automatic commute estimates are unavailable because the routing service is disconnected.');
  const configured = configuredFeeds(env);
  const feeds = configured.filter(
    ({ id }) => id !== STREETEASY_LIVE.marketplace || (!env.BUCKET && env.STREETEASY_SYNC_ENABLED !== 'false'),
  );
  const workplace = observationsOnly ? localWorkplace(filters) : await resolveWorkplace(filters, fetcher);
  const bucket = env.BUCKET;
  async function finish(listings: ListingData[], mode: string, sources: SearchSource[], notices: string[], snapshotMonth?: string) {
    // Every listing gets its comparison with similar apartments and its building's facts before filtering.
    const buildings = bucket ? await readBuildingFacts(bucket).catch(() => ({})) : {};
    const matched = matchListings(withInsights(listings, buildings), filters, workplace).map(listingWithVerifiedLinks);
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
    const result = formatSearch(routed, filters, workplace!, mode, sources, notices);
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
  const status = bucket ? await refreshStatus(bucket) : null;
  const observedAt = new Date();
  const sourceRegion = parentRegion(filters.region);
  // Official-only searches leave out every source read from a listing site's own pages: Openigloo and the direct rental sources.
  // The database returns only listings this search can match: in a top-level region and within the rent.
  // A city area or sub-region is matched by matchListings, which reads more than the region column.
  const narrow: SnapshotFilter = {
    ...(filters.region !== 'all' && parentRegion(filters.region) === filters.region ? { region: filters.region } : {}),
    ...(filters.maxRent !== null ? { maxRent: filters.maxRent } : {}),
  };
  const directSources = filters.officialOnly
    ? []
    : DIRECT_RENTAL_SOURCES.filter(({ regions }) => sourceRegion === 'all' || regions.includes(sourceRegion));
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
        const data =
          feed.format === STREETEASY_EXPORT_FORMAT ? await loadStreetEasyExport(feed, fetcher, observedAt) : await loadFeed(feed, fetcher);
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
        source.name + ' · ' + (data.saved ?? rows.length) + (recent ? ' apartments checked in ' : ' saved apartments in ') + coverage + '.',
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
    return finish(
      market.listings,
      'snapshot',
      [{ id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' }, ...sources],
      notices,
      market.month,
    );
  }
  if (!hasLive && filters.liveOnly && !(filters.includeCached && hasSavedSamples)) {
    return finish([], 'live', sources, [...notices, 'No sources have recently confirmed active rentals.']);
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
    return finish(
      mergeListings([...current, ...market.listings], { preferFirst: true }),
      'mixed',
      [{ id: 'firstmover', name: 'FirstMover (StreetEasy)', status: 'snapshot' }, ...sources],
      notices,
      market.month,
    );
  }
  return finish(mergeListings(listings), 'live', sources, notices);
}
