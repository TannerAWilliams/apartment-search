import { expect, test } from 'bun:test';
import { NOOKLYN_LIVE, nooklynListing, nooklynListingUrl } from '../server/sources/nooklyn.ts';

const at = '2026-11-24T00:00:00.000Z';
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 98929,
  price: 486200,
  bedrooms: 2.0,
  bathrooms: 1.0,
  neighborhood: { id: 2, name: 'Williamsburg' },
  rental: true,
  residential: true,
  address: '265 Lorimer St, Brooklyn, NY 11206, USA',
  short_address: '265 Lorimer St - Unit: 609',
  square_feet: 800,
  latitude: 40.704705,
  longitude: -73.948178,
  url: '/listings/265-lorimer-st-brooklyn-ny-11206-usa-609-williamsburg',
  ...overrides,
});
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } });
const page = (listings: unknown[], pageCount = 1) => ({
  ok: true,
  page_count: pageCount,
  total_count: listings.length * pageCount,
  listings,
});

test('Nooklyn search results become NYC listings with rents in dollars', () => {
  expect(nooklynListing(row(), at)).toMatchObject({
    id: 'nooklyn:98929',
    address: '265 Lorimer St',
    unit: '609',
    city: 'Brooklyn',
    zip: '11206',
    rent: 4862,
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 800,
    neighborhood: 'Williamsburg',
    region: 'nyc',
    sources: [{ id: 'nooklyn', url: 'https://nooklyn.com/listings/265-lorimer-st-brooklyn-ny-11206-usa-609-williamsburg' }],
  });
  // No unit, and no neighborhood.
  expect(nooklynListing(row({ short_address: '265 Lorimer St', neighborhood: null }), at)).toMatchObject({ unit: '', neighborhood: '' });
  expect(nooklynListing(row({ short_address: null }), at)?.unit).toBe('');
  // Left out: not a rental, commercial, no full address, outside NYC, an unexpected link, no id or rent, too many bedrooms.
  for (const overrides of [
    { rental: false },
    { residential: false },
    { address: '417 Suydam St' },
    { address: null },
    { address: '1 Main St, Jersey City, NJ 07302, USA' },
    { address: '1 Main St, Yonkers, NY 10701, USA' },
    { url: 'https://example.com/listings/x' },
    { id: 'x' },
    { price: null },
    { bedrooms: 5 },
  ]) {
    expect(nooklynListing(row(overrides), at)).toBeNull();
  }
  expect(nooklynListing('not a row', at)).toBeNull();
  expect(nooklynListingUrl('https://nooklyn.com/listings/abc-1?x=1')).toBe('https://nooklyn.com/listings/abc-1');
  expect(nooklynListingUrl('https://nooklyn.com/buildings/abc')).toBeNull();
});

test('Nooklyn search is read one page at a time until its last page', async () => {
  const bodies: unknown[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://nooklyn.com/api/v3/web/listings.search');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as { page: number };
    bodies.push(body);
    return json(page(body.page === 1 ? [row(), row(), row({ rental: false, id: 2 })] : [row({ id: 3, url: '/listings/x-3' })], 2));
  };
  const result = await NOOKLYN_LIVE.load(fetcher, new Date(at));
  expect(bodies).toEqual([
    { page: 1, per_page: 100, order: 'newest' },
    { page: 2, per_page: 100, order: 'newest' },
  ]);
  expect(result).toMatchObject({ pages: 2, total: 6, rawCount: 4, checkedAt: at });
  expect(result.listings.map(({ id }) => id)).toEqual(['nooklyn:98929', 'nooklyn:3']);
  // An empty search still counts as one page read.
  expect((await NOOKLYN_LIVE.load(async () => json(page([], 0)), new Date(at))).pages).toBe(1);
});

test('Nooklyn refuses challenges, errors, unexpected answers and oversized searches', async () => {
  const load = (response: Response) => NOOKLYN_LIVE.load(async () => response, new Date(at));
  await expect(load(new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }))).rejects.toMatchObject({
    code: 'bot_challenge',
  });
  await expect(load(new Response('', { status: 429 }))).rejects.toThrow('HTTP 429');
  await expect(load(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow(/recognizable/);
  await expect(load(json({ ok: false }))).rejects.toThrow(/recognizable/);
  await expect(load(json({ ...page([]), listings: Array(101).fill(row()) }))).rejects.toThrow(/recognizable/);
  await expect(load(json(page([row()], 26)))).rejects.toThrow(/more rentals/);
});
