import { normalizeListing } from '../src/listings.mjs';
import { nycBorough } from './firstmover.mjs';
import { loadPublicPages, publicListingUrl } from './public-rentals.mjs';

const SOURCE = { id: 'zumper', name: 'Zumper', kind: 'feed' };
const ORIGIN = 'https://www.zumper.com';
const PAGES = [
  ['new-york-ny', 'NY', 'nyc'],
  ['new-york-ny/cheap', 'NY', 'nyc'],
  ['jersey-city-nj', 'NJ', 'nj'],
  ['white-plains-ny', 'NY', 'metroNorth'],
  ['stamford-ct', 'CT', 'ct'],
].map(([path, state, region]) => ({ url: ORIGIN + '/apartments-for-rent/' + path, state, region }));
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/listings\/\d+\/[^/]+\/?$/);

export const ZUMPER_LIVE = {
  ...SOURCE, id: 'zumper-live', marketplace: SOURCE.id, coverage: 'NYC, Jersey City, White Plains and Stamford',
  regions: ['nyc', 'nj', 'metroNorth', 'ct'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 60,
  listingUrl, load: (fetcher, now) => loadPublicPages(SOURCE, PAGES, parseZumperPage, fetcher, now),
};

export function parseZumperPage(html, market, checkedAt) {
  const state = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__GIT_SHA__/);
  const rows = state && JSON.parse(state[1])?.currentSearch?.listables?.listables;
  if (!Array.isArray(rows)) throw new Error('Zumper did not return a recognized rental page.');
  return rows.flatMap((row) => {
    const url = listingUrl(row?.url);
    if (!url || row.listing_status !== 1 || row.listing_type !== 1 || row.property_type !== 4 ||
        row.state !== market.state || !/^\d{5}$/.test(row.zipcode) || !/^\d/.test(row.address ?? '') ||
        row.min_price !== row.max_price || row.min_bedrooms !== row.max_bedrooms ||
        !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return [];

    const city = market.region === 'nyc' ? nycBorough(row.zipcode) : row.city;
    const listing = normalizeListing({
      id: String(row.listing_id), url, address: row.address, city, state: row.state, region: market.region,
      zipCode: row.zipcode, latitude: row.lat, longitude: row.lng, bedrooms: row.min_bedrooms,
      rent: row.min_price, neighborhood: row.neighborhood_name, company: row.brokerage_name,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
