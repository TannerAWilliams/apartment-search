import { expect, test } from 'bun:test';
import { luxuryPresenceListing, SERHANT_LIVE, streetAndUnit } from '../server/sources/serhant.ts';
import { CRAWLER_USER_AGENT } from '../server/sources/public-rentals.ts';

const at = '2026-11-24T00:00:00.000Z';
const site = { source: { id: 'serhant', name: 'SERHANT.', kind: 'feed' }, origin: 'https://serhant.com' };
const property = (overrides: Record<string, unknown> = {}) => ({
  id: '9c6ae980-119d-4e62-9059-d682639c7306',
  slug: '63-w-107th-street-33-manhattan-ny-us-10025-rls20127168',
  status: 'For Lease',
  priceUponRequest: false,
  leaseProperty: true,
  leasePrice: 3600,
  leasePeriod: 'MONTH',
  privateAddress: false,
  bedroomCount: 2,
  bathCount: 1,
  addressLine1: '63 W 107TH Street 33',
  addressLine2: null,
  addressState: 'NY',
  postalCode: '10025',
  livingSpaceSize: '850.0',
  livingSpaceUnits: 'SQUARE_FEET',
  latitude: 40.8,
  longitude: -73.96,
  types: [{ name: 'Condo' }],
  ...overrides,
});

test('Luxury Presence addresses give their unit from a second line, a marker or a trailing word', () => {
  expect(streetAndUnit('63 W 107TH Street 33')).toEqual({ street: '63 W 107TH Street', unit: '33' });
  expect(streetAndUnit('125 BERGEN Street APT1B')).toEqual({ street: '125 BERGEN Street', unit: '1B' });
  expect(streetAndUnit('16 W 122ND Street GARDEN')).toEqual({ street: '16 W 122ND Street', unit: 'GARDEN' });
  expect(streetAndUnit('623 Ave H 6C')).toEqual({ street: '623 Ave H', unit: '6C' });
  expect(streetAndUnit('1345 Amsterdam Avenue, #2b')).toEqual({ street: '1345 Amsterdam Avenue', unit: '2B' });
  expect(streetAndUnit('155 N Crescent Dr Unit: PH')).toEqual({ street: '155 N Crescent Dr', unit: 'PH' });
  expect(streetAndUnit('99 Battery Place', 'Unit: 5K')).toEqual({ street: '99 Battery Place', unit: '5K' });
  expect(streetAndUnit('192 First Avenue ', '#4')).toEqual({ street: '192 First Avenue', unit: '4' });
  expect(streetAndUnit('230 Central Park South', 'Apartment 10C')).toEqual({ street: '230 Central Park South', unit: '10C' });
  // Left as they are: no unit, a street that ends in a word, and second lines that are not units.
  expect(streetAndUnit('406 15th St')).toEqual({ street: '406 15th St', unit: '' });
  expect(streetAndUnit('88 West Broadway', 'Brooklyn')).toEqual({ street: '88 West Broadway', unit: '' });
  expect(streetAndUnit('80 White Street,', '3rd and 4th floors')).toEqual({ street: '80 White Street', unit: '' });
});

test('Luxury Presence keeps available monthly NYC apartments with a published address', () => {
  const listing = luxuryPresenceListing(site, property(), at);
  expect(listing).toMatchObject({
    id: 'serhant:9c6ae980-119d-4e62-9059-d682639c7306',
    address: '63 W 107TH Street',
    unit: '33',
    city: 'Manhattan',
    zip: '10025',
    rent: 3600,
    bedrooms: 2,
    bathrooms: 1,
    squareFeet: 850,
    region: 'nyc',
  });
  expect(listing?.sources[0]?.url).toBe('https://serhant.com/properties/63-w-107th-street-33-manhattan-ny-us-10025-rls20127168');
  // Sizes as numbers are read; placeholder sizes, other units and missing baths are left out.
  expect(luxuryPresenceListing(site, property({ livingSpaceSize: 700, status: ' active ' }), at)?.squareFeet).toBe(700);
  expect(luxuryPresenceListing(site, property({ livingSpaceSize: '100.0', bathCount: 0 }), at)).toMatchObject({
    squareFeet: null,
    bathrooms: null,
  });
  expect(
    luxuryPresenceListing(site, property({ livingSpaceSize: null, livingSpaceUnits: 'SQUARE_METERS', types: null }), at)?.squareFeet,
  ).toBeNull();
  for (const overrides of [
    { slug: null },
    { slug: 'has/slash' },
    { postalCode: '11968' },
    { postalCode: null },
    { id: 7 },
    { status: 'Leased' },
    { status: null },
    { leaseProperty: false },
    { leasePeriod: 'WEEK' },
    { priceUponRequest: true },
    { privateAddress: true },
    { addressState: 'NJ' },
    { addressLine1: null },
    { types: [{ name: 'Co-Op' }, { name: 'Commercial' }] },
    { types: ['x'], bedroomCount: 5 },
  ])
    expect(luxuryPresenceListing(site, property(overrides), at), JSON.stringify(overrides)).toBeNull();
  expect(luxuryPresenceListing(site, 'not a property', at)).toBeNull();
});

