/**
 * Corcoran's New York City rental search (corcoran.com/search/for-rent/regionId/1), newest first. Its robots.txt
 * allows search pages (only a pageSize parameter is disallowed). Each page carries its six listing cards as JSON in
 * __NEXT_DATA__; the full search runs on a separate API host (backendapi.corcoranlabs.com), which is not read. So a
 * sync reads the first 30 pages, about the 180 newest listings (roughly a day or two of new rentals), one page a
 * second. Cards give the street address and unit, rent, bedrooms (none for a studio), baths, size and location.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { CRAWLER_USER_AGENT, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'corcoran', name: 'Corcoran', kind: 'feed' };
const ORIGIN = 'https://www.corcoran.com';
const PAGE_COUNT = 30;
const PAGES = Array.from({ length: PAGE_COUNT }, (_, index) => ({
  url: `${ORIGIN}/search/for-rent/regionId/1?sortBy=listedDate%2Bdesc&page=${index + 1}`,
}));
const LISTING_PATH = /^\/listing\/for-rent\/[a-z0-9-]+\/(?:vow\/)?(\d+)\/regionId\/\d+$/;
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, LISTING_PATH);

export const CORCORAN_LIVE = {
  ...SOURCE,
  id: 'corcoran-live',
  marketplace: SOURCE.id,
  coverage: `NYC rental search, newest first, ${PAGE_COUNT} pages of six listings`,
  regions: ['nyc'],
  minPages: PAGE_COUNT,
  maxPages: PAGE_COUNT,
  rowsPerPage: 12,
  listingUrl,
  load: (fetcher: FetchTransport, now: Date) =>
    loadPublicPages(SOURCE, PAGES, parseCorcoranSearch, fetcher, now, {
      concurrency: 1,
      intervalMs: 1000,
      userAgent: CRAWLER_USER_AGENT,
      timeoutMs: 20_000,
    }),
};

type Card = {
  listingId?: unknown;
  listingStatus?: unknown;
  transactionType?: unknown;
  propertyType?: unknown;
  isBuilding?: unknown;
  isAddressHidden?: unknown;
  isPriceHidden?: unknown;
  price?: unknown;
  address1?: unknown;
  address2?: unknown;
  state?: unknown;
  zipCode?: unknown;
  bedrooms?: unknown;
  bathrooms?: unknown;
  squareFeetInterior?: unknown;
  location?: { latitude?: unknown; longitude?: unknown } | null;
};

export function parseCorcoranSearch(html: string, _page: unknown, checkedAt: string) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  const data = script ? (JSON.parse(script[1]) as { props?: { pageProps?: { initialItems?: unknown } } }) : null;
  const cards = data?.props?.pageProps?.initialItems;
  if (!Array.isArray(cards)) throw new Error('Corcoran did not return a recognized rental search page.');
  // Each card links to its listing page; the JSON has the listing id but not the link.
  const links = new Map<string, string>();
  for (const [, path] of html.matchAll(/href="(\/listing\/for-rent\/[^"?#]+)"/g)) {
    const url = listingUrl(path);
    const id = url && new URL(url).pathname.match(LISTING_PATH)?.[1];
    if (url && id) links.set(id, url);
  }
  return (cards.filter(isRecord) as Card[]).flatMap((card) => {
    const id = typeof card.listingId === 'string' || typeof card.listingId === 'number' ? String(card.listingId) : '';
    const url = links.get(id);
    const zip = typeof card.zipCode === 'string' ? card.zipCode.trim() : '';
    const city = nycBorough(zip);
    if (
      !url ||
      !city ||
      card.listingStatus !== 'Active' ||
      card.transactionType !== 'For Rent' ||
      (card.propertyType != null && card.propertyType !== 'Residential') ||
      card.isBuilding === true ||
      card.isAddressHidden === true ||
      card.isPriceHidden === true ||
      card.state !== 'NY' ||
      typeof card.address1 !== 'string'
    )
      return [];
    const listing = normalizeListing(
      {
        id,
        url,
        address: card.address1,
        unit: typeof card.address2 === 'string' ? card.address2 : '',
        city,
        state: 'NY',
        region: 'nyc',
        zipCode: zip,
        // Studios carry no bedroom count (their listing pages say "Studio"); a card with neither bedrooms nor baths
        // is not described well enough to keep.
        bedrooms: card.bedrooms === null && typeof card.bathrooms === 'number' && card.bathrooms > 0 ? 0 : card.bedrooms,
        rent: card.price,
        bathrooms: card.bathrooms,
        squareFeet: card.squareFeetInterior,
        latitude: card.location?.latitude,
        longitude: card.location?.longitude,
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    return listing ? [listing] : [];
  });
}
