import { expect, test } from 'bun:test';
import { APARTMENTGUIDE_LIVE, parseApartmentGuidePage } from '../server/sources/apartmentguide.ts';
import { CRAWLER_USER_AGENT, fetchPublicHtml } from '../server/sources/public-rentals.ts';

const at = '2026-11-24T00:00:00.000Z';
const inDays = (days: number) => new Date(Date.parse(at) + days * 86_400_000).toISOString();
const page = (listings: unknown[]) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { pageData: { location: { listingSearch: { total: listings.length, listings } } } } },
  })}</script></html>`;
const building = (overrides: Record<string, unknown> = {}) => ({
  id: '5911073',
  address: '1065 2nd Ave',
  urlPathname: '/a/Aalto57-New-York-NY-5911073/',
  offMarket: false,
  location: { lat: 40.76, lng: -73.96, stateAbbr: 'NY', zip: '10022' },
  floorPlans: [
    // Studios: the cheaper of two available plans, read from unit rents and the price range.
    { bedCount: 0, bathCount: 1, availabilityStatusCode: 'AVAILABLE_WITH_COUNT', units: [{ rent: '$3,993' }] },
    {
      bedCount: 0,
      bathCount: 1,
      availabilityStatusCode: 'AVAILABLE_WITHOUT_COUNT',
      priceRange: { min: 3811 },
      sqFtRange: { min: 450 },
      units: [],
    },
    // One bedroom opening within 60 days, with a placeholder size.
    {
      bedCount: 1,
      bathCount: 1,
      availabilityStatusCode: 'UNAVAILABLE_WITH_FUTURE_MOVE_DATE',
      availableDate: inDays(30),
      sqFtRange: { min: 10 },
      units: [{ rent: '$4,528' }],
    },
    // Left out: too far off, no move date, no rent, five bedrooms, and a malformed plan.
    { bedCount: 2, availabilityStatusCode: 'UNAVAILABLE_WITH_FUTURE_MOVE_DATE', availableDate: inDays(90), units: [{ rent: '$6,000' }] },
    { bedCount: 3, availabilityStatusCode: 'UNAVAILABLE_WITHOUT_FUTURE_MOVE_DATE', units: [{ rent: '$7,000' }] },
    { bedCount: 2, availabilityStatusCode: 'AVAILABLE_WITHOUT_COUNT', priceRange: { min: null }, units: [{ rent: 'Call' }, 'x'] },
    { bedCount: 5, availabilityStatusCode: 'AVAILABLE_WITH_COUNT', units: [{ rent: '$9,000' }] },
    { bedCount: '1', availabilityStatusCode: 'AVAILABLE_WITH_COUNT', units: [{ rent: '$1,000' }] },
    { availabilityStatusCode: 7 },
  ],
  ...overrides,
});

test('Apartment Guide gives one listing per building and bedroom count at its lowest available rent', () => {
  const listings = parseApartmentGuidePage(
    page([
      building(),
      // A single rental with its unit in the address.
      building({
        id: 'LV1231181417',
        address: '514 E 188th St unit 2',
        urlPathname: '/rent/514-E-188th-St-Bronx-NY-LV1231181417/',
        location: { lat: 40.85, lng: -73.89, stateAbbr: 'NY', zip: '10458' },
        floorPlans: [{ bedCount: 2, bathCount: 1, availabilityStatusCode: 'AVAILABLE_WITH_COUNT', units: [{ rent: '$2,400' }] }],
      }),
      // Left out: off the market, outside New York, outside the five boroughs, an unexpected link, no address,
      // no floor plans.
      building({ offMarket: true }),
      building({ location: { stateAbbr: 'NJ', zip: '07302' } }),
      building({ location: { stateAbbr: 'NY', zip: '10701' } }),
      building({ urlPathname: '/somewhere/else/' }),
      building({ address: null }),
      building({ id: 'none', floorPlans: null }),
      'not a building',
    ]),
    null,
    at,
  );
  expect(listings.map(({ id, bedrooms, rent, unit, city }) => ({ id, bedrooms, rent, unit, city }))).toEqual([
    { id: 'apartmentguide:5911073-0', bedrooms: 0, rent: 3811, unit: '', city: 'Manhattan' },
    { id: 'apartmentguide:5911073-1', bedrooms: 1, rent: 4528, unit: '', city: 'Manhattan' },
    { id: 'apartmentguide:LV1231181417-2', bedrooms: 2, rent: 2400, unit: '2', city: 'Bronx' },
  ]);
  expect(listings[0]).toMatchObject({ bathrooms: 1, squareFeet: 450, latitude: 40.76, region: 'nyc' });
  expect(listings[1]?.squareFeet).toBeNull();
  expect(listings[0]?.sources[0]?.url).toBe('https://www.apartmentguide.com/a/Aalto57-New-York-NY-5911073/');
  expect(() => parseApartmentGuidePage('<html></html>', null, at)).toThrow(/recognized rental page/);
  expect(() => parseApartmentGuidePage(page([]).replace('"listings":[]', '"listings":null'), null, at)).toThrow(/recognized/);
});

test('Apartment Guide is read one page at a time as the app, and a rate limit or challenge stops it', async () => {
  const requested: { url: string; agent: string | null }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requested.push({ url, agent: new Headers(init?.headers).get('User-Agent') });
    return requested.length === 1
      ? new Response(page([building()]), { headers: { 'content-type': 'text/html' } })
      : new Response(null, { status: 302, headers: { location: 'https://ratelimited.apartmentguide.com/' } });
  };
  const result = await APARTMENTGUIDE_LIVE.load(fetcher, new Date(at));
  expect(result.listings).toHaveLength(2);
  expect(requested.map(({ url }) => url)).toEqual([
    'https://www.apartmentguide.com/apartments/New-York/New-York/',
    'https://www.apartmentguide.com/apartments/New-York/New-York/page-2/',
  ]);
  expect(requested.every(({ agent }) => agent === CRAWLER_USER_AGENT)).toBe(true);
  expect(CRAWLER_USER_AGENT).toMatch(/compatible; apartment-search/);
  // Other sources send no user agent of their own.
  let agent: string | null = 'unset';
  await fetchPublicHtml(
    async (_url, init) => {
      agent = new Headers(init?.headers).get('User-Agent');
      return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    },
    'https://example.test/',
    'Example',
  );
  expect(agent).toBeNull();
}, 20_000);
