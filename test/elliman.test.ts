import { expect, test } from 'bun:test';
import { ELLIMAN_LIVE, parseEllimanSearch } from '../server/sources/elliman.ts';
import { CRAWLER_USER_AGENT } from '../server/sources/public-rentals.ts';

const at = '2026-11-24T00:00:00.000Z';
const listing = (overrides: Record<string, unknown> = {}, address: Record<string, unknown> = {}) => ({
  coreListingId: 35643754,
  isPrivate: false,
  listingType: 'Rental',
  listingStatus: 'Active',
  homeType: 'Condo',
  listPrice: 10000,
  rentalPrices: [],
  bedroomsTotal: 2,
  bathroomsFull: 2,
  bathroomsHalf: 1,
  livingAreaSquareFeet: 1272,
  latLng: { lat: 40.69, lng: -73.98 },
  address: { isRestricted: false, stateOrProvince: 'NY', samlsFullAddress: '11 HOYT ST 40J, Brooklyn, NY 11201', ...address },
  ...overrides,
});
const href = (id: number) => `/listing/some-address-brooklyn-ny-11201/${id}`;
/** A search page: its server components data in two pushes (the first copy of the search is empty), and the cards. */
const page = (listings: unknown[], ids: number[]) => {
  const data = `0:{"search":{"initialListingsData":{"listings":[],"totalCount":0}}}\n1:{"initialListingsData":${JSON.stringify({ totalCount: 99, listings })},"initialCurrency":"USD"}`;
  const half = Math.floor(data.length / 2);
  const push = (text: string) => `<script>self.__next_f.push([1,${JSON.stringify(text)}])</script>`;
  return `<html>${ids.map((id) => `<a href="${href(id)}">card</a>`).join('')}<a href="/listing/elsewhere">x</a>${push(data.slice(0, half))}${push(data.slice(half))}</html>`;
};

test('Douglas Elliman keeps active NYC apartment rentals from the search page data, with their listing links', () => {
  const rows = [
    listing(),
    // Monthly rate given; the structured address; a neighborhood and a unit after the street.
    listing(
      { coreListingId: 2, rentalPrices: [{ name: 'Monthly', value: 9500 }], bathroomsHalf: null, latLng: null },
      {
        streetNumber: '89',
        streetName: 'DEKALB Ave',
        unitNumber: '28G',
        postalCode: '11201',
      },
    ),
    listing(
      { coreListingId: 3, bathroomsFull: null, homeType: null },
      { samlsFullAddress: '670 92nd Street, Bay Rdg, Brooklyn, NY 11228' },
    ),
    listing({ coreListingId: 4 }, { samlsFullAddress: '260 Broadway, #4, Brooklyn, NY 11211-1234' }),
    // Left out: no link, not a number id, private, restricted or out-of-state addresses, outside NYC, an address that
    // does not parse, a sale, not active, a shop, a shop by its address, weekly rates only, and no address.
    listing({ coreListingId: 999 }),
    listing({ coreListingId: '5' }),
    listing({ coreListingId: 6, isPrivate: true }),
    listing({ coreListingId: 7 }, { isRestricted: true }),
    listing({ coreListingId: 8 }, { stateOrProvince: 'NJ' }),
    listing({ coreListingId: 9 }, { samlsFullAddress: '1 Main St, Southampton, NY 11968' }),
    listing({ coreListingId: 10 }, { samlsFullAddress: 'Somewhere in Brooklyn' }),
    listing({ coreListingId: 11 }, { samlsFullAddress: null }),
    listing({ coreListingId: 12, listingType: 'Sale' }),
    listing({ coreListingId: 13, listingStatus: 'Pending' }),
    listing({ coreListingId: 14, homeType: 'CommercialOffice' }),
    listing({ coreListingId: 15 }, { samlsFullAddress: '100A 7TH Ave RETAIL, Brooklyn, NY 11215' }),
    listing({ coreListingId: 16, rentalPrices: [{ name: 'Weekly', value: 900 }, 'x'] }),
    listing({ coreListingId: 17, address: null }),
    'not a listing',
  ];
  const listings = parseEllimanSearch(page(rows, [35643754, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]), null, at);
  expect(listings.map(({ id, address, unit, city, zip, rent, bathrooms }) => ({ id, address, unit, city, zip, rent, bathrooms }))).toEqual([
    { id: 'elliman:35643754', address: '11 HOYT ST', unit: '40J', city: 'Brooklyn', zip: '11201', rent: 10000, bathrooms: 2.5 },
    { id: 'elliman:2', address: '89 DEKALB Ave', unit: '28G', city: 'Brooklyn', zip: '11201', rent: 9500, bathrooms: 2 },
    { id: 'elliman:3', address: '670 92nd Street', unit: '', city: 'Brooklyn', zip: '11228', rent: 10000, bathrooms: null },
    { id: 'elliman:4', address: '260 Broadway', unit: '4', city: 'Brooklyn', zip: '11211', rent: 10000, bathrooms: 2.5 },
  ]);
  expect(listings[0]).toMatchObject({ bedrooms: 2, squareFeet: 1272, latitude: 40.69, region: 'nyc' });
  expect(listings[0]?.sources[0]?.url).toBe(`https://www.elliman.com${href(35643754)}`);
  expect(parseEllimanSearch(page([], []), null, at)).toEqual([]);
  expect(() => parseEllimanSearch('<html></html>', null, at)).toThrow(/recognized rental search page/);
});

test('Douglas Elliman reads each place’s first search page one at a time as the app, and stops at a challenge', async () => {
  const requested: { url: string; agent: string | null }[] = [];
  const result = await ELLIMAN_LIVE.load(async (url, init) => {
    requested.push({ url, agent: new Headers(init?.headers).get('User-Agent') });
    return requested.length === 1
      ? new Response(page([listing()], [35643754]), { headers: { 'content-type': 'text/html' } })
      : new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  }, new Date(at));
  expect(result).toMatchObject({ pages: 1, partial: true, requestedPages: 35, failedPages: 34 });
  expect(requested.map(({ url }) => url)).toEqual([
    'https://www.elliman.com/rentals/new-york-ny',
    'https://www.elliman.com/rentals/brooklyn-ny',
  ]);
  expect(requested.every(({ agent }) => agent === CRAWLER_USER_AGENT)).toBe(true);
  expect(ELLIMAN_LIVE).toMatchObject({ id: 'elliman-live', marketplace: 'elliman', minPages: 35, maxPages: 35, rowsPerPage: 18 });
  expect(ELLIMAN_LIVE.listingUrl('https://www.elliman.com/rentals/new-york-ny')).toBeNull();
}, 10_000);
