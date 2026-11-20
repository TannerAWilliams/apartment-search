import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { boroughKey, boroughLabel, searchBorough } from '../src/regions.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'trulia', name: 'Trulia', kind: 'feed' };
const ORIGIN = 'https://www.trulia.com';
export const TRULIA_MARKETS = [
  { city: 'Manhattan', state: 'NY', region: 'nyc' },
  { city: 'Brooklyn', state: 'NY', region: 'nyc' },
  { city: 'Queens', state: 'NY', region: 'nyc' },
  { city: 'Bronx', state: 'NY', region: 'nyc' },
  { city: 'Staten Island', state: 'NY', region: 'nyc' },
  { city: 'Jersey City', state: 'NJ', region: 'nj' },
  { city: 'Hoboken', state: 'NJ', region: 'nj' },
  { city: 'Newark', state: 'NJ', region: 'nj' },
  { city: 'Hempstead', state: 'NY', region: 'li' },
  { city: 'Huntington', state: 'NY', region: 'li' },
  { city: 'Yonkers', state: 'NY', region: 'metroNorth' },
  { city: 'White Plains', state: 'NY', region: 'metroNorth' },
  { city: 'New Rochelle', state: 'NY', region: 'metroNorth' },
  { city: 'Stamford', state: 'CT', region: 'ct' },
  { city: 'Norwalk', state: 'CT', region: 'ct' },
  { city: 'Greenwich', state: 'CT', region: 'ct' },
];
const MARKETS = TRULIA_MARKETS.flatMap((market) => [1, 2].flatMap((bedrooms) =>
  ['', '2_p/'].map((page) => ({
    ...market, bedrooms,
    url: `${ORIGIN}/for_rent/${market.city.replaceAll(' ', '_')},${market.state}/${bedrooms}_beds/${page}`,
  }))));
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/(?:home|building)\/[^/]+-\d+\/?$/);

export const TRULIA_LIVE = {
  ...SOURCE, id: 'trulia-live', marketplace: SOURCE.id, coverage: 'first two one- and two-bedroom pages in the five NYC boroughs, Jersey City, Hoboken, Newark, Hempstead, Huntington, Yonkers, White Plains, New Rochelle, Stamford, Norwalk and Greenwich',
  regions: ['nyc', 'nj', 'li', 'metroNorth', 'ct'], minPages: MARKETS.length, maxPages: MARKETS.length, rowsPerPage: 50,
  listingUrl, load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, MARKETS, parseTruliaPage, fetcher, now),
};

export function parseTruliaPage(html: string, market: {city:string; state:string; region:string; bedrooms:number}, checkedAt: string) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  const rows = script && JSON.parse(script[1])?.props?.searchData?.homes;
  if (!Array.isArray(rows)) throw new Error('Trulia did not return a recognized rental page.');
  return rows.flatMap((row) => {
    const url = listingUrl(row?.url);
    const location = row?.location;
    const address = location?.streetAddress?.match(/^(\d.+?)(?:\s+#\s*|,\s*Unit\s+|\s+APT\s+)([\w-]+)$/i);
    const { latitude, longitude } = location?.coordinates ?? {};
    if (!url || !address || row.metadata?.unifiedListingType !== 'RENTAL_SINGLE_UNIT' ||
        row.activeListing?.['__typename'] !== 'HOME_ForRentListing' ||
        location.stateCode !== market.state ||
        (boroughKey(market.city) ? searchBorough({ state: location.stateCode, zip: location.zipCode }) !== boroughKey(market.city) :
          location.city?.trim().toLowerCase() !== market.city.toLowerCase()) ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{5}$/.test(location.zipCode)) return [];

    const rent = row.price?.price ?? (row.price?.min === row.price?.max ? row.price?.min : null);
    const bedrooms = row.bedrooms?.value ?? (row.bedrooms?.min === row.bedrooms?.max ? row.bedrooms?.min : null);
    if (Number(bedrooms) !== market.bedrooms) return [];
    const listing = normalizeListing({
      id: url.match(/-(\d+)\/?$/)?.[1], url, address: address[1], unit: address[2],
      city: boroughLabel(market.city), state: market.state, region: market.region, zipCode: location.zipCode, latitude, longitude,
      rent, bedrooms, status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [{ ...listing, priceIncludesFees: row.price?.typeDescription === 'Total price' }] : [];
  });
}
