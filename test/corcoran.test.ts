import { expect, test } from 'bun:test';
import { CORCORAN_LIVE, parseCorcoranSearch } from '../server/sources/corcoran.ts';
import { CRAWLER_USER_AGENT } from '../server/sources/public-rentals.ts';

const at = '2026-11-24T00:00:00.000Z';
const card = (overrides: Record<string, unknown> = {}) => ({
  listingId: '112239821',
  listingStatus: 'Active',
  transactionType: 'For Rent',
  propertyType: 'Residential',
  isBuilding: false,
  isAddressHidden: false,
  isPriceHidden: false,
  price: 3995,
  address1: '69-65 Yellowstone Boulevard',
  address2: '506',
  state: 'NY',
  zipCode: '11375',
  bedrooms: 1,
  bathrooms: 1,
  squareFeetInterior: 700,
  location: { latitude: 40.72247, longitude: -73.84827 },
  ...overrides,
});
const page = (cards: unknown[], links: string[]) =>
  `<html>${links.map((path) => `<a href="${path}">x</a>`).join('')}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { initialItems: cards } },
  })}</script></html>`;
const link = (id: string, vow = true) => `/listing/for-rent/some-address-queens-ny-11375/${vow ? 'vow/' : ''}${id}/regionId/1`;

test('Corcoran keeps active NYC apartment rentals from its search cards, with their listing links', () => {
  const listings = parseCorcoranSearch(
    page(
      [
        card(),
        // A studio: no bedroom count, but baths.
        card({ listingId: 24070478, bedrooms: null, propertyType: null, address2: null, zipCode: '10022', location: null }),
        // Left out: no link, not active, a sale, commercial, a building card, hidden address or price, outside NYC
        // or New York, no address, and no bedrooms or baths.
        card({ listingId: '999' }),
        card({ listingId: null }),
        card({ listingId: '2', listingStatus: 'Contract Signed' }),
        card({ listingId: '3', transactionType: 'For Sale' }),
        card({ listingId: '4', propertyType: 'Commercial' }),
        card({ listingId: '5', isBuilding: true }),
        card({ listingId: '6', isAddressHidden: true }),
        card({ listingId: '7', isPriceHidden: true }),
        card({ listingId: '8', zipCode: '10591' }),
        card({ listingId: '9', state: 'NJ' }),
        card({ listingId: '10', address1: null }),
        card({ listingId: '11', bedrooms: null, bathrooms: null }),
        card({ listingId: '12', zipCode: null, bedrooms: null, bathrooms: 0 }),
        'not a card',
      ],
      [
        link('112239821'),
        link('24070478', false),
        ...['2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map((id) => link(id)),
        '/listing/for-rent/elsewhere',
      ],
    ),
    null,
    at,
  );
  expect(listings.map(({ id, address, unit, city, bedrooms, rent }) => ({ id, address, unit, city, bedrooms, rent }))).toEqual([
    { id: 'corcoran:112239821', address: '69-65 Yellowstone Boulevard', unit: '506', city: 'Queens', bedrooms: 1, rent: 3995 },
    { id: 'corcoran:24070478', address: '69-65 Yellowstone Boulevard', unit: '', city: 'Manhattan', bedrooms: 0, rent: 3995 },
  ]);
  expect(listings[0]).toMatchObject({ bathrooms: 1, squareFeet: 700, latitude: 40.72247, region: 'nyc' });
  expect(listings[0]?.sources[0]?.url).toBe(`https://www.corcoran.com${link('112239821')}`);
  expect(listings[1]?.sources[0]?.url).toBe(`https://www.corcoran.com${link('24070478', false)}`);
  expect(() => parseCorcoranSearch('<html></html>', null, at)).toThrow(/recognized rental search page/);
  expect(() => parseCorcoranSearch(page([], []).replace('"initialItems":[]', '"initialItems":null'), null, at)).toThrow(/recognized/);
});

test('Corcoran reads its NYC search newest first, one page at a time as the app, and stops at a rate limit', async () => {
  const requested: { url: string; agent: string | null }[] = [];
  const result = await CORCORAN_LIVE.load(async (url, init) => {
    requested.push({ url, agent: new Headers(init?.headers).get('User-Agent') });
    return requested.length === 1
      ? new Response(page([card()], [link('112239821')]), { headers: { 'content-type': 'text/html' } })
      : new Response('slow down', { status: 429 });
  }, new Date(at));
  expect(result).toMatchObject({ pages: 1, partial: true, requestedPages: 30, failedPages: 29 });
  expect(result.listings).toHaveLength(1);
  expect(requested.map(({ url }) => url)).toEqual([
    'https://www.corcoran.com/search/for-rent/regionId/1?sortBy=listedDate%2Bdesc&page=1',
    'https://www.corcoran.com/search/for-rent/regionId/1?sortBy=listedDate%2Bdesc&page=2',
  ]);
  expect(requested.every(({ agent }) => agent === CRAWLER_USER_AGENT)).toBe(true);
  expect(CORCORAN_LIVE).toMatchObject({ id: 'corcoran-live', marketplace: 'corcoran', minPages: 30, maxPages: 30 });
  expect(CORCORAN_LIVE.listingUrl('https://www.corcoran.com/search/for-rent')).toBeNull();
}, 10_000);
