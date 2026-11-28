import { pathKey, postedDates } from './posted-dates.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { boroughKey, NYC_SEARCH_AREAS, searchBorough } from '../../src/regions.ts';
import { isRecord, type ListingData } from '../../src/domain.ts';
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
export const ZUMPER_COVERAGE =
  'Every individually priced apartment on Zumper’s search pages in the five NYC boroughs, Jersey City, Hoboken, Newark, Hempstead, Huntington, Yonkers, White Plains, New Rochelle, Stamford, Norwalk and Greenwich';
/** Manhattan had 124 search pages in November 2026; this bounds a market's crawl. */
const MAX_MARKET_PAGES = 400;
const PAGE_INTERVAL_MS = 1000;
/**
 * When Zumper answers "too many requests" (429), the crawl waits and asks again rather than giving up: a single
 * 429 used to throw away every page already read. It waits as long as Zumper says (Retry-After), or 30 s, 60 s,
 * 120 s, and goes slower for the rest of the crawl. A fourth 429 in a row ends the run, as before.
 */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 30_000;
const RATE_LIMIT_MAX_WAIT_MS = 120_000;
export const zumperPacing = { intervalMs: PAGE_INTERVAL_MS };
const marketUrl = (market: { city: string; state: string }, page: number) =>
  ORIGIN +
  '/apartments-for-rent/' +
  market.city.toLowerCase().replaceAll(' ', '-') +
  '-' +
  market.state.toLowerCase() +
  (page > 1 ? '?page=' + page : '');
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/listings\/\d+p?\/[^/]+\/?$/);
/** Apartment, condo and house rental types; other types (rooms, parking) are excluded by the search itself. */
const RESIDENTIAL_TYPES = new Set([0, 1, 4, 9, 13]);
const sharedRental =
  /\b(?:room[- ]for[- ]rent|private (?:bed)?room|shared (?:apartment|home|housing)|roommates?|roomates?|(?:small|medium|large) (?:size )?room|rent (?:a|one) room)\b/i;

export const ZUMPER_LIVE = {
  ...SOURCE,
  id: 'zumper-live',
  marketplace: SOURCE.id,
  coverage: ZUMPER_COVERAGE,
  regions: ['nyc', 'nj', 'li', 'metroNorth', 'ct'],
  minPages: ZUMPER_MARKETS.length,
  maxPages: ZUMPER_MARKETS.length * MAX_MARKET_PAGES,
  rowsPerPage: 25,
  listingUrl,
  load: loadZumper,
};

type ZumperMarket = (typeof ZUMPER_MARKETS)[number];
/** A Zumper search result as this parser reads it; normalizeListing checks every field it keeps. */
type ZumperRow = {
  listing_id?: unknown;
  url?: unknown;
  title?: string;
  description?: string;
  address?: unknown;
  city?: string;
  state?: string;
  zipcode?: string;
  listing_status?: unknown;
  listing_type?: number;
  property_type?: number;
  lat?: unknown;
  lng?: unknown;
  min_price?: unknown;
  max_price?: unknown;
  min_bedrooms?: unknown;
  max_bedrooms?: unknown;
  min_bathrooms?: unknown;
  max_bathrooms?: unknown;
  min_square_feet?: unknown;
  max_square_feet?: unknown;
  neighborhood_name?: unknown;
  brokerage_name?: unknown;
  /** Zumper's own posting date, from the page's structured data (added by searchState). */
  date_posted?: string;
};
type ZumperState = { currentSearch?: { hasMoreListables?: unknown; listables?: { listables?: unknown } } } | null;
const hasListingId = (row: ZumperRow): row is ZumperRow & { listing_id: number } =>
  typeof row.listing_id === 'number' && Number.isSafeInteger(row.listing_id);

function searchState(html: string) {
  const state = html.match(/window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*window\.__GIT_SHA__/);
  const search = state ? (JSON.parse(state[1]) as ZumperState)?.currentSearch : undefined;
  const rows = search?.listables?.listables;
  if (!Array.isArray(rows)) throw new Error('Zumper did not return a recognized rental page.');
  const posted = postedDates(html);
  return {
    rows: (rows.filter(isRecord) as ZumperRow[]).map((row): ZumperRow => ({ ...row, date_posted: posted.get(pathKey(row.url)) })),
    hasMore: search?.hasMoreListables !== false,
  };
}

export function parseZumperPage(
  html: string,
  market: { city: string; state: string; region: string; borough: string | null },
  checkedAt: string,
) {
  return zumperListings(searchState(html).rows, market, checkedAt);
}

/**
 * Pages through every market until Zumper reports no more results. Buildings appear as one
 * entry with a price range; only individually priced apartments are saved, and the number of
 * building entries skipped is reported.
 */
