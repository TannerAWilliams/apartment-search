import * as v from 'valibot';
import { isRecord, type ListingData, type Loose, type Point, type SearchFilters } from './domain.ts';
import { LAUNDRY_OPTIONS, matchesDiscovery } from './discovery.ts';
import { companyMatches } from './companies.ts';
import { REGIONS, WORKPLACES, matchesRegion, regionOf } from './regions.ts';
import { buildingGrade } from './insights.ts';
import { nearbyLines, SUBWAY_LINES } from './subway.ts';

export const DEFAULT_FILTERS: SearchFilters = {
  region: 'all',
  bedrooms: 1,
  maxRent: 5000,
  maxMiles: null,
  maxTransitMinutes: null,
  maxDrivingMinutes: null,
  liveOnly: false,
  sort: 'rent',
  bestFitRentWeight: 60,
  source: '',
  company: '',
  minBathrooms: null,
  minSquareFeet: null,
  petsRequired: false,
  laundry: '',
  workplace: 'rockefeller',
  customWorkplace: '',
  zip: '',
};

export const bedroomLabel = (count: number | null) =>
  count === null ? 'Any beds' : count === 0 ? 'Studio' : `${count} bedroom${count === 1 ? '' : 's'}`;
/** The bedrooms a search asks for, in words: "2 bedrooms", "Studio or 1 BR", "1 BR, 2 BR or 4+ BR". */
export function bedroomsLabel(filters: Pick<SearchFilters, 'bedrooms' | 'bedroomOptions'>) {
  const options = filters.bedroomOptions ?? [];
  if (options.length < 2) return bedroomLabel(filters.bedrooms);
  const parts = options.map((count) => (count === 0 ? 'Studio' : count >= 4 ? '4+ BR' : `${count} BR`));
  return parts.slice(0, -1).join(', ') + ' or ' + parts.at(-1);
}
/** A listing's bathrooms as the filter groups them: 1 (up to 1.5), 2 (2 to 2.5), 3 (three or more); 0 when unknown. */
export const bathroomBucket = (bathrooms: number | null | undefined) =>
  bathrooms == null || !(bathrooms > 0) ? 0 : bathrooms >= 3 ? 3 : bathrooms >= 2 ? 2 : 1;
export const formatRent = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
}).format;
export const RESULT_SORTS = {
  best: 'Best fit: rent + commute',
  recent: 'Recently checked',
  rent: 'Lowest rent',
  newest: 'Newest on Walkup',
  value: 'Best value for the area',
  transit: 'Fastest transit',
  driving: 'Fastest drive',
};
const SORT_METRICS: Record<string, 'miles' | 'transitSeconds' | 'drivingSeconds'> = {
  distance: 'miles',
  transit: 'transitSeconds',
  driving: 'drivingSeconds',
};

export const needsCommute = (filters: Loose<Pick<SearchFilters, 'maxTransitMinutes' | 'maxDrivingMinutes' | 'sort'>>) =>
  filters.maxTransitMinutes != null || filters.maxDrivingMinutes != null || filters.sort === 'transit' || filters.sort === 'driving';

export class SearchInputError extends Error {}

/** A number field: blank means none, and digits typed as text count, as forms send them. */
const optionalNumber = (label: string, min: number, max: number, whole = true) =>
  v.optional(
    v.pipe(
      v.unknown(),
      v.transform((value) => (value === '' ? null : value)),
      v.union(
        [v.null(), v.number(), v.pipe(v.string(), v.trim(), v.regex(/^\d+(\.\d+)?$/), v.transform(Number))],
        `Enter a number for ${label}.`,
      ),
      v.check(
        (value) => value === null || (Number.isFinite(value) && value >= min && value <= max && (!whole || Number.isInteger(value))),
        `Enter ${label} between ${min} and ${max}${whole ? ' as a whole number' : ''}.`,
      ),
    ),
    null,
  );
/** Free text: trimmed, and anything that is not text counts as blank. */
const text = v.fallback(v.pipe(v.string(), v.trim()), '');
const flag = v.fallback(v.boolean(), false);

