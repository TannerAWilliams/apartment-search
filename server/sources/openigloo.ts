import type { FetchTransport } from '../../src/fetch-type.ts';
import { isRecord, type ListingData } from '../../src/domain.ts';
import { normalizeListing } from '../../src/listings.ts';
import { marketplaceIdForUrl } from '../../src/marketplaces.ts';
import { boroughKey, boroughLabel } from '../../src/regions.ts';
import { geocodeRentalAddresses } from './geocode-rentals.ts';

export const OPENIGLOO = { id: 'openigloo', name: 'Openigloo', kind: 'feed' };
export const OPENIGLOO_TRANSPORT = 'complete-openigloo-search';
export const OPENIGLOO_COVERAGE = 'All active NYC rentals returned by Openigloo’s public search';
/** Upper bound on saved listings; Openigloo reported about 5,800 in November 2026. */
export const OPENIGLOO_MAX_LISTINGS = 20_000;
/** A complete sync may miss listings added or removed while it runs, but no more than this share. */
export const OPENIGLOO_MIN_COVERAGE = 0.97;

const ENDPOINT = 'https://mcp.openigloo.com/mcp';
const PROTOCOL = '2025-11-25';
const PAGE_SIZE = 10; // the search tool's maximum; it has no paging
const MAX_CALLS = 3000;
// Searches with max_rent of $50,000 or more time out upstream, so the top range has no maximum.
const TOP_RANGE_START = 25_000;
const CONCURRENCY = 1;
/** Openigloo rate-limits bursts (HTTP 429 at two requests in flight), so requests are spaced out. Tests set 0. */
export const openiglooPacing = { intervalMs: 1000 };
const RATE_LIMIT_WAIT_MS = 60_000;
const RATE_LIMIT_RETRIES = 3;
const RETRY_DELAYS = [15_000, 30_000, 60_000]; // after "try again in a minute" responses
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const BEDROOMS = [0, 1, 2, 3, 4]; // 4 = four or more

type Row = {
  id?: string;
  address?: string;
  borough?: string;
  neighborhood?: string;
  status?: string;
  url?: string;
  bedrooms?: number;
  bathrooms?: number;
  rent_per_month?: number;
  no_fee?: boolean;
};
/** max: null means no upper bound. area is a borough, or a neighborhood within `borough`. */
type Search = { borough: string; area: string; bedrooms: number; min: number; max: number | null };
export type OpeniglooRow = Row & { search: Search };
type Page = { total: number; rows: Row[] };
/** A JSON-RPC reply from the Openigloo MCP server, and the result of its search tool. */
type RpcMessage = { id?: unknown; error?: unknown; result?: unknown };
type ToolResult = {
  isError?: unknown;
  content?: { text?: unknown }[];
  structuredContent?: { total_matches?: unknown; apartments?: unknown };
};
type OpeniglooSearch = (search: Search) => Promise<Page>;

/** Opens an MCP session with Openigloo's public server and returns its search tool. */
export async function openiglooSearch(
  fetcher: FetchTransport,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<OpeniglooSearch> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  let nextId = 1;
  let lastRequest = 0;
  async function send(body: string) {
    for (let attempt = 0; ; attempt++) {
      const gap = lastRequest + openiglooPacing.intervalMs - Date.now();
      if (gap > 0) await wait(gap);
      lastRequest = Date.now();
      const response = await fetcher(ENDPOINT, {
        method: 'POST',
        headers: { ...headers },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
      });
      if (response.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return response;
      await response.body?.cancel();
      const retryAfter = Number(response.headers.get('Retry-After'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5 * 60_000) : RATE_LIMIT_WAIT_MS);
    }
  }
  async function request(method: string, params?: object, notification = false) {
    const id = notification ? undefined : nextId++;
    const response = await send(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(id ? { id } : {}) }));
    if (!response.ok) throw Object.assign(new Error('Openigloo returned HTTP ' + response.status + '.'), { httpStatus: response.status });
    const session = response.headers.get('Mcp-Session-Id');
    if (session) headers['Mcp-Session-Id'] = session;
    if (notification || response.status === 202 || response.status === 204) {
      await response.body?.cancel();
      return null;
    }
    const data = await response.text();
    const message = (
      response.headers.get('Content-Type')?.includes('text/event-stream')
        ? data
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data: '))
            .map((line) => JSON.parse(line.slice(6)) as RpcMessage | null)
            .find((event) => event?.id === id)
        : JSON.parse(data)
    ) as RpcMessage | null | undefined;
    if (!message || message.error || message.id !== id) throw new Error('The Openigloo request failed.');
    return message.result;
  }
  const handshake = await request('initialize', {
    protocolVersion: PROTOCOL,
    capabilities: {},
    clientInfo: { name: 'Apartment Search', version: '1.0' },
  });
  if ((handshake as { protocolVersion?: unknown } | null)?.protocolVersion !== PROTOCOL) throw new Error('The Openigloo protocol changed.');
  headers['MCP-Protocol-Version'] = PROTOCOL;
  await request('notifications/initialized', undefined, true);
  return async ({ area, bedrooms, min, max }) => {
    const rent = { ...(min > 0 ? { min_rent: min } : {}), ...(max !== null ? { max_rent: max } : {}) };
    let result: ToolResult | null;
    for (let attempt = 0; ; attempt++) {
      result = (await request('tools/call', {
        name: 'search_apartments',
        arguments: {
          area,
          bedrooms: [bedrooms],
          ...rent,
          limit: PAGE_SIZE,
        },
      })) as ToolResult | null;
      const busy = result?.isError && /try again/i.test(String(result?.content?.[0]?.text ?? ''));
      if (!busy || attempt >= RETRY_DELAYS.length) break;
      await wait(RETRY_DELAYS[attempt]);
    }
    const content = result?.structuredContent;
    if (
      result?.isError ||
      typeof content?.total_matches !== 'number' ||
      !Number.isSafeInteger(content.total_matches) ||
      content.total_matches < 0 ||
      !Array.isArray(content?.apartments) ||
      content.apartments.length > PAGE_SIZE
    ) {
      throw new Error(
        'Openigloo did not return listing results' +
          (result?.isError ? ': ' + String(result?.content?.[0]?.text ?? '').slice(0, 160) : '.'),
      );
    }
    // With no matches the tool suggests unrelated alternatives; they are not results.
    // Rows have the tool's documented fields; each one is checked before it is saved.
    return {
      total: content.total_matches,
      rows: content.total_matches > 0 ? content.apartments.map((row) => (isRecord(row) ? (row as Row) : {})) : [],
    };
  };
}

