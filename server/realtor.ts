import { normalizeListing } from '../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'realtor', name: 'Realtor.com', kind: 'feed' };
const ORIGIN = 'https://www.realtor.com';
const PAGES = [
  ['Queens_NY', 'Queens', 'nyc'],
  ['Hicksville_NY', 'Hicksville', 'li'],
  ['White-Plains_NY', 'White Plains', 'metroNorth'],
].map(([slug, city, region]) => ({
  url: ORIGIN + '/apartments/' + slug + '/price-na-2800', city, region,
}));
const APARTMENTS = new Set(['apartment', 'condos', 'coop']);
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/rentals\/details\/[^/]+_M\d+-\d+\/?$/);

export const REALTOR_LIVE = {
  ...SOURCE, id: 'realtor-live', marketplace: SOURCE.id, coverage: 'Queens, Hicksville and White Plains',
  regions: ['nyc', 'li', 'metroNorth'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 50,
  listingUrl, load: (fetcher, now) => loadPublicPages(SOURCE, PAGES, parseRealtorPage, fetcher, now),
};

export function parseRealtorPage(html, market, checkedAt) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  const rows = script && JSON.parse(script[1])?.props?.pageProps?.properties;
  if (!Array.isArray(rows)) throw new Error('Realtor.com did not return a recognized rental page.');
  return rows.flatMap((row) => {
    const description = row?.description;
    const address = row?.location?.address;
    const { lat, lon } = address?.coordinate ?? {};
    const url = typeof row?.permalink === 'string' ? listingUrl('/rentals/details/' + row.permalink) : null;
    const city = market.region === 'nyc' ? nycBorough(address?.postal_code ?? '') : address?.city;
    if (!url || row.status !== 'for_rent' || row.flags?.is_pending || !APARTMENTS.has(description?.type) ||
        !Number.isInteger(description.beds) || !Number.isFinite(row.list_price) || row.list_price > 2800 ||
        address?.state_code !== 'NY' || !/^\d{5}$/.test(address.postal_code) || !/^\d/.test(address.line ?? '') ||
        city?.toLowerCase() !== market.city.toLowerCase() || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];

    const listing = normalizeListing({
      id: row.listing_id, url, address: address.line, city, state: 'NY', region: market.region,
      zipCode: address.postal_code, latitude: lat, longitude: lon, bedrooms: description.beds, rent: row.list_price,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
