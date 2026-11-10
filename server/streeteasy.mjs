import { normalizeListing } from '../src/listings.mjs';
import { NJ_ZIPS, nycBorough } from './firstmover.mjs';
import { deduplicatePublicRentals, fetchPublicHtml, jsonLd, publicListingUrl } from './public-rentals.mjs';

const SOURCE = { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' };
const ORIGIN = 'https://streeteasy.com';
const AREAS = [
  { state: 'NY', path: 'nyc', filter: 'area:100,200,300,400,500|' }, // The five NYC boroughs.
  { state: 'NJ', path: 'new-jersey', filter: '' },
];
const BEDROOM_COUNTS = [0, 1, 2, 3, 4];
export const STREETEASY_MIN_PAGES = AREAS.length * BEDROOM_COUNTS.length;
export const STREETEASY_LIVE = {
  ...SOURCE, id: 'streeteasy-live', marketplace: SOURCE.id, coverage: 'NYC and New Jersey',
  regions: ['nyc', 'nj'], minPages: STREETEASY_MIN_PAGES, maxPages: STREETEASY_MIN_PAGES * 2,
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
  if (!isApartment || !url || typeof streetAddress !== 'string' ||
      addressRegion !== state || !/^\d{5}$/.test(postalCode) || row.numberOfBedrooms !== bedrooms) return null;

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

async function loadPage({ path, filter, state, bedrooms }, page, checkedAt, fetcher) {
  const url = ORIGIN + '/for-rent/' + path + '/' + encodeURIComponent(filter + 'beds:' + bedrooms) +
    '?sort_by=price_asc' + (page === 1 ? '' : '&page=2');
  const html = await fetchPublicHtml(fetcher, url, SOURCE.name);
  return { listings: parseStreetEasyPage(html, state, bedrooms, checkedAt),
    more: /href="[^"]*[?&](?:amp;)?page=2(?:&|")/.test(html) };
}

export async function loadStreetEasy(fetcher = fetch, now = new Date()) {
  const checkedAt = now.toISOString();
  const queries = BEDROOM_COUNTS.flatMap((bedrooms) => AREAS.map((area) => ({ ...area, bedrooms })));
  const rows = [];
  let pages = 0;
  for (let index = 0; index < queries.length; index += 3) {
    const batch = await Promise.all(queries.slice(index, index + 3).map(async (query) => {
      const first = await loadPage(query, 1, checkedAt, fetcher);
      if (first.listings.length >= 5 || !first.more) return { listings: first.listings, pages: 1 };
      const second = await loadPage(query, 2, checkedAt, fetcher);
      return { listings: [...first.listings, ...second.listings], pages: 2 };
    }));
    for (const result of batch) {
      pages += result.pages;
      rows.push(...result.listings);
    }
  }
  const listings = deduplicatePublicRentals(rows);
  if (listings.length === 0) throw new Error('StreetEasy returned no supported apartment listings.');
  return { listings, pages };
}
