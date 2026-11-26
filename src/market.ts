import type { ListingData, SearchFilters, SourceStatus, Workplace } from './domain.ts';
import type { RentArea, PackedRentRow } from './rent-history.ts';
import { bestFit } from './best-fit.ts';
import { SNAPSHOT_MONTH } from './data/snapshot-month.ts';
import { listingWithVerifiedLinks, mergeListings, orderedListingLinks } from './listings.ts';
import { matchesRegion } from './regions.ts';
import { compareResults, isPoint, matchListings, SearchInputError } from './search.ts';

/** What the map draws for one home, and what saving from the map needs: its identity, address and every link. */
export function mapPoint(listing: ListingData, source?: string) {
  const [original, ...additionalLinks] = orderedListingLinks(listing.sources, source);
  return {
    // What saving from the map needs: the listing's identity, address and every link.
    id: listing.id,
    address: listing.address,
    unit: listing.unit,
    city: listing.city,
    state: listing.state,
    zip: listing.zip,
    region: listing.region,
    sources: listing.sources,
    latitude: listing.latitude,
    longitude: listing.longitude,
    rent: listing.rent,
    bedrooms: listing.bedrooms,
    title: [listing.address, listing.unit && '#' + listing.unit.replace(/^#/, '')].filter(Boolean).join(' '),
    name: original?.name,
    url: original?.url,
    kind: listing.kind,
    linkKind: original?.kind,
    ...(additionalLinks.length ? { additionalLinks } : {}),
    transitSeconds: listing.transitSeconds,
    drivingSeconds: listing.drivingSeconds,
  };
}

export { SNAPSHOT_MONTH };
export const SNAPSHOT_SOURCE = 'https://www.firstmovernyc.com/open-data';
export const RENT_GROUPINGS = { neighborhood: 'Neighborhood', city: 'Borough / city', zip: 'ZIP code' };
const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
export const formatSnapshotMonth = (month = SNAPSHOT_MONTH) => MONTH_FORMAT.format(new Date(month + '-01T00:00:00Z'));

export type MarketRow = [
  string | number,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  string,
  string,
  string?,
];

export function decodeMarketRows(rows: MarketRow[]) {
  const listings: ListingData[] = rows.map(
    ([id, address, unit, city, county, state, zip, neighborhood, latitude, longitude, bedrooms, rent, path, seenAt, company = '']) => ({
      id: 'streeteasy:' + id,
      address,
      unit,
      city,
      county,
      state,
      zip,
      neighborhood,
      latitude,
      longitude,
      bedrooms,
      rent,
      seenAt,
      company,
      region: state === 'NJ' ? 'nj' : 'nyc',
      kind: 'snapshot',
      sources: [{ id: 'streeteasy', name: 'StreetEasy', url: 'https://streeteasy.com' + path, kind: 'snapshot' }],
    }),
  );
  return mergeListings(listings, { preferFirst: true });
}

export function localSearch(
  listings: ListingData[],
  filters: SearchFilters,
  workplace: Workplace | null | undefined,
  mode: string,
  sources: SourceStatus[] = [],
  notices: string[] = [],
) {
  if (!workplace) throw new SearchInputError('Use a workplace preset or enter latitude, longitude when offline.');
  return formatSearch(matchListings(listings, filters, workplace), filters, workplace, mode, sources, notices);
}

export function formatSearch(
  listings: ListingData[],
  filters: SearchFilters,
  workplace: Workplace,
  mode: string,
  sources: SourceStatus[],
  notices: string[],
) {
  const eligible = listings
    .filter(
      ({ transitSeconds, drivingSeconds }) =>
        (filters.maxTransitMinutes == null || (transitSeconds ?? Infinity) <= filters.maxTransitMinutes * 60) &&
        (filters.maxDrivingMinutes == null || (drivingSeconds ?? Infinity) <= filters.maxDrivingMinutes * 60),
    )
    // The commute limit: a routed time when there is one, else the estimate; without either, the listing is left out.
    .filter(
      ({ transitSeconds, insights }) =>
        filters.maxCommuteMinutes == null ||
        (transitSeconds != null ? transitSeconds / 60 : (insights?.transitMinutes ?? Infinity)) <= filters.maxCommuteMinutes,
    )
    .map(listingWithVerifiedLinks)
    .map((listing) => ({ ...listing, bestFit: filters.sort === 'best' ? bestFit(listing, filters, workplace) : undefined }));
  const bySource = new Map();
  for (const listing of eligible) {
    const links = listing.sources.filter(({ url }) => url);
    const checked = new Set(links.filter(({ kind }) => kind === 'feed').map(({ id }) => id));
    for (const [id, source] of new Map<string, { name: string }>(links.map((source) => [source.id, source]))) {
      const entry = bySource.get(id) ?? { id, name: source.name, count: 0, checkedCount: 0 };
      entry.count += 1;
      if (checked.has(id)) entry.checkedCount += 1;
      bySource.set(id, entry);
    }
  }
  const matches = filters.source
    ? eligible.filter((listing) => listing.sources.some(({ id, url }) => id === filters.source && url))
    : eligible;
  matches.sort((first, second) => compareResults(first, second, filters.sort));
  const mapPoints = filters.includeMap ? matches.filter(isPoint).map((listing) => mapPoint(listing, filters.source)) : undefined;
  const offset = filters.offset ?? 0;
  const pageSize = 100;
  return {
    mode,
    workplace,
    matches: matches.slice(offset, offset + pageSize),
    offset,
    pageSize,
    nextOffset: offset + pageSize < matches.length ? offset + pageSize : null,
    total: matches.length,
    eligibleTotal: eligible.length,
    sourceCounts: [...bySource.values()].sort((a, b) => b.checkedCount - a.checkedCount || b.count - a.count),
    sources,
    notices,
    ...(mapPoints ? { mapPoints } : {}),
  };
}

export function median(values: number[]) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function areaOf(listing: ListingData, grouping: string) {
  const city = `${listing.city}, ${listing.state}`;
  if (grouping === 'zip') return { id: listing.zip, label: listing.zip, detail: listing.state };
  if (grouping === 'city') return { id: city, label: city, detail: '' };
  if (!listing.neighborhood) return { id: city, label: city, detail: 'City / town' };
  return { id: `${city}|${listing.neighborhood}`, label: listing.neighborhood, detail: city };
}

function summarize(area: { id: string; label: string; detail: string; values: number[][] }): RentArea {
  return {
    id: area.id,
    label: area.label,
    detail: area.detail,
    count: area.values.reduce((total, prices) => total + prices.length, 0),
    sizes: area.values.map((prices) => ({ median: median(prices), count: prices.length })),
  };
}

const sizeGroups = (): number[][] => [[], [], [], [], []];

export function rentAreas(listings: ListingData[], { region = 'all', zip = '', grouping = 'neighborhood' } = {}) {
  const areas = new Map<string, { id: string; label: string; detail: string; values: number[][] }>();
  const overall = { id: 'overall', label: 'All covered areas', detail: '', values: sizeGroups() };
  for (const listing of listings) {
    if (
      !matchesRegion(listing, region) ||
      (zip && listing.zip !== zip) ||
      !Number.isInteger(listing.bedrooms) ||
      listing.bedrooms < 0 ||
      listing.bedrooms > 4 ||
      !Number.isFinite(listing.rent) ||
      listing.rent <= 0
    )
      continue;
    const area = areaOf(listing, grouping);
    if (!areas.has(area.id)) areas.set(area.id, { ...area, values: sizeGroups() });
    areas.get(area.id)!.values[listing.bedrooms].push(listing.rent);
    overall.values[listing.bedrooms].push(listing.rent);
  }
  if (areas.size === 0) return [];
  const sorted = [...areas.values()]
    .map(summarize)
    .sort((first, second) => first.label.localeCompare(second.label, 'en', { numeric: true }) || first.detail.localeCompare(second.detail));
  return [summarize(overall), ...sorted];
}

export function packRentMonth(listings: ListingData[]): Record<string, Record<string, PackedRentRow[]>> {
  return Object.fromEntries(
    ['all', 'nyc', 'nj'].map((region) => [
      region,
      Object.fromEntries(
        Object.keys(RENT_GROUPINGS).map((grouping) => [
          grouping,
          rentAreas(listings, { region, grouping }).map(({ id, sizes }) => [id, ...sizes.flatMap(({ median, count }) => [median, count])]),
        ]),
      ),
    ]),
  );
}
