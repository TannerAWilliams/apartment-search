import { normalizeListing } from '../src/listings.mjs';
import { DEFAULT_FILTERS } from '../src/search.mjs';
import { loadPublicPages, publicListingUrl } from './public-rentals.mjs';

const SOURCE = { id: 'trulia', name: 'Trulia', kind: 'feed' };
const ORIGIN = 'https://www.trulia.com';
const MARKETS = [
  ['Hicksville', 'NY', 'li'],
  ['Stamford', 'CT', 'ct'],
  ['White Plains', 'NY', 'metroNorth'],
  ['Jersey City', 'NJ', 'nj'],
].map(([city, state, region]) => ({
  url: ORIGIN + '/for_rent/' + city.replaceAll(' ', '_') + ',' + state + '/0-' + DEFAULT_FILTERS.maxRent + '_price/', city, state, region,
}));
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/(?:home|building)\/[^/]+-\d+\/?$/);

export const TRULIA_LIVE = {
  ...SOURCE, id: 'trulia-live', marketplace: SOURCE.id, coverage: 'Hicksville, Stamford, White Plains and Jersey City',
  regions: ['li', 'ct', 'metroNorth', 'nj'], minPages: MARKETS.length, maxPages: MARKETS.length, rowsPerPage: 50,
  listingUrl, load: (fetcher, now) => loadPublicPages(SOURCE, MARKETS, parseTruliaPage, fetcher, now),
};

export function parseTruliaPage(html, market, checkedAt) {
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
        location.stateCode !== market.state || location.city?.toLowerCase() !== market.city.toLowerCase() ||
        !Number.isFinite(latitude) || !Number.isFinite(longitude) || !/^\d{5}$/.test(location.zipCode)) return [];

    const rent = row.price?.price ?? (row.price?.min === row.price?.max ? row.price?.min : null);
    const bedrooms = row.bedrooms?.value ?? (row.bedrooms?.min === row.bedrooms?.max ? row.bedrooms?.min : null);
    if (rent > DEFAULT_FILTERS.maxRent) return [];
    const listing = normalizeListing({
      id: url.match(/-(\d+)\/?$/)?.[1], url, address: address[1], unit: address[2],
      city: market.city, state: market.state, region: market.region, zipCode: location.zipCode, latitude, longitude,
      rent, bedrooms, status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [{ ...listing, priceIncludesFees: row.price?.typeDescription === 'Total price' }] : [];
  });
}