export async function loadZumper(
  fetcher: FetchTransport = fetch,
  now = new Date(),
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  const checkedAt = now.toISOString();
  const listings = new Map<string, ListingData>();
  const entries = new Set<number>();
  let pages = 0;
  let buildings = 0;
  let last = 0;
  let interval = zumperPacing.intervalMs;
  async function request(url: string) {
    const gap = last + interval - Date.now();
    if (gap > 0) await wait(gap);
    last = Date.now();
    // The sync's own fetcher throws on an error status (server/sources/source-requests.ts); a plain one returns it.
    const response = await fetcher(url, { headers: { Accept: 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Object.assign(new Error('Zumper returned HTTP ' + response.status + '.'), { httpStatus: response.status });
    return response;
  }
  async function fetchPage(market: ZumperMarket, page: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        return searchState(await (await request(marketUrl(market, page))).text());
      } catch (error) {
        const { httpStatus, retryAfter } = (error ?? {}) as { httpStatus?: number; retryAfter?: number };
        if (httpStatus !== 429 || attempt >= RATE_LIMIT_RETRIES) throw error;
        const asked = typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter - Date.now() : 0;
        await wait(Math.min(RATE_LIMIT_MAX_WAIT_MS, Math.max(asked, RATE_LIMIT_WAIT_MS * 2 ** attempt)));
        interval = Math.min(interval * 2, 4 * PAGE_INTERVAL_MS);
      }
    }
  }
  for (const market of ZUMPER_MARKETS) {
    // Paging stops on a page with nothing new for this market; a listing shown in another
    // market's results (Zumper adds nearby ones) is still saved from its own market.
    const seen = new Set<number>();
    for (let page = 1; ; page++) {
      if (page > MAX_MARKET_PAGES) throw new Error(`Zumper ${market.city} has more search pages than the sync allows.`);
      const { rows, hasMore } = await fetchPage(market, page);
      pages++;
      const fresh = rows.filter(hasListingId).filter((row) => !seen.has(row.listing_id));
      for (const row of fresh) seen.add(row.listing_id);
      buildings += fresh.filter(
        (row) => !entries.has(row.listing_id) && (row.min_price !== row.max_price || row.min_bedrooms !== row.max_bedrooms),
      ).length;
      for (const row of fresh) entries.add(row.listing_id);
      for (const listing of zumperListings(fresh, market, checkedAt)) if (!listings.has(listing.id)) listings.set(listing.id, listing);
      if (!hasMore || rows.length === 0 || fresh.length === 0) break;
    }
  }
  if (!listings.size) throw new Error('Zumper returned no supported apartment listings.');
  // Separate ads for the same unit become one listing with each ad's link.
  return {
    listings: deduplicatePublicRentals([...listings.values()]),
    pages,
    total: entries.size,
    rawCount: entries.size,
    buildings,
    checkedAt,
    transport: ZUMPER_TRANSPORT,
  };
}

function zumperListings(
  rows: ZumperRow[],
  market: { city: string; state: string; region: string; borough: string | null },
  checkedAt: string,
): ListingData[] {
  return rows.flatMap((row) => {
    const url = listingUrl(row.url);
    const borough = row.state ? searchBorough({ state: row.state, zip: row.zipcode }) : null;
    // listing_type 3 is a broker listing whose building number Zumper hides ("E 13th St #3AB");
    // it is kept when it names a unit, since its map position is still exact.
    const address = String(row.address ?? '');
    const identified = /^\d/.test(address) || (row.listing_type === 3 && /#\s*\w+$/.test(address));
    if (
      !url ||
      row.listing_status !== 1 ||
      ![1, 3].includes(row.listing_type ?? 0) ||
      !RESIDENTIAL_TYPES.has(row.property_type ?? -1) ||
      row.state !== market.state ||
      !/^\d{5}$/.test(row.zipcode ?? '') ||
      !identified ||
      (market.borough ? borough !== market.borough : row.city?.trim().toLowerCase() !== market.city.toLowerCase()) ||
      sharedRental.test(url + ' ' + (row.title ?? '') + ' ' + (row.description ?? '')) ||
      row.min_price !== row.max_price ||
      row.min_bedrooms !== row.max_bedrooms ||
      typeof row.min_price !== 'number' ||
      !(row.min_price > 0 && row.min_price <= 200_000) ||
      !Number.isFinite(row.lat) ||
      !Number.isFinite(row.lng)
    )
      return [];

    const city = market.borough && borough ? NYC_SEARCH_AREAS[borough].label : market.city;
    const listing = normalizeListing(
      {
        id: String(row.listing_id),
        url,
        address: row.address,
        city,
        state: row.state,
        region: market.region,
        zipCode: row.zipcode,
        latitude: row.lat,
        longitude: row.lng,
        bedrooms: row.min_bedrooms,
        rent: row.min_price,
        // One apartment has one count; a range belongs to a building's page, which is skipped above.
        bathrooms: row.min_bathrooms === row.max_bathrooms && Number(row.min_bathrooms) > 0 ? row.min_bathrooms : undefined,
        squareFeet: row.min_square_feet === row.max_square_feet && Number(row.min_square_feet) > 0 ? row.min_square_feet : undefined,
        neighborhood: row.neighborhood_name,
        company: row.brokerage_name,
        status: 'Active',
        updatedAt: checkedAt,
        listedAt: row.date_posted,
      },
      SOURCE,
    );
    return listing ? [listing] : [];
  });
}