/**
 * Search filters as the app and API accept them, checked in this order with the first problem reported.
 * Blank or missing fields take their defaults; unknown fields are dropped.
 */
export const SearchFiltersSchema = v.pipe(
  v.custom<Record<string, unknown>>(isRecord, 'Enter a valid set of search filters.'),
  v.object({
    region: v.nullish(v.picklist(Object.keys(REGIONS), 'Choose a supported region.'), DEFAULT_FILTERS.region),
    workplace: v.nullish(v.picklist(['custom', ...Object.keys(WORKPLACES)], 'Choose a workplace.'), DEFAULT_FILTERS.workplace),
    customWorkplace: text,
    sort: v.nullish(v.picklist(['distance', ...Object.keys(RESULT_SORTS)], 'Choose a sort order.'), DEFAULT_FILTERS.sort),
    source: v.optional(v.pipe(text, v.regex(/^(?:[a-z0-9][a-z0-9_.-]{0,127})?$/, 'Choose a listing website.')), ''),
    zip: v.optional(v.pipe(text, v.regex(/^(?:\d{5})?$/, 'Enter a five-digit ZIP code.')), ''),
    maxMinutes: v.nullish(v.literal('', 'Use the transit directions link on a listing to check travel time.')),
    laundry: v.nullish(v.picklist(['', ...LAUNDRY_OPTIONS], 'Choose a supported laundry option.'), ''),
    petsRequired: v.nullish(v.boolean('Choose whether pets must be allowed.'), false),
    bestFitRentWeight: optionalNumber('rent ranking weight', 0, 100),
    minBathrooms: optionalNumber('minimum bathrooms', 0.5, 20, false),
    minSquareFeet: optionalNumber('minimum square feet', 1, 100000),
    offset: optionalNumber('result offset', 0, 1000000),
    bedrooms: optionalNumber('bedroom count', 0, 4),
    maxRent: optionalNumber('maximum rent', 1, 100000),
    maxMiles: optionalNumber('maximum distance', 0.1, 250, false),
    maxTransitMinutes: optionalNumber('maximum transit time in minutes', 1, 180),
    maxDrivingMinutes: optionalNumber('maximum driving time in minutes', 1, 180),
    liveOnly: flag,
    includeCached: flag,
    includeMap: flag,
    includeCommute: flag,
    officialOnly: flag,
    neighborhood: v.optional(
      v.pipe(
        text,
        v.transform((name) => name.slice(0, 60)),
      ),
      '',
    ),
    subwayLines: v.fallback(v.pipe(v.array(v.picklist(SUBWAY_LINES)), v.maxLength(SUBWAY_LINES.length)), []),
    nearSubway: flag,
    accessibleSubway: flag,
    newWithinDays: v.fallback(v.nullable(v.picklist([1, 3, 7, 14])), null),
    stabilizedOnly: flag,
    goodBuildings: flag,
    belowMarket: flag,
    bedroomOptions: v.fallback(v.pipe(v.array(v.picklist([0, 1, 2, 3, 4])), v.maxLength(5)), []),
    bathroomOptions: v.fallback(v.pipe(v.array(v.picklist([1, 2, 3])), v.maxLength(3)), []),
    company: v.optional(
      v.pipe(
        text,
        v.transform((company) => company.slice(0, 80)),
      ),
      '',
    ),
  }),
  v.check(
    ({ workplace, customWorkplace }) => workplace !== 'custom' || (customWorkplace.length >= 4 && customWorkplace.length <= 160),
    'Enter a full workplace address or latitude, longitude.',
  ),
  v.transform(
    (input): SearchFilters => ({
      bestFitRentWeight: input.bestFitRentWeight ?? 60,
      minBathrooms: input.minBathrooms,
      minSquareFeet: input.minSquareFeet,
      petsRequired: input.petsRequired,
      laundry: input.laundry,
      region: input.region,
      offset: input.offset ?? 0,
      workplace: input.workplace,
      customWorkplace: input.workplace === 'custom' ? input.customWorkplace : '',
      zip: input.zip,
      liveOnly: input.liveOnly,
      includeCached: input.includeCached,
      includeMap: input.includeMap,
      source: input.source,
      sort: input.sort,
      includeCommute: input.includeCommute,
      officialOnly: input.officialOnly,
      ...(input.neighborhood ? { neighborhood: input.neighborhood } : {}),
      ...(input.subwayLines.length ? { subwayLines: [...new Set(input.subwayLines)] } : {}),
      ...(input.nearSubway ? { nearSubway: true } : {}),
      ...(input.accessibleSubway ? { accessibleSubway: true } : {}),
      ...(input.newWithinDays ? { newWithinDays: input.newWithinDays } : {}),
      ...(input.stabilizedOnly ? { stabilizedOnly: true } : {}),
      ...(input.goodBuildings ? { goodBuildings: true } : {}),
      ...(input.belowMarket ? { belowMarket: true } : {}),
      company: input.company,
      // Several bedroom counts are a list; one is the plain bedroom filter, as saved searches and alerts use it.
      ...(input.bedroomOptions.length > 1 ? { bedroomOptions: [...new Set(input.bedroomOptions)].sort() } : {}),
      ...(input.bathroomOptions.length ? { bathroomOptions: [...new Set(input.bathroomOptions)].sort() } : {}),
      bedrooms: input.bedroomOptions.length === 1 ? input.bedroomOptions[0]! : input.bedroomOptions.length > 1 ? null : input.bedrooms,
      maxRent: input.maxRent,
      maxMiles: input.maxMiles,
      maxTransitMinutes: input.maxTransitMinutes,
      maxDrivingMinutes: input.maxDrivingMinutes,
    }),
  ),
);

