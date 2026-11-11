import { normalizeListing } from '../src/listings.ts';
import { NYC_SEARCH_AREAS, searchBorough } from '../src/regions.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'zumper', name: 'Zumper', kind: 'feed' };
const ORIGIN = 'https://www.zumper.com';
const PAGES = ['manhattan', 'brooklyn'].flatMap((borough) => ['', '/cheap', '?page=2'].map((suffix) => ({
  url: ORIGIN + '/apartments-for-rent/' + borough + '-ny' + suffix, state: 'NY', region: 'nyc', borough,
})));
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/listings\/\d+p?\/[^/]+\/?$/);
const sharedRental = /\b(?:room[- ]for[- ]rent|private (?:bed)?room|shared (?:apartment|home|housing)|roommates?|roomates?|(?:small|medium|large) (?:size )?room|rent (?:a|one) room)\b/i;

export const ZUMPER_LIVE = {
  ...SOURCE, id: 'zumper-live', marketplace: SOURCE.id, coverage: 'Manhattan and Brooklyn',
  regions: ['nyc'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 60,
  listingUrl, load: (fetcher, now) => loadPublicPages(SOURCE, PAGES, parseZumperPage, fetcher, now),
};

export function parseZumperPage(html, market, checkedAt) {
  const state = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__GIT_SHA__/);
  const rows = state && JSON.parse(state[1])?.currentSearch?.listables?.listables;
  if (!Array.isArray(rows)) throw new Error('Zumper did not return a recognized rental page.');
  return rows.flatMap((row) => {
    const url = listingUrl(row?.url);
    const borough = searchBorough({ state: row?.state, zip: row?.zipcode });
    if (!url || row.listing_status !== 1 || row.listing_type !== 1 || row.property_type !== 4 ||
        row.state !== market.state || !/^\d{5}$/.test(row.zipcode) || !/^\d/.test(row.address ?? '') ||
        borough !== market.borough || sharedRental.test(url + ' ' + (row.title ?? '') + ' ' + (row.description ?? '')) ||
        row.min_price !== row.max_price || row.min_bedrooms !== row.max_bedrooms ||
        !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return [];

    const city = NYC_SEARCH_AREAS[borough].label;
    const listing = normalizeListing({
      id: String(row.listing_id), url, address: row.address, city, state: row.state, region: market.region,
      zipCode: row.zipcode, latitude: row.lat, longitude: row.lng, bedrooms: row.min_bedrooms,
      rent: row.min_price, neighborhood: row.neighborhood_name, company: row.brokerage_name,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
