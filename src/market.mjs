import base64 from 'base64-js';
import { gunzipSync, strFromU8 } from 'fflate';
import { SNAPSHOT_GZIP, SNAPSHOT_MONTH } from './data/snapshot.mjs';
import { mergeListings } from './listings.mjs';
import { regionOf } from './regions.mjs';
import { compareResults, isPoint, localWorkplace, matchListings, SearchInputError } from './search.mjs';

export { SNAPSHOT_MONTH };
export const SNAPSHOT_SOURCE = 'https://www.firstmovernyc.com/open-data';
export const RENT_GROUPINGS = { neighborhood: 'Neighborhood', city: 'Borough / city', zip: 'ZIP code' };
const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long', year: 'numeric', timeZone: 'UTC',
});
export const formatSnapshotMonth = (month = SNAPSHOT_MONTH) => MONTH_FORMAT.format(new Date(month + '-01T00:00:00Z'));
export const SNAPSHOT_LABEL = formatSnapshotMonth();

let snapshot;

export function decodeMarketRows(rows) {
  const listings = rows.map(([
    id, address, unit, city, county, state, zip, neighborhood,
    latitude, longitude, bedrooms, rent, path, seenAt, company = '',
  ]) => ({
    id: 'streeteasy:' + id, address, unit, city, county, state, zip, neighborhood,
    latitude, longitude, bedrooms, rent, seenAt, company,
    region: state === 'NJ' ? 'nj' : 'nyc',
    kind: 'snapshot',
    sources: [{ id: 'streeteasy', name: 'StreetEasy', url: 'https://streeteasy.com' + path, kind: 'snapshot' }],
  }));
  return mergeListings(listings, { preferFirst: true });
}

export function marketSnapshot() {
  if (!snapshot) snapshot = decodeMarketRows(JSON.parse(strFromU8(gunzipSync(base64.toByteArray(SNAPSHOT_GZIP)))));
  return snapshot;
}

export function localSearch(listings, filters, workplace, mode, sources = [], notices = []) {
  if (!workplace) throw new SearchInputError('Use a workplace preset or enter latitude, longitude when offline.');
  return formatSearch(matchListings(listings, filters, workplace), filters, workplace, mode, sources, notices);
}

export function formatSearch(listings, filters, workplace, mode, sources, notices) {
  const eligible = listings.filter(({ transitSeconds, drivingSeconds }) =>
    (filters.maxTransitMinutes == null || (transitSeconds ?? Infinity) <= filters.maxTransitMinutes * 60) &&
    (filters.maxDrivingMinutes == null || (drivingSeconds ?? Infinity) <= filters.maxDrivingMinutes * 60));
  const bySource = new Map();
  for (const listing of eligible) {
    const links = listing.sources.filter(({ url }) => url);
    const checked = new Set(links.filter(({ kind }) => kind === 'feed').map(({ id }) => id));
    for (const [id, source] of new Map(links.map((source) => [source.id, source]))) {
      const entry = bySource.get(id) ?? { id, name: source.name, count: 0, checkedCount: 0 };
      entry.count += 1;
      if (checked.has(id)) entry.checkedCount += 1;
      bySource.set(id, entry);
    }
  }
  const matches = filters.source ? eligible.filter((listing) => listing.sources.some(({ id, url }) => id === filters.source && url)) : eligible;
  matches.sort((first, second) => compareResults(first, second, filters.sort));
  const mapPoints = filters.includeMap ? matches.filter(isPoint).map((listing) => {
    const original = listing.sources.find(({ id, url }) => id === filters.source && url) ?? listing.sources.find(({ url }) => url);
    return { latitude: listing.latitude, longitude: listing.longitude, rent: listing.rent, bedrooms: listing.bedrooms,
      title: [listing.address, listing.unit && '#' + listing.unit.replace(/^#/, '')].filter(Boolean).join(' '),
      name: original?.name, url: original?.url, kind: listing.kind,
      transitSeconds: listing.transitSeconds, drivingSeconds: listing.drivingSeconds };
  }) : undefined;
  if (matches.length > 100) notices = [...notices, 'Showing the first 100 matches for the selected sort order. Narrow the area or ZIP to see more of a specific location.'];
  return { mode, workplace, matches: matches.slice(0, 100), total: matches.length, eligibleTotal: eligible.length,
    sourceCounts: [...bySource.values()].sort((a, b) => b.checkedCount - a.checkedCount || b.count - a.count),
    sources, notices, ...(mapPoints ? { mapPoints } : {}) };
}

export function snapshotSearch(filters, workplace = localWorkplace(filters), market = { month: SNAPSHOT_MONTH, listings: marketSnapshot() }) {
  const result = localSearch(market.listings, filters, workplace, 'snapshot', [
    { id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' },
  ]);
  return { ...result, snapshotMonth: market.month };
}

export function median(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((first, second) => first - second);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function areaOf(listing, grouping) {
  const city = `${listing.city}, ${listing.state}`;
  if (grouping === 'zip') return { id: listing.zip, label: listing.zip, detail: listing.state };
  if (grouping === 'city') return { id: city, label: city, detail: '' };
  if (!listing.neighborhood) return { id: city, label: city, detail: 'City / town' };
  return { id: `${city}|${listing.neighborhood}`, label: listing.neighborhood, detail: city };
}

function summarize(area) {
  return {
    id: area.id, label: area.label, detail: area.detail,
    count: area.values.reduce((total, prices) => total + prices.length, 0),
    sizes: area.values.map((prices) => ({ median: median(prices), count: prices.length })),
  };
}

const sizeGroups = () => [[], [], [], [], []];

export function rentAreas(listings, { region = 'all', zip = '', grouping = 'neighborhood' } = {}) {
  const areas = new Map();
  const overall = { id: 'overall', label: 'All covered areas', detail: '', values: sizeGroups() };
  for (const listing of listings) {
    if ((region !== 'all' && regionOf(listing) !== region) || (zip && listing.zip !== zip) ||
        !Number.isInteger(listing.bedrooms) || listing.bedrooms < 0 || listing.bedrooms > 4 ||
        !Number.isFinite(listing.rent) || listing.rent <= 0) continue;
    const area = areaOf(listing, grouping);
    if (!areas.has(area.id)) areas.set(area.id, { ...area, values: sizeGroups() });
    areas.get(area.id).values[listing.bedrooms].push(listing.rent);
    overall.values[listing.bedrooms].push(listing.rent);
  }
  if (areas.size === 0) return [];
  const sorted = [...areas.values()].map(summarize).sort((first, second) =>
    first.label.localeCompare(second.label, 'en', { numeric: true }) || first.detail.localeCompare(second.detail));
  return [summarize(overall), ...sorted];
}

export function packRentMonth(listings) {
  return Object.fromEntries(['all', 'nyc', 'nj'].map((region) => [
    region,
    Object.fromEntries(Object.keys(RENT_GROUPINGS).map((grouping) => [
      grouping, rentAreas(listings, { region, grouping }).map(({ id, sizes }) => [
        id, ...sizes.flatMap(({ median, count }) => [median, count]),
      ]),
    ])),
  ]));
}