/** Checked search filters; the first problem becomes a SearchInputError with a message for the user. */
export function parseFilters(rawInput: unknown = {}): SearchFilters {
  const result = v.safeParse(SearchFiltersSchema, rawInput, { abortEarly: true });
  if (!result.success) throw new SearchInputError(result.issues[0].message);
  return result.output;
}

export function isPoint(point: unknown): point is Point {
  if (
    !point ||
    typeof point !== 'object' ||
    !('latitude' in point) ||
    !('longitude' in point) ||
    typeof point.latitude !== 'number' ||
    typeof point.longitude !== 'number'
  )
    return false;
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point?.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

export function localWorkplace(filters: Pick<SearchFilters, 'workplace' | 'customWorkplace'>) {
  if (filters.workplace !== 'custom') return WORKPLACES[filters.workplace];
  const pieces = filters.customWorkplace.match(/^([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!pieces) return null;
  const point = { label: 'Custom workplace', latitude: Number(pieces[1]), longitude: Number(pieces[2]) };
  if (!isPoint(point)) throw new SearchInputError('Enter latitude from −90 to 90 and longitude from −180 to 180.');
  return point;
}

export function distanceMiles(from: unknown, to: unknown) {
  if (!isPoint(from) || !isPoint(to)) return null;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latDelta = radians(to.latitude - from.latitude);
  const lonDelta = radians(to.longitude - from.longitude);
  const haversine =
    Math.sin(latDelta / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function compareResults(
  a: Pick<ListingData, 'id' | 'rent' | 'seenAt' | 'miles' | 'transitSeconds' | 'drivingSeconds' | 'insights'> & {
    kind?: string;
    bestFit?: { score: number };
  },
  b: Pick<ListingData, 'id' | 'rent' | 'seenAt' | 'miles' | 'transitSeconds' | 'drivingSeconds' | 'insights'> & {
    kind?: string;
    bestFit?: { score: number };
  },
  sort = 'rent',
) {
  if (sort === 'best') {
    const difference = (b.bestFit?.score ?? -1) - (a.bestFit?.score ?? -1);
    if (difference) return difference;
  }
  if (sort === 'newest') {
    const first = Date.parse(a.insights?.firstSeen ?? '') || 0;
    const second = Date.parse(b.insights?.firstSeen ?? '') || 0;
    if (first !== second) return second - first;
  }
  if (sort === 'value') {
    const difference = (a.insights?.vsMarket ?? Infinity) - (b.insights?.vsMarket ?? Infinity);
    if (difference) return difference;
  }
  if (sort === 'recent') {
    if ((a.kind === 'feed') !== (b.kind === 'feed')) return a.kind === 'feed' ? -1 : 1;
    const firstSeen = Date.parse(a.seenAt ?? '');
    const secondSeen = Date.parse(b.seenAt ?? '');
    const firstHasDate = Number.isFinite(firstSeen);
    const secondHasDate = Number.isFinite(secondSeen);
    if (firstHasDate !== secondHasDate) return firstHasDate ? -1 : 1;
    if (firstHasDate && firstSeen !== secondSeen) return secondSeen - firstSeen;
  }
  const metric = SORT_METRICS[sort] ?? 'rent';
  return (a[metric] ?? Infinity) - (b[metric] ?? Infinity) || a.rent - b.rent || a.id.localeCompare(b.id);
}

const placeName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function matchListings(listings: ListingData[], filters: SearchFilters, workplace: Point | null | undefined) {
  return listings.flatMap((listing) => {
    const region = regionOf(listing);
    const hasActiveLink =
      (listing.kind === 'feed' || (filters.includeCached && listing.kind === 'cached')) &&
      listing.sources.some(({ kind, url }) => (kind === 'feed' || (filters.includeCached && kind === 'cached')) && url);
    if (
      !matchesDiscovery(listing, filters) ||
      !region ||
      !companyMatches(listing.company, filters.company) ||
      (filters.liveOnly && !hasActiveLink) ||
      !matchesRegion(listing, filters.region, region) ||
      (filters.zip && listing.zip !== filters.zip) ||
      (filters.bedroomOptions?.length
        ? !filters.bedroomOptions.includes(Math.min(listing.bedrooms, 4))
        : filters.bedrooms !== null && listing.bedrooms !== filters.bedrooms) ||
      (filters.bathroomOptions?.length && !filters.bathroomOptions.includes(bathroomBucket(listing.bathrooms))) ||
      (filters.maxRent !== null && listing.rent > filters.maxRent) ||
      (filters.neighborhood && placeName(listing.neighborhood ?? '') !== placeName(filters.neighborhood)) ||
      (filters.nearSubway && !listing.insights?.subway?.length) ||
      (filters.accessibleSubway && !listing.insights?.subway?.some(({ accessible }) => accessible)) ||
      (filters.newWithinDays && !(Date.parse(listing.insights?.firstSeen ?? '') >= Date.now() - filters.newWithinDays * 86_400_000)) ||
      (filters.subwayLines?.length && !nearbyLines(listing.insights?.subway).some((line) => filters.subwayLines!.includes(line))) ||
      (filters.stabilizedOnly && listing.building?.stabilized !== true) ||
      (filters.goodBuildings && ['C', 'D'].includes(buildingGrade(listing.building) ?? '')) ||
      (filters.belowMarket && !((listing.insights?.vsMarket ?? 0) <= -0.05))
    )
      return [];

    const miles = distanceMiles(listing, workplace);
    if (filters.maxMiles != null && (miles === null || miles > filters.maxMiles)) return [];

    return [{ ...listing, region, miles, bestFit: undefined }];
  });
}

export function directionsLink(
  listing: Partial<Pick<ListingData, 'address' | 'city' | 'state' | 'zip' | 'latitude' | 'longitude'>>,
  workplace: Point,
  mode = 'transit',
) {
  const home = isPoint(listing)
    ? `${listing.latitude},${listing.longitude}`
    : [listing.address, listing.city, listing.state, listing.zip].filter(Boolean).join(', ');
  const work = `${workplace.latitude},${workplace.longitude}`;
  const driving = mode === 'driving';
  return `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: '1',
    origin: home,
    destination: work,
    travelmode: driving ? 'driving' : 'transit',
  })}`;
}
