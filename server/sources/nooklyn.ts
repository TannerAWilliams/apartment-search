/**
 * Nooklyn: every available apartment on Nooklyn's own rentals search (nooklyn.com/rentals, mostly Brooklyn
 * and Queens). The rentals page is drawn by the site's script from its public search endpoint
 * (POST /api/v3/web/listings.search), which this reads page by page, one at a time. robots.txt disallows
 * nothing; the endpoint needs no login or key.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'nooklyn', name: 'Nooklyn', kind: 'feed' };
const ORIGIN = 'https://nooklyn.com';
const SEARCH = ORIGIN + '/api/v3/web/listings.search';
const PER_PAGE = 100;
// About 920 available rentals (10 pages) in November 2026.
const MAX_PAGES = 25;
const PAUSE_MS = 1000;

export const nooklynListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/listings\/[a-z0-9-]+$/);

/** "265 Lorimer St, Brooklyn, NY 11206, USA" */
const FULL_ADDRESS = /^(\d[^,]*), [^,]+, NY (\d{5}), USA$/;

type SearchPage = { listings: unknown[]; pageCount: number; total: number };

async function searchPage(fetcher: FetchTransport, page: number): Promise<SearchPage> {
  const response = await fetcher(SEARCH, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    // The site's own defaults: available residential rentals.
    body: JSON.stringify({ page, per_page: PER_PAGE, order: 'newest' }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.headers.get('cf-mitigated') === 'challenge') {
    throw Object.assign(new Error('Nooklyn answered with a browser verification challenge (bot protection).'), { code: 'bot_challenge' });
  }
  if (!response.ok) throw new Error('Nooklyn returned HTTP ' + response.status + '.');
  const data: unknown = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (
    !isRecord(data) ||
    data.ok !== true ||
    !Array.isArray(data.listings) ||
    !Number.isInteger(data.page_count) ||
    !Number.isInteger(data.total_count) ||
    data.listings.length > PER_PAGE
  ) {
    throw new Error('Nooklyn did not return recognizable rental search results.');
  }
  return { listings: data.listings, pageCount: data.page_count as number, total: data.total_count as number };
}

/** A Nooklyn search result as a listing, or null when it is not an NYC residential rental with a full address. */
export function nooklynListing(row: unknown, checkedAt: string) {
  if (!isRecord(row) || row.rental !== true || row.residential !== true || typeof row.address !== 'string') return null;
  const [, address, zip] = row.address.match(FULL_ADDRESS) ?? [];
  const city = zip ? nycBorough(zip) : null;
  const url = nooklynListingUrl(row.url);
  if (!city || !url || !Number.isSafeInteger(row.id) || typeof row.price !== 'number') return null;
  const unit = typeof row.short_address === 'string' ? (row.short_address.match(/ - Unit: (.+)$/)?.[1] ?? '') : '';
  return normalizeListing(
    {
      id: String(row.id),
      url,
      address,
      unit,
      city,
      state: 'NY',
      region: 'nyc',
      zipCode: zip,
      // Rents are in cents.
      rent: row.price / 100,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      squareFeet: row.square_feet,
      latitude: row.latitude,
      longitude: row.longitude,
      neighborhood: isRecord(row.neighborhood) ? row.neighborhood.name : undefined,
      company: 'Nooklyn',
      status: 'Active',
      updatedAt: checkedAt,
    },
    SOURCE,
  );
}

export async function loadNooklyn(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const first = await searchPage(fetcher, 1);
  if (first.pageCount > MAX_PAGES) throw new Error('Nooklyn listed more rentals than expected.');
  const rows = [...first.listings];
  // One page at a time with a pause, as a person would browse the search.
  for (let page = 2; page <= first.pageCount; page++) {
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    rows.push(...(await searchPage(fetcher, page)).listings);
  }
  const listings = [
    ...new Map(
      rows
        .map((row) => nooklynListing(row, checkedAt))
        .filter((listing) => listing !== null)
        .map((listing) => [listing.id, listing]),
    ).values(),
  ];
  return { listings, pages: Math.max(1, first.pageCount), total: first.total, rawCount: rows.length, checkedAt };
}

export const NOOKLYN_LIVE = {
  ...SOURCE,
  id: 'nooklyn-live',
  marketplace: SOURCE.id,
  coverage: 'every available residential rental in Nooklyn’s own rentals search (NYC addresses only)',
  regions: ['nyc'],
  minPages: 1,
  maxPages: MAX_PAGES,
  rowsPerPage: PER_PAGE,
  listingUrl: nooklynListingUrl,
  load: loadNooklyn,
};
