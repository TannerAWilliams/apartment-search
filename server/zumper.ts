import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { boroughKey, NYC_SEARCH_AREAS, searchBorough } from '../src/regions.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'zumper', name: 'Zumper', kind: 'feed' };
const ORIGIN = 'https://www.zumper.com';
export const ZUMPER_MARKETS = [
  { city: 'Manhattan', state: 'NY', region: 'nyc' },
  { city: 'Brooklyn', state: 'NY', region: 'nyc' },
  { city: 'Queens', state: 'NY', region: 'nyc' },
  { city: 'The Bronx', state: 'NY', region: 'nyc' }, // Zumper's page is the-bronx-ny
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
].map((market) => ({ ...market, borough: boroughKey(market.city) }));
const PAGES = ZUMPER_MARKETS.flatMap((market) => ['', '/cheap', '?page=2'].map((suffix) => ({
  ...market,
  url: ORIGIN + '/apartments-for-rent/' + market.city.toLowerCase().replaceAll(' ', '-') + '-' + market.state.toLowerCase() + suffix,
})));
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/listings\/\d+p?\/[^/]+\/?$/);
const sharedRental = /\b(?:room[- ]for[- ]rent|private (?:bed)?room|shared (?:apartment|home|housing)|roommates?|roomates?|(?:small|medium|large) (?:size )?room|rent (?:a|one) room)\b/i;

export const ZUMPER_LIVE = {
  ...SOURCE, id: 'zumper-live', marketplace: SOURCE.id, coverage: 'three search pages each in the five NYC boroughs, Jersey City, Hoboken, Newark, Hempstead, Huntington, Yonkers, White Plains, New Rochelle, Stamford, Norwalk and Greenwich',
  regions: ['nyc', 'nj', 'li', 'metroNorth', 'ct'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 60,
  listingUrl, load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, PAGES, parseZumperPage, fetcher, now),
};

export function parseZumperPage(html: string, market: {city:string; state:string; region:string; borough:string|null}, checkedAt: string) {
  const state = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__GIT_SHA__/);
  const rows = state && JSON.parse(state[1])?.currentSearch?.listables?.listables;
  if (!Array.isArray(rows)) throw new Error('Zumper did not return a recognized rental page.');
  return rows.flatMap((row) => {
    const url = listingUrl(row?.url);
    const borough = searchBorough({ state: row?.state, zip: row?.zipcode });
    if (!url || row.listing_status !== 1 || row.listing_type !== 1 || row.property_type !== 4 ||
        row.state !== market.state || !/^\d{5}$/.test(row.zipcode) || !/^\d/.test(row.address ?? '') ||
        (market.borough ? borough !== market.borough : row.city?.trim().toLowerCase() !== market.city.toLowerCase()) || sharedRental.test(url + ' ' + (row.title ?? '') + ' ' + (row.description ?? '')) ||
        row.min_price !== row.max_price || row.min_bedrooms !== row.max_bedrooms ||
        !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return [];

    const city = market.borough && borough ? NYC_SEARCH_AREAS[borough].label : market.city;
    const listing = normalizeListing({
      id: String(row.listing_id), url, address: row.address, city, state: row.state, region: market.region,
      zipCode: row.zipcode, latitude: row.lat, longitude: row.lng, bedrooms: row.min_bedrooms,
      rent: row.min_price, neighborhood: row.neighborhood_name, company: row.brokerage_name,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
