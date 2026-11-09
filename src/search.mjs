import { DEMO_LISTINGS } from './demo.mjs';
import { REGIONS, WORKPLACES, regionOf } from './regions.mjs';

export const DEFAULT_FILTERS = {
  region: 'all',
  bedrooms: 1,
  maxRent: 2800,
  maxMiles: null,
  maxMinutes: null,
  workplace: 'rockefeller',
  customWorkplace: '',
  zip: '',
  arrival: '08:30',
};

export const ARRIVAL_TIMES = ['08:00', '08:30', '09:00', '09:30', '10:00'];
export const bedroomLabel = (count) => count === null ? 'Any beds' :
  count === 0 ? 'Studio' : `${count} bedroom${count === 1 ? '' : 's'}`;
export const formatRent = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format;

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

export function parseFilters(input = {}) {
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
  if (zip && !/^\d{5}$/.test(zip)) throw new SearchInputError('Enter a five-digit ZIP code.');
  const arrival = input.arrival ?? DEFAULT_FILTERS.arrival;
  if (!ARRIVAL_TIMES.includes(arrival)) throw new SearchInputError('Choose an arrival time.');

  return {
    region,
    workplace,
    customWorkplace: workplace === 'custom' ? customWorkplace : '',
    zip,
    arrival,
    bedrooms: optionalNumber(input.bedrooms, 'bedroom count', 0, 4),
    maxRent: optionalNumber(input.maxRent, 'maximum rent', 1, 100000),
    maxMiles: optionalNumber(input.maxMiles, 'maximum distance', 0.1, 250, false),
    maxMinutes: optionalNumber(input.maxMinutes, 'maximum transit time', 1, 240),
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
  const metric = sort === 'distance' ? 'miles' : sort === 'transit' ? 'transitSeconds' : 'rent';
  return (a[metric] ?? Infinity) - (b[metric] ?? Infinity) ||
    a.rent - b.rent || a.id.localeCompare(b.id);
}

export function matchListings(listings, filters, workplace) {
  return listings.flatMap((listing) => {
    const region = regionOf(listing);
    if (!region || (filters.region !== 'all' && region !== filters.region) ||
        (filters.zip && listing.zip !== filters.zip) ||
        (filters.bedrooms !== null && listing.bedrooms !== filters.bedrooms) ||
        (filters.maxRent !== null && listing.rent > filters.maxRent)) return [];

    const miles = distanceMiles(listing, workplace);
    if (filters.maxMiles !== null && (miles === null || miles > filters.maxMiles)) return [];

    return [{ ...listing, region, miles, transitSeconds: null, transitMiles: null }];
  }).sort(compareResults);
}

export function previewSearch(filters, workplace = localWorkplace(filters)) {
  if (!workplace) throw new SearchInputError('Use a preset or enter latitude, longitude in the offline preview.');
  if (filters.maxMinutes !== null) throw new SearchInputError('Connect a transit provider to search by commute time.');
  const matches = matchListings(DEMO_LISTINGS, filters, workplace);
  return { mode: 'demo', workplace, matches, total: matches.length, sources: [], notices: [], transitArrival: null };
}

export function directionsLink(listing, workplace) {
  const origin = isPoint(listing) ? `${listing.latitude},${listing.longitude}` :
    [listing.address, listing.city, listing.state, listing.zip].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?${new URLSearchParams({
    api: '1', origin, destination: `${workplace.latitude},${workplace.longitude}`, travelmode: 'transit',
  })}`;
}
