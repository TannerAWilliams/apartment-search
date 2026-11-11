import { normalizeListing } from '../src/listings.ts';
import { searchBorough } from '../src/regions.ts';
import { NJ_ZIPS, nycBorough } from './firstmover.ts';
import { jsonLd, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' };
const ORIGIN = 'https://streeteasy.com';
const PAGES = ['manhattan', 'brooklyn'].flatMap((borough) => [1, 2].flatMap((bedrooms) =>
  ['', '?page=2'].map((suffix) => ({ borough, bedrooms,
    url: ORIGIN + '/' + bedrooms + '-bedroom-apartments-for-rent/' + borough + suffix }))));
export const STREETEASY_LIVE = {
  ...SOURCE, id: 'streeteasy-live', marketplace: SOURCE.id,
  coverage: 'the first two one- and two-bedroom search pages per borough',
  // Preserve support for previously imported NYC and NJ batches.
  regions: ['nyc', 'nj'], minPages: PAGES.length, maxPages: 20,
  rowsPerPage: 20, listingUrl: streetEasyListingUrl, load: loadStreetEasy,
};
const MULTIFAMILY = new Set(['TWOFAMILY', 'THREEFAMILY', 'MULTIFAMILY']);

export function streetEasyListingUrl(value) {
  return publicListingUrl(value, ORIGIN, /^\/(?:rental\/\d+|building\/[^/]+\/(?:[^/]+|rental\/\d+))$/);
}

function normalizeRental(row, state, bedrooms, checkedAt) {
  const { streetAddress, addressLocality, addressRegion, postalCode } = row.address ?? {};
  const url = streetEasyListingUrl(row.url);
  const unit = typeof row.name === 'string' ? row.name.match(/\s#\s*([^#]+)$/)?.[1] : '';
  const properties = Array.isArray(row.additionalProperty) ? row.additionalProperty : [];
  const property = (name) => properties.find((entry) => entry?.name === name)?.value;
  const buildingType = property('Building Type');
  const isApartment = row['@type'] === 'Apartment' || (unit && MULTIFAMILY.has(buildingType));
  const availability = row.offers?.availability ?? property('Status');
  if (!isApartment || !url || typeof streetAddress !== 'string' ||
      addressRegion !== state || !/^\d{5}$/.test(postalCode) || row.numberOfBedrooms !== bedrooms ||
      (availability && !/^(?:active|available|(?:https?:\/\/schema\.org\/)?instock)$/i.test(availability))) return null;

  const rentText = property('Monthly Rent');
  const rent = typeof rentText === 'string' ? rentText.match(/^\$([\d,]+(?:\.\d{2})?)\/mo$/)?.[1] : null;
  const { latitude, longitude } = row.geo ?? {};
  if (!rent || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 40 || latitude > 42 || longitude < -75 || longitude > -72) return null;

  const [njCity, county] = NJ_ZIPS[postalCode] ?? [];
  const city = state === 'NY' ? nycBorough(postalCode) :
    postalCode === '07093' && addressLocality === 'Guttenberg' ? 'Guttenberg' : njCity ?? addressLocality;
  const path = new URL(url).pathname;
  const rentalId = path.match(/\/rental\/(\d+)$/)?.[1];
  return normalizeListing({
    id: rentalId ?? path, url, address: streetAddress, unit, city, county, state, zipCode: postalCode,
    region: state === 'NY' ? 'nyc' : 'nj', neighborhood: addressLocality, latitude, longitude,
    bedrooms, rent: Number(rent.replaceAll(',', '')), status: 'Active', updatedAt: checkedAt,
  }, SOURCE);
}

export function parseStreetEasyPage(html, state, bedrooms, checkedAt) {
  const rentals = jsonLd(html).flatMap((schema) => Array.isArray(schema?.['@graph']) ?
    schema['@graph'].filter((row) => row?.address?.postalCode && row.url) : []);
  if (!rentals.length) throw new Error('StreetEasy did not return a recognized rental page.');
  return rentals.map((row) => normalizeRental(row, state, bedrooms, checkedAt)).filter(Boolean);
}

export function loadStreetEasy(fetcher = fetch, now = new Date()) {
  return loadPublicPages(SOURCE, PAGES, (html, { borough, bedrooms }, checkedAt) =>
    parseStreetEasyPage(html, 'NY', bedrooms, checkedAt).filter((listing) => searchBorough(listing) === borough), fetcher, now);
}
