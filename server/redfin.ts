import { normalizeListing } from '../src/listings.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { nycBorough } from './firstmover.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'redfin', name: 'Redfin', kind: 'feed' };
const ORIGIN = 'https://www.redfin.com';
const PAGES = [{ url: ORIGIN + '/city/30749/NY/New-York/apartments-for-rent' }];
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/(?:NY|NJ|CT)\/[^/]+\/[^/]+\/(?:unit-[^/]+\/)?(?:home|apartment)\/\d+\/?$/);

export const REDFIN_LIVE = {
  ...SOURCE, id: 'redfin-live', marketplace: SOURCE.id,
  coverage: 'up to 350 NYC search records; active exact apartment offers only',
  regions: ['nyc'], minPages: 1, maxPages: 1, rowsPerPage: 350,
  listingUrl, load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, PAGES, parseRedfinPage, fetcher, now),
};

export function parseRedfinPage(html: string, _market: unknown, checkedAt: string) {
  // Read the JSON already embedded in the public search page; never execute scripts.
  const state = html.match(/root\.__reactServerState\.InitialContext\s*=\s*(\{[^\n]*\});/);
  const cache = state && JSON.parse(state[1])?.['ReactServerAgent.cache']?.dataCache;
  const entries = cache && Object.entries(cache).filter(([url]) => url.startsWith('/stingray/api/v1/search/rentals?'));
  const entry: any = entries?.find(([url]: [string, unknown]) => url.includes('includeKeyFacts=true'))?.[1] ?? entries?.[0]?.[1];
  const raw = entry?.res?.text;
  const rows = typeof raw === 'string' ? JSON.parse(raw.replace(/^\{\}&&/, ''))?.homes : null;
  if (!Array.isArray(rows)) throw new Error('Redfin did not return a recognized rental page.');
  return rows.flatMap(({ homeData: home, rentalExtension: rental }: { homeData: any; rentalExtension: any }) => {
    const address = home?.addressInfo;
    const city = nycBorough(address?.zip ?? '');
    const url = listingUrl(home?.url);
    const beds = rental?.bedRange;
    const price = rental?.rentPriceRange;
    // Community starting prices and unit-type minimums are not individual apartments.
    if (!url || !city || rental?.status !== 1 || rental.numAvailableUnits !== 1 ||
        ![3, 4, 5, 6].includes(home.propertyType) || beds?.min !== beds?.max || price?.min !== price?.max ||
        !Number.isInteger(beds?.min) || !Number.isFinite(price?.min) || !address.unitNumber ||
        /room for rent|roommate|shared (?:room|apartment)/i.test(rental.description ?? '')) return [];
    const listing = normalizeListing({
      id: rental.rentalId, url, address: address.formattedStreetLine,
      unit: address.unitNumber, city, state: 'NY', region: 'nyc', zipCode: address.zip,
      ...address.centroid?.centroid, bedrooms: beds.min, rent: price.min,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [{ ...listing, priceIncludesFees: rental.isTotalPrice === true }] : [];
  });
}
