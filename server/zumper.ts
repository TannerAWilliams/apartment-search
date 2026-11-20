import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { boroughKey, NYC_SEARCH_AREAS, searchBorough } from '../src/regions.ts';
import type { ListingData } from '../src/domain.ts';
import { deduplicatePublicRentals, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'zumper', name: 'Zumper', kind: 'feed', maxBedrooms: 20, maxRent: 200_000 };
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
export const ZUMPER_TRANSPORT = 'complete-zumper-search';
export const ZUMPER_COVERAGE = 'Every individually priced apartment on Zumper’s search pages in the five NYC boroughs, Jersey City, Hoboken, Newark, Hempstead, Huntington, Yonkers, White Plains, New Rochelle, Stamford, Norwalk and Greenwich';
/** Manhattan had 124 search pages in November 2026; this bounds a market's crawl. */
const MAX_MARKET_PAGES = 400;
const PAGE_INTERVAL_MS = 1000;
export const zumperPacing = { intervalMs: PAGE_INTERVAL_MS };
const marketUrl = (market: { city: string; state: string }, page: number) => ORIGIN + '/apartments-for-rent/' +
  market.city.toLowerCase().replaceAll(' ', '-') + '-' + market.state.toLowerCase() + (page > 1 ? '?page=' + page : '');
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/listings\/\d+p?\/[^/]+\/?$/);
const sharedRental = /\b(?:room[- ]for[- ]rent|private (?:bed)?room|shared (?:apartment|home|housing)|roommates?|roomates?|(?:small|medium|large) (?:size )?room|rent (?:a|one) room)\b/i;

export const ZUMPER_LIVE = {
  ...SOURCE, id: 'zumper-live', marketplace: SOURCE.id, coverage: ZUMPER_COVERAGE,
  regions: ['nyc', 'nj', 'li', 'metroNorth', 'ct'], minPages: ZUMPER_MARKETS.length, maxPages: ZUMPER_MARKETS.length * MAX_MARKET_PAGES, rowsPerPage: 25,
  listingUrl, load: loadZumper,
};

type ZumperMarket = typeof ZUMPER_MARKETS[number];
function searchState(html: string) {
  const state = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__GIT_SHA__/);
  const search = state && JSON.parse(state[1])?.currentSearch;
  const rows = search?.listables?.listables;
  if (!Array.isArray(rows)) throw new Error('Zumper did not return a recognized rental page.');
  return { rows, hasMore: search?.hasMoreListables !== false };
}

export function parseZumperPage(html: string, market: {city:string; state:string; region:string; borough:string|null}, checkedAt: string) {
  return zumperListings(searchState(html).rows, market, checkedAt);
}

/**
 * Pages through every market until Zumper reports no more results. Buildings appear as one
 * entry with a price range; only individually priced apartments are saved, and the number of
 * building entries skipped is reported.
 */
export async function loadZumper(fetcher: FetchTransport = fetch, now = new Date(), wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const checkedAt = now.toISOString();
  const listings = new Map<string, ListingData>();
  const entries = new Set<number>();
  let pages = 0;
  let buildings = 0;
  let last = 0;
  async function fetchPage(market: ZumperMarket, page: number) {
    const gap = last + zumperPacing.intervalMs - Date.now();
    if (gap > 0) await wait(gap);
    last = Date.now();
    const response = await fetcher(marketUrl(market, page), { headers: { Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error('Zumper returned HTTP ' + response.status + '.'), { httpStatus: response.status });
    return searchState(await response.text());
  }
  for (const market of ZUMPER_MARKETS) {
    // Paging stops on a page with nothing new for this market; a listing shown in another
    // market's results (Zumper adds nearby ones) is still saved from its own market.
    const seen = new Set<number>();
    for (let page = 1; ; page++) {
      if (page > MAX_MARKET_PAGES) throw new Error(`Zumper ${market.city} has more search pages than the sync allows.`);
      const { rows, hasMore } = await fetchPage(market, page);
      pages++;
      const fresh = rows.filter((row) => Number.isSafeInteger(row?.listing_id) && !seen.has(row.listing_id));
      for (const row of fresh) seen.add(row.listing_id);
      buildings += fresh.filter((row) => !entries.has(row.listing_id) && (row.min_price !== row.max_price || row.min_bedrooms !== row.max_bedrooms)).length;
      for (const row of fresh) entries.add(row.listing_id);
      for (const listing of zumperListings(fresh, market, checkedAt)) if (!listings.has(listing.id)) listings.set(listing.id, listing);
      if (!hasMore || rows.length === 0 || fresh.length === 0) break;
    }
  }
  if (!listings.size) throw new Error('Zumper returned no supported apartment listings.');
  // Separate ads for the same unit become one listing with each ad's link.
  return { listings: deduplicatePublicRentals([...listings.values()]), pages, total: entries.size, rawCount: entries.size, buildings, checkedAt, transport: ZUMPER_TRANSPORT };
}

function zumperListings(rows: any[], market: {city:string; state:string; region:string; borough:string|null}, checkedAt: string): ListingData[] {
  return rows.flatMap((row) => {
    const url = listingUrl(row?.url);
    const borough = searchBorough({ state: row?.state, zip: row?.zipcode });
    if (!url || row.listing_status !== 1 || row.listing_type !== 1 || row.property_type !== 4 ||
        row.state !== market.state || !/^\d{5}$/.test(row.zipcode) || !/^\d/.test(row.address ?? '') ||
        (market.borough ? borough !== market.borough : row.city?.trim().toLowerCase() !== market.city.toLowerCase()) || sharedRental.test(url + ' ' + (row.title ?? '') + ' ' + (row.description ?? '')) ||
        row.min_price !== row.max_price || row.min_bedrooms !== row.max_bedrooms || !(row.min_price > 0 && row.min_price <= 200_000) ||
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