type Body = { variables: { offset: number; propertyTypeIds?: string[]; addressState: string[] } };

test('SERHANT. reads its New York rentals page by page from the site’s own feed, as the app', async () => {
  const requests: { url: string; body: Body; agent: string | null; method?: string }[] = [];
  const rows = Array.from({ length: 130 }, (_, index) =>
    property({ id: `id-${index}`, slug: `unit-${index}`, addressLine1: `63 W 107TH Street ${index + 1}A` }),
  );
  const fetcher = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    requests.push({ url, body, agent: new Headers(init?.headers).get('User-Agent'), method: init?.method });
    const { offset } = body.variables;
    return Response.json({ data: { propertiesCount: { count: rows.length }, properties: rows.slice(offset, offset + 100) } });
  };
  const result = await SERHANT_LIVE.load(fetcher, new Date(at));
  expect(result).toMatchObject({ pages: 2 });
  expect(result.partial).toBeUndefined();
  expect(result.listings).toHaveLength(130);
  expect(requests.map(({ body }) => body.variables.offset)).toEqual([0, 100]);
  expect(
    requests.every(
      ({ url, method, agent }) => url === 'https://serhant.com/api-gw/graphql' && method === 'POST' && agent === CRAWLER_USER_AGENT,
    ),
  ).toBe(true);
  expect(requests[0]?.body.variables).toMatchObject({ addressState: ['NY'] });
  expect(requests[0]?.body.variables.propertyTypeIds).toHaveLength(6);
  expect(SERHANT_LIVE).toMatchObject({ id: 'serhant-live', marketplace: 'serhant', regions: ['nyc'], minPages: 1, maxPages: 5 });
  expect(SERHANT_LIVE.listingUrl('https://serhant.com/properties/81-wooster-st')).toBe('https://serhant.com/properties/81-wooster-st');
  expect(SERHANT_LIVE.listingUrl('https://serhant.com/home-search/listings/1')).toBeNull();
}, 10_000);

test('SERHANT. keeps the pages read when a later page fails, and stops on a challenge or a bad answer', async () => {
  let calls = 0;
  const partial = await SERHANT_LIVE.load(async () => {
    calls++;
    return calls === 1
      ? Response.json({ data: { propertiesCount: { count: 250 }, properties: [property()] } })
      : new Response('down', { status: 503 });
  }, new Date(at));
  expect(partial).toMatchObject({ pages: 1, partial: true, requestedPages: 3, failedPages: 2 });
  expect(partial.listings).toHaveLength(1);

  const answer = (response: Response) => SERHANT_LIVE.load(async () => response, new Date(at));
  await expect(answer(new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } }))).rejects.toMatchObject({
    code: 'bot_challenge',
  });
  await expect(answer(new Response('', { status: 429 }))).rejects.toThrow('SERHANT. returned HTTP 429.');
  await expect(answer(Response.json({ errors: [{ message: 'nope' }] }))).rejects.toThrow(/recognized rental list/);
  await expect(answer(Response.json([]))).rejects.toThrow(/recognized rental list/);
  await expect(answer(Response.json({ data: { propertiesCount: { count: -1 }, properties: [] } }))).rejects.toThrow(/recognized/);
  await expect(answer(Response.json({ data: { propertiesCount: null, properties: [] } }))).rejects.toThrow(/recognized/);
  await expect(answer(Response.json({ data: { propertiesCount: { count: 0 }, properties: [] } }))).rejects.toThrow(
    'SERHANT. returned no supported apartment listings.',
  );
}, 10_000);