function limiter(size: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(work: () => Promise<T>) => {
    if (active >= size) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * Collects every listing. Each borough and bedroom count is split into rent ranges until a
 * range has at most one page of results. Listings that share one exact price are split by
 * neighborhood. The tool filters on a price that can differ from the rent it displays, so
 * displayed rents only guide where to split.
 */
/** One starting search per borough and bedroom count; a complete sync crawls all of them. */
export const OPENIGLOO_CELLS: Search[] = BOROUGHS.flatMap((borough) =>
  BEDROOMS.map((bedrooms) => ({ borough, area: borough, bedrooms, min: 0, max: null })),
);

export async function crawlOpenigloo(search: OpeniglooSearch, cells = OPENIGLOO_CELLS) {
  let calls = 0;
  let unresolved = 0;
  const limit = limiter(CONCURRENCY);
  const query = (q: Search) =>
    limit(async () => {
      if (++calls > MAX_CALLS) throw new Error('Openigloo inventory exceeds the sync request limit.');
      return search(q);
    });
  const rows = new Map<string, OpeniglooRow>();
  const neighborhoods = new Map<string, Set<string>>();
  const keep = (q: Search, page: Page) => {
    for (const row of page.rows) {
      if (typeof row?.id !== 'string') continue;
      if (!rows.has(row.id)) rows.set(row.id, { ...compact(row), search: q });
      if (typeof row.neighborhood === 'string' && row.neighborhood) {
        const names = neighborhoods.get(q.borough) ?? new Set();
        neighborhoods.set(q.borough, names.add(row.neighborhood));
      }
    }
  };
  async function byNeighborhood(q: Search, page: Page) {
    const names = [...(neighborhoods.get(q.borough) ?? [])];
    const found = await Promise.all(
      names.map(async (area) => {
        const child = { ...q, area };
        const result = await query(child);
        keep(child, result);
        if (result.total > PAGE_SIZE) unresolved += result.total - result.rows.length;
        return result.total;
      }),
    );
    unresolved += Math.max(0, page.total - found.reduce((sum, value) => sum + value, 0));
  }
  async function collect(q: Search, page: Page): Promise<void> {
    keep(q, page);
    if (page.total <= PAGE_SIZE) return;
    if (q.max === null && q.min < TOP_RANGE_START) {
      const ranges = [
        { ...q, max: TOP_RANGE_START - 1 },
        { ...q, min: TOP_RANGE_START },
      ];
      await Promise.all(ranges.map(async (child) => collect(child, await query(child))));
      return;
    }
    const upper = q.max ?? q.min * 2;
    if (q.min >= upper) {
      if (q.area === q.borough) await byNeighborhood(q, page);
      else unresolved += page.total - page.rows.length;
      return;
    }
    const prices = page.rows
      .map((row) => row.rent_per_month)
      .filter((rent): rent is number => Number.isSafeInteger(rent) && rent! > q.min && rent! < upper)
      .sort((a, b) => a - b);
    const split = prices.length ? prices[Math.floor(prices.length / 2)] - 1 : Math.floor((q.min + upper) / 2);
    const ranges = [
      { ...q, max: split },
      { ...q, min: split + 1 },
    ];
    await Promise.all(ranges.map(async (child) => collect(child, await query(child))));
  }
  const totals = await Promise.all(
    cells.map(async (cell) => {
      const page = await query(cell);
      await collect(cell, page);
      return page.total;
    }),
  );
  return { rows: [...rows.values()], total: totals.reduce((sum, value) => sum + value, 0), calls, unresolved };
}

/** Only the fields a listing needs, so partial crawls stay small in storage. */
function compact({ id, address, borough, neighborhood, status, url, bedrooms, bathrooms, rent_per_month }: Row): Row {
  return { id, address, borough, neighborhood, status, url, bedrooms, bathrooms, rent_per_month };
}

const ADDRESS = /^(.+?),\s*([^,]+),\s*NY\s+(\d{5})$/i;

export function openiglooListing(row: OpeniglooRow, checkedAt: string): ListingData | null {
  const parts = typeof row.address === 'string' ? row.address.trim().match(ADDRESS) : null;
  const { search } = row;
  const bedroomsMatch = search.bedrooms === 4 ? Number(row.bedrooms) >= 4 : row.bedrooms === search.bedrooms;
  if (
    !parts ||
    row.status !== 'for_rent' ||
    marketplaceIdForUrl(row.url) !== OPENIGLOO.id ||
    !row.url?.includes('/unit/nyc/') ||
    !boroughKey(row.borough ?? '') ||
    boroughKey(row.borough ?? '') !== boroughKey(search.borough) ||
    !/^1\d{4}$/.test(parts[3]) ||
    !bedroomsMatch ||
    !Number.isFinite(row.rent_per_month) ||
    row.rent_per_month! <= 0
  )
    return null;
  const street = parts[1].replace(/\s+/g, ' ').trim();
  const [, address, unit = ''] = street.match(/^(.*?)\s+(?:#|apt\.?\s+|unit\s+)\s*([\w-]+)$/i) ?? [, street];
  const url = new URL(row.url!);
  url.search = '';
  return normalizeListing(
    {
      id: row.id,
      address,
      unit,
      city: boroughLabel(search.borough),
      state: 'NY',
      zipCode: parts[3],
      region: 'nyc',
      neighborhood: row.neighborhood,
      bedrooms: Math.min(Number(row.bedrooms), 4),
      bathrooms: row.bathrooms,
      rent: row.rent_per_month,
      url: url.href,
      status: 'Active',
      updatedAt: checkedAt,
    },
    OPENIGLOO,
  );
}

/** Geocodes each building once, in batches small enough for the Census batch geocoder. */
async function geocodeBuildings(listings: ListingData[], fetcher: FetchTransport) {
  const buildings = new Map<string, ListingData>();
  for (const listing of listings) {
    const key = [listing.address, listing.zip].join('|').toLowerCase();
    if (!buildings.has(key)) buildings.set(key, { ...listing, id: String(buildings.size) });
  }
  const unique = [...buildings.values()];
  const points = new Map<string, { latitude?: number; longitude?: number }>();
  const batch = limiter(2);
  await Promise.all(
    Array.from({ length: Math.ceil(unique.length / 500) }, (_, index) =>
      batch(async () => {
        const chunk = unique.slice(index * 500, (index + 1) * 500);
        const located = await geocodeRentalAddresses(chunk, fetcher, 60000).catch(() => chunk);
        for (const item of located)
          if (item.latitude !== undefined) points.set(item.id, { latitude: item.latitude, longitude: item.longitude });
      }),
    ),
  );
  const keys = [...buildings.keys()];
  const byKey = new Map(keys.map((key, index) => [key, points.get(String(index))]));
  return listings.map((listing) => ({ ...listing, ...byKey.get([listing.address, listing.zip].join('|').toLowerCase()) }));
}

type OpeniglooCrawl = { rows: OpeniglooRow[]; total: number; calls: number; unresolved: number };

/** Turns a complete crawl into saved listings, refusing one that misses too much of the reported inventory. */
export async function finishOpenigloo(crawl: OpeniglooCrawl, fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const listings = crawl.rows.flatMap((row) => {
    const listing = openiglooListing(row, checkedAt);
    return listing ? [listing] : [];
  });
  if (crawl.total > OPENIGLOO_MAX_LISTINGS) throw new Error('Openigloo inventory exceeds the sync limit.');
  if (listings.length < crawl.total * OPENIGLOO_MIN_COVERAGE) {
    throw new Error(`Openigloo returned ${listings.length} usable listings of ${crawl.total} reported; the saved inventory was kept.`);
  }
  return {
    listings: await geocodeBuildings(listings, fetcher),
    total: crawl.total,
    rawCount: crawl.rows.length,
    pages: crawl.calls,
    checkedAt,
    transport: OPENIGLOO_TRANSPORT,
    unresolved: crawl.unresolved,
  };
}

export async function loadOpenigloo(fetcher: FetchTransport = fetch, now = new Date(), wait?: (ms: number) => Promise<unknown>) {
  return finishOpenigloo(await crawlOpenigloo(await openiglooSearch(fetcher, wait)), fetcher, now);
}
