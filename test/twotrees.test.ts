import { expect, test } from 'bun:test';
import { TWOTREES_LIVE, parseTwoTreesFeed, twoTreesListingUrl } from '../server/sources/twotrees.ts';

const at = new Date('2026-11-24T00:00:00.000Z');
const building = (street: string, city: string, zip: string) => ({
  city,
  postal_code: zip,
  street_address: street,
  neighborhood: { name: 'Fort Greene' },
  location: { latitude: 40.6864957, longitude: -73.9783208 },
});
const item = (overrides: Record<string, unknown> = {}) => ({
  id: 654243,
  status: 'Available',
  listing_type: 'For Rent',
  property_type: 'Residential',
  private: false,
  street_address: '300 Ashland Pl',
  unit_number: '17M',
  layout: 'Studio',
  bedrooms: 0,
  bathrooms: 1,
  square_footage: null,
  price: '3775.00',
  building: building('300 Ashland Pl', 'Brooklyn', '11217'),
  ...overrides,
});
const feed = (items: unknown[], total = items.length) => ({
  code: 'GET_SUCCESS',
  status: 'success',
  data: {
    1: { id: 1, label: 'residential', data: JSON.stringify({ total_items: total, items }) },
    2: { id: 2, label: 'commercial', data: JSON.stringify({ total_items: 0, items: [] }) },
  },
});
const respond =
  (body: unknown, init: ResponseInit = { headers: { 'content-type': 'application/json; charset=utf-8' } }) =>
  async () =>
    new Response(JSON.stringify(body), init);

test('Two Trees reads every available apartment in its own listings feed', async () => {
  const result = await TWOTREES_LIVE.load(
    respond(
      feed([
        item(),
        // Kept although Nestio marks it private: twotreesny.com shows it to everyone.
        item({
          id: 68256,
          private: true,
          street_address: '550 West 54th Street',
          unit_number: '2025',
          layout: 'Convertible w/ Flex 2 Bedroom',
          bedrooms: 2,
          square_footage: 980,
          price: '6450.00',
          building: { ...building('550 West 54th Street', 'Manhattan', '10019'), neighborhood: null, location: null },
        }),
        // Left out: an application pending, an office, a sale, no unit, outside the five boroughs, an odd unit,
        // and something that is not an item at all.
        item({ id: 2, status: 'App Pending' }),
        item({ id: 3, property_type: 'Commercial' }),
        item({ id: 4, listing_type: 'For Sale' }),
        item({ id: 5, unit_number: null }),
        item({ id: 6, building: building('1 Main St', 'Jersey City', '07302') }),
        item({ id: 7, unit_number: '17 M' }),
        item({ id: '8' }),
        item({ id: 9, building: null }),
        'x',
      ]),
    ),
    at,
  );
  expect(result).toMatchObject({ pages: 1, total: 10, rawCount: 10, transport: 'twotrees-nestio-feed', checkedAt: at.toISOString() });
  expect(
    result.listings.map((listing) => [
      listing.id,
      listing.address,
      listing.unit,
      listing.city,
      listing.zip,
      listing.bedrooms,
      listing.rent,
    ]),
  ).toEqual([
    ['twotrees:654243', '300 Ashland Pl', '17M', 'Brooklyn', '11217', 0, 3775],
    ['twotrees:68256', '550 West 54th Street', '2025', 'Manhattan', '10019', 2, 6450],
  ]);
  expect(result.listings.map((listing) => listing.sources[0].url)).toEqual([
    'https://www.twotreesny.com/apartments/300-ashland-pl/studio/17M',
    'https://www.twotreesny.com/apartments/550-west-54th/convertible-with-flex-2-bedroom/2025',
  ]);
  expect(result.listings[0]).toMatchObject({
    region: 'nyc',
    kind: 'feed',
    neighborhood: 'Fort Greene',
    latitude: 40.6864957,
    seenAt: at.toISOString(),
  });
});

test('Two Trees refuses a feed it does not recognize, an incomplete feed, or a blocked answer', async () => {
  expect(() => parseTwoTreesFeed({ data: { 1: { label: 'commercial', data: '{}' } } })).toThrow('did not return a recognized');
  expect(() => parseTwoTreesFeed(null)).toThrow('did not return a recognized');
  expect(() => parseTwoTreesFeed(feed([item()], 2))).toThrow('listed 1 of the 2');
  await expect(TWOTREES_LIVE.load(respond('x', { headers: { 'cf-mitigated': 'challenge' }, status: 403 }), at)).rejects.toThrow(
    'bot protection',
  );
  await expect(TWOTREES_LIVE.load(respond('x', { status: 429 }), at)).rejects.toThrow('HTTP 429');
  await expect(TWOTREES_LIVE.load(respond('x', { headers: { 'content-type': 'text/html' } }), at)).rejects.toThrow(
    'recognized listings feed',
  );
  await expect(
    TWOTREES_LIVE.load(async () => new Response('x'.repeat(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }), at),
  ).rejects.toThrow('too large');
});

test('Two Trees links only to its own apartment pages', () => {
  expect(twoTreesListingUrl('https://www.twotreesny.com/apartments/5-s-5th-st/2-bedroom/3106')).toBe(
    'https://www.twotreesny.com/apartments/5-s-5th-st/2-bedroom/3106',
  );
  expect(twoTreesListingUrl('https://www.twotreesny.com/office-spaces/45-main/2/3106')).toBeNull();
  expect(twoTreesListingUrl('https://twotreesny.com/apartments/5-s-5th-st/2-bedroom/3106')).toBeNull();
});
