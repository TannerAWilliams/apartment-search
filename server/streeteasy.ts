import { normalizeListing } from '../src/listings.ts';
import { searchBorough } from '../src/regions.ts';
import { NJ_ZIPS, nycBorough } from './firstmover.ts';
import { deduplicatePublicRentals, jsonLd, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' };
const ORIGIN = 'https://streeteasy.com';
const SEARCH_URL = 'https://api-v6.streeteasy.com/';
const SAMPLE_SIZE = 100;
const SEARCH_QUERY = `query SearchRentals {
  searchRentals(input: {
    sorting: { attribute: LISTED_AT, direction: DESCENDING }
    adStrategy: NONE
    filters: { areas: [100, 300], rentalStatus: ACTIVE, bedrooms: { lowerBound: 1, upperBound: 2 } }
    perPage: ${SAMPLE_SIZE}
    page: 1
  }) {
    totalCount
    edges {
      ... on OrganicRentalEdge {
        node {
          id street unit zipCode status bedroomCount price urlPath areaName buildingType
          geoPoint { latitude longitude }
        }
      }
    }
  }
}`;
export const STREETEASY_LIVE = {
  ...SOURCE, id: 'streeteasy-live', marketplace: SOURCE.id,
  coverage: 'its newest one- and two-bedroom search results in Manhattan and Brooklyn',
  // Preserve support for previously imported NYC and NJ batches.
  regions: ['nyc', 'nj'], minPages: 1, maxPages: 20,
  rowsPerPage: SAMPLE_SIZE, listingUrl: streetEasyListingUrl, load: loadStreetEasy,
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

type SearchRental = {
  id?: string;
  street?: string;
  unit?: string;
  zipCode?: string;
  status?: string;
  bedroomCount?: number;
  price?: number;
  urlPath?: string;
  areaName?: string;
  buildingType?: string;
  geoPoint?: { latitude?: number; longitude?: number };
};

export async function loadStreetEasy(fetcher = fetch, now = new Date()) {
  const response = await fetcher(SEARCH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: SEARCH_QUERY }),
    redirect: 'error',
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) throw Object.assign(new Error('StreetEasy returned HTTP ' + response.status + '.'), { httpStatus: response.status });
  const payload = await response.json() as {
    errors?: unknown[];
    data?: { searchRentals?: { totalCount: number; edges: { node?: SearchRental }[] } };
  };
  const result = payload?.data?.searchRentals;
  if (payload?.errors?.length || !Number.isSafeInteger(result?.totalCount) || result.totalCount < 0 ||
      !Array.isArray(result?.edges) || result.edges.length > SAMPLE_SIZE) {
    throw new Error('StreetEasy v6 did not return rental results.');
  }
  const checkedAt = now.toISOString();
  const rows = result.edges.flatMap(({ node }) => {
    if (node?.status !== 'ACTIVE' || ![1, 2].includes(node.bedroomCount) ||
        /^(?:house|townhouse|land|commercial)$/i.test(node.buildingType ?? '')) return [];
    const url = streetEasyListingUrl(node.urlPath);
    const borough = searchBorough({ state: 'NY', zip: node.zipCode });
    if (!url || !borough) return [];
    const listing = normalizeListing({
      id: node.id, url, address: node.street, unit: node.unit, zipCode: node.zipCode,
      city: borough === 'brooklyn' ? 'Brooklyn' : 'Manhattan', state: 'NY',
      neighborhood: node.areaName, bedrooms: node.bedroomCount, rent: node.price,
      latitude: node.geoPoint?.latitude, longitude: node.geoPoint?.longitude,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
  if (result.totalCount > 0 && !rows.length) throw new Error('StreetEasy v6 returned no supported apartment listings.');
  return { listings: deduplicatePublicRentals(rows), pages: 1, total: result.totalCount };
}
