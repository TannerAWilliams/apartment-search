import { companyMatches } from './companies.ts';
import { REGIONS, WORKPLACES, matchesRegion, regionOf } from './regions.ts';

export const DEFAULT_FILTERS = {
  region: 'all',
  bedrooms: 1,
  maxRent: 5000,
  maxMiles: null,
  maxTransitMinutes: null,
  maxDrivingMinutes: null,
  liveOnly: false,
  sort: 'rent',
  source: '',
  company: '',
  workplace: 'rockefeller',
  customWorkplace: '',
  zip: '',
};

export const bedroomLabel = (count) => count === null ? 'Any beds' :
  count === 0 ? 'Studio' : `${count} bedroom${count === 1 ? '' : 's'}`;
export const formatRent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format;
export const RESULT_SORTS = { recent: 'Recently checked', rent: 'Lowest rent', transit: 'Fastest transit', driving: 'Fastest drive' };
const SORT_METRICS = { distance: 'miles', transit: 'transitSeconds', driving: 'drivingSeconds' };

export const needsCommute = (filters) => filters.maxTransitMinutes != null || filters.maxDrivingMinutes != null ||
  filters.sort === 'transit' || filters.sort === 'driving';

export class SearchInputError extends Error {}

function optionalNumber(value, label, min, max, whole = true) {
  if (value === null || value === undefined || value === '') return null;
  if (!['number', 'string'].includes(typeof value) ||
      (typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value.trim()))) {
    throw new SearchInputError(`Enter a number for ${label}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (whole && !Number.isInteger(number))) {
    throw new SearchInputError(`Enter ${label} between ${min} and ${max}${whole ? ' as a whole number' : ''}.`);
  }
  return number;
}

export function parseFilters(input: Record<string, unknown> = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SearchInputError('Enter a valid set of search filters.');
  }
  const region = input.region ?? DEFAULT_FILTERS.region;
  if (typeof region !== 'string' || !Object.hasOwn(REGIONS, region)) throw new SearchInputError('Choose a supported region.');
  const workplace = input.workplace ?? DEFAULT_FILTERS.workplace;
  if (typeof workplace !== 'string' || (workplace !== 'custom' && !Object.hasOwn(WORKPLACES, workplace))) {
    throw new SearchInputError('Choose a workplace.');
  }
  const customWorkplace = typeof input.customWorkplace === 'string' ? input.customWorkplace.trim() : '';
  if (workplace === 'custom' && (customWorkplace.length < 4 || customWorkplace.length > 160)) {
    throw new SearchInputError('Enter a full workplace address or latitude, longitude.');
  }
  const zip = typeof input.zip === 'string' ? input.zip.trim() : '';
  const source = typeof input.source === 'string' ? input.source.trim() : '';
  const sort = input.sort ?? DEFAULT_FILTERS.sort;
  if (typeof sort !== 'string' || (sort !== 'distance' && !Object.hasOwn(RESULT_SORTS, sort))) throw new SearchInputError('Choose a sort order.');
  if (source && !/^[a-z0-9][a-z0-9_.-]{0,127}$/.test(source)) throw new SearchInputError('Choose a listing website.');
  if (zip && !/^\d{5}$/.test(zip)) throw new SearchInputError('Enter a five-digit ZIP code.');
  if (input.maxMinutes !== null && input.maxMinutes !== undefined && input.maxMinutes !== '') {
    throw new SearchInputError('Use the transit directions link on a listing to check travel time.');
  }

  return {
    region,
    workplace,
    customWorkplace: workplace === 'custom' ? customWorkplace : '',
    zip,
    liveOnly: input.liveOnly === true,
    includeMap: input.includeMap === true,
    source,
    sort,
    includeCommute: input.includeCommute === true,
    company: typeof input.company === 'string' ? input.company.trim().slice(0, 80) : '',
    bedrooms: optionalNumber(input.bedrooms, 'bedroom count', 0, 4),
    maxRent: optionalNumber(input.maxRent, 'maximum rent', 1, 100000),
    maxMiles: optionalNumber(input.maxMiles, 'maximum distance', 0.1, 250, false),
    maxTransitMinutes: optionalNumber(input.maxTransitMinutes, 'maximum transit time in minutes', 1, 180),
    maxDrivingMinutes: optionalNumber(input.maxDrivingMinutes, 'maximum driving time in minutes', 1, 180),
  };
}

export function isPoint(point) {
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) &&
    Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

export function localWorkplace(filters) {
  if (filters.workplace !== 'custom') return WORKPLACES[filters.workplace];
  const pieces = filters.customWorkplace.match(/^([+-]?\d+(?:\.\d+)?),\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!pieces) return null;
  const point = { label: 'Custom workplace', latitude: Number(pieces[1]), longitude: Number(pieces[2]) };
  if (!isPoint(point)) throw new SearchInputError('Enter latitude from −90 to 90 and longitude from −180 to 180.');
  return point;
}

export function distanceMiles(from, to) {
  if (!isPoint(from) || !isPoint(to)) return null;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latDelta = radians(to.latitude - from.latitude);
  const lonDelta = radians(to.longitude - from.longitude);
  const haversine = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(lonDelta / 2) ** 2;
  return 3958.76 * 2 * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

export function compareResults(a, b, sort = 'rent') {
  if (sort === 'recent' && (a.kind === 'feed') !== (b.kind === 'feed')) return a.kind === 'feed' ? -1 : 1;
  const metric = SORT_METRICS[sort] ?? 'rent';
  return (a[metric] ?? Infinity) - (b[metric] ?? Infinity) ||
    a.rent - b.rent || a.id.localeCompare(b.id);
}

export function matchListings(listings, filters, workplace) {
  return listings.flatMap((listing) => {
    const region = regionOf(listing);
    const hasActiveLink = listing.kind === 'feed' && listing.sources.some(({ kind, url }) => kind === 'feed' && url);
    if (!region || !companyMatches(listing.company, filters.company) || (filters.liveOnly && !hasActiveLink) || !matchesRegion(listing, filters.region, region) ||
        (filters.zip && listing.zip !== filters.zip) ||
        (filters.bedrooms !== null && listing.bedrooms !== filters.bedrooms) ||
        (filters.maxRent !== null && listing.rent > filters.maxRent)) return [];

    const miles = distanceMiles(listing, workplace);
    if (filters.maxMiles != null && (miles === null || miles > filters.maxMiles)) return [];

    return [{ ...listing, region, miles }];
  });
}

export function directionsLink(listing, workplace, mode = 'transit') {
  const home = isPoint(listing) ? `${listing.latitude},${listing.longitude}` :
    [listing.address, listing.city, listing.state, listing.zip].filter(Boolean).join(', ');
  const work = `${workplace.latitude},${workplace.longitude}`;
  const driving = mode === 'driving';
  return `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: '1', origin: home, destination: work,
    travelmode: driving ? 'driving' : 'transit',
  })}`;
}
