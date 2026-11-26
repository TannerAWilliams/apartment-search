import type { FetchTransport } from '../../src/fetch-type.ts';
import { MARKETPLACE_NAMES, safeListingUrl } from '../../src/marketplaces.ts';
import { isRecord, type ListingData } from '../../src/domain.ts';
import { normalizeListing } from '../../src/listings.ts';
import { DIRECT_RENTAL_SOURCES } from './direct-rentals.ts';
import { HDC_RERENTALS } from './hdc-rerentals.ts';
import { MANAGER_RERENTALS } from './manager-rerentals.ts';
import { JERSEY_AFFORDABLE } from './jersey-affordable.ts';
import { WESTCHESTER_HOMESEEKER } from './westchester-homeseeker.ts';
import { STREETEASY_LIVE, streetEasyListingUrl } from './streeteasy.ts';
import { RESO_FEED_FORMAT, resoRentalRow } from './reso-rentals.ts';

export const STREETEASY_EXPORT_FORMAT = 'streeteasy-complete-export-v1';
export const STREETEASY_EXPORT_COVERAGE = 'provider-supplied complete active StreetEasy export';
export const STREETEASY_EXPORT_MAX_AGE = 12 * 60 * 60_000;

const RESERVED_FEEDS = new Set([
  'firstmover',
  'housingconnect',
  'openigloo',
  HDC_RERENTALS.id,
  MANAGER_RERENTALS.id,
  JERSEY_AFFORDABLE.id,
  WESTCHESTER_HOMESEEKER.id,
  ...DIRECT_RENTAL_SOURCES.map(({ id }) => id),
]);
const MAX_PAGES = 40;
const MAX_ROWS = 25000;
// Bound decoded response bytes before JSON parsing, independently of row count.
// Large authorized feeds can paginate rather than exhaust a free server's memory.
const MAX_PAGE_BYTES = 16 * 1024 * 1024;

/** A partner feed page as sent. Every field is checked before it is used. */
type FeedPage = { listings?: unknown; total?: unknown; next?: unknown; limited?: unknown };
type ResoPage = { value?: unknown; '@odata.count'?: unknown; '@odata.nextLink'?: unknown };
type ExportPage = FeedPage & { generatedAt?: unknown; schema?: unknown; scope?: unknown; complete?: unknown; partial?: unknown };
type FeedConfig = { id?: unknown; name?: unknown; url?: unknown; token?: unknown; format?: unknown };

class IncompleteFeedError extends Error {
  code = 'incomplete_feed';
}

async function readFeedPage(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_PAGE_BYTES) {
    await response.body?.cancel();
    throw new IncompleteFeedError('Feed page exceeded its byte limit; use smaller pages');
  }
  if (!response.body) throw new Error('Invalid feed response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new IncompleteFeedError('Feed page exceeded its byte limit; use smaller pages');
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(''));
  } finally {
    reader.releaseLock();
  }
}

export function configuredFeeds(env: { FREE_PARTNER_FEEDS_JSON?: string }) {
  if (!env.FREE_PARTNER_FEEDS_JSON) return [];
  let configured: unknown;
  try {
    configured = JSON.parse(env.FREE_PARTNER_FEEDS_JSON);
  } catch {
    throw new Error('The free feed configuration is invalid.');
  }
  if (!Array.isArray(configured) || configured.length > 15) {
    throw new Error('Configure up to 15 authorized free feeds.');
  }

  const ids = new Set<string>();
  return configured.map((entry) => {
    const feed: FeedConfig = isRecord(entry) ? entry : {};
    const id = feed.id;
    const name =
      typeof id === 'string' && Object.hasOwn(MARKETPLACE_NAMES, id)
        ? MARKETPLACE_NAMES[id]
        : typeof feed.name === 'string'
          ? feed.name.trim()
          : '';
    const url = safeListingUrl(feed.url);
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(id) || RESERVED_FEEDS.has(id) || ids.has(id) || !name || !url) {
      throw new Error('A free feed is missing a unique ID, name, or HTTPS URL.');
    }
    const validFormat = id === STREETEASY_LIVE.marketplace ? STREETEASY_EXPORT_FORMAT : RESO_FEED_FORMAT;
    if (feed.format !== undefined && feed.format !== validFormat) {
      throw new Error('The listing feed has an unsupported export format.');
    }
    if (feed.token !== undefined && typeof feed.token !== 'string') throw new Error('A free feed token must be text.');
    ids.add(id);
    return {
      id,
      name: name.slice(0, 48),
      url,
      token: feed.token,
      kind: 'feed',
      format: feed.format === undefined ? undefined : validFormat,
    };
  });
}

export async function loadFeed(
  feed: { id: string; name: string; url: string; token?: string; kind: string; maxBedrooms?: number; format?: string },
  fetcher: FetchTransport,
  { requireTotal = false } = {},
) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (feed.token) headers.Authorization = `Bearer ${feed.token}`;
  const start = new URL(feed.url);
  start.hash = '';
  const deadline = AbortSignal.timeout(25000);
  const visited = new Set();
  const listings: ListingData[] = [];
  const listingIds = new Set<string>();
  let rowCount = 0;
  let reportedTotal: number | undefined;
  let url: string | null = start.href;
  while (url) {
    if (visited.has(url) || visited.size >= MAX_PAGES) throw new IncompleteFeedError('Pagination did not finish');
    visited.add(url);
    const response = await fetcher(url, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.any([deadline, AbortSignal.timeout(9000)]),
    });
    if (!response.ok) throw new Error('Feed unavailable');
    const payload = await readFeedPage(response);
    const reso: ResoPage = isRecord(payload) ? payload : {};
    const body: FeedPage =
      feed.format === RESO_FEED_FORMAT
        ? { listings: reso.value, total: reso['@odata.count'], next: reso['@odata.nextLink'] }
        : isRecord(payload)
          ? payload
          : {};
    const rows = feed.format !== RESO_FEED_FORMAT && Array.isArray(payload) ? payload : body.listings;
    if (!Array.isArray(rows)) throw new Error('Invalid feed response');
    rowCount += rows.length;
    if (rowCount > MAX_ROWS || body.limited === true) throw new IncompleteFeedError('Inventory exceeded its limit');
    if (body.total != null) {
      if (
        typeof body.total !== 'number' ||
        !Number.isSafeInteger(body.total) ||
        body.total < 0 ||
        body.total > MAX_ROWS ||
        (reportedTotal !== undefined && reportedTotal !== body.total)
      ) {
        throw new IncompleteFeedError('Inventory count changed or exceeded its limit');
      }
      reportedTotal = body.total;
    }
    // Stop immediately once complete coverage is impossible; do not fetch more pages.
    if (reportedTotal !== undefined && rowCount > reportedTotal) {
      throw new IncompleteFeedError('Inventory count exceeded its reported total');
    }
    for (const row of rows) {
      const listing = normalizeListing(feed.format === RESO_FEED_FORMAT ? resoRentalRow(row) : row, feed);
      if (listing) {
        if (listingIds.has(listing.id)) throw new IncompleteFeedError('Inventory repeated a listing across feed rows');
        listingIds.add(listing.id);
        listings.push(listing);
      }
    }
    if (body.next == null) break;
    if (typeof body.next !== 'string' || !body.next.trim()) throw new IncompleteFeedError('Invalid next page');
    let next: URL;
    try {
      next = new URL(body.next, url);
    } catch {
      throw new IncompleteFeedError('Invalid next page');
    }
    next.hash = '';
    url = safeListingUrl(next.href);
    if (!url || next.origin !== start.origin) throw new IncompleteFeedError('Next page must stay on the feed origin');
  }
  if (reportedTotal !== undefined && rowCount !== reportedTotal) throw new IncompleteFeedError('Inventory count did not match');
  if (requireTotal && reportedTotal === undefined) throw new IncompleteFeedError('Inventory did not report a total');
  return {
    listings,
    pages: visited.size,
    ...((requireTotal || feed.format === RESO_FEED_FORMAT) && reportedTotal !== undefined ? { total: reportedTotal } : {}),
  };
}

/** A complete export is a single, current snapshot covering every StreetEasy market. */
export async function loadStreetEasyExport(feed: { url: string; token?: string }, fetcher: FetchTransport, now: Date) {
  const headers = new Headers({ Accept: 'application/json' });
  if (feed.token) headers.set('Authorization', 'Bearer ' + feed.token);
  const response = await fetcher(feed.url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('StreetEasy export returned HTTP ' + response.status + '.');
  const payload = await readFeedPage(response);
  const body: ExportPage = isRecord(payload) ? payload : {};
  const rows = body.listings;
  const generatedAt = typeof body.generatedAt === 'string' && /Z$/.test(body.generatedAt) ? Date.parse(body.generatedAt) : NaN;
  const age = now.getTime() - generatedAt;
  if (!Number.isFinite(age) || age < 0 || age >= STREETEASY_EXPORT_MAX_AGE) {
    throw new Error('StreetEasy export must have an observation time less than 12 hours old.');
  }
  if (
    body.schema !== STREETEASY_EXPORT_FORMAT ||
    body.scope !== 'all-markets' ||
    body.complete !== true ||
    body.next != null ||
    body.limited === true ||
    body.partial === true ||
    typeof body.total !== 'number' ||
    !Number.isSafeInteger(body.total) ||
    body.total < 0 ||
    body.total > MAX_ROWS ||
    !Array.isArray(rows) ||
    rows.length !== body.total
  ) {
    throw new Error('StreetEasy export did not contain a complete, count-verified inventory.');
  }
  const checkedAt = new Date(generatedAt).toISOString();
  const ids = new Set<string>();
  const source = { ...STREETEASY_LIVE, id: STREETEASY_LIVE.marketplace };
  const total = body.total;
  const listings = rows.map((entry) => {
    const row = isRecord(entry) ? entry : {};
    const id = row.id;
    const url = streetEasyListingUrl(row.listingUrl);
    if (
      typeof id !== 'string' ||
      !/^\d{1,30}$/.test(id) ||
      ids.has(id) ||
      !url ||
      typeof row.listingUrl !== 'string' ||
      !row.listingUrl.startsWith('https://streeteasy.com/')
    ) {
      throw new Error('StreetEasy export returned a repeated ID or invalid original link.');
    }
    ids.add(id);
    const listing = normalizeListing({ ...row, listingUrl: url, lastSeenDate: checkedAt }, source);
    if (!listing || !STREETEASY_LIVE.regions.includes(listing.region ?? '')) {
      throw new Error('StreetEasy export contains an invalid or inactive rental.');
    }
    return listing;
  });
  return { listings, total, pages: 1, checkedAt, transport: STREETEASY_EXPORT_FORMAT };
}
