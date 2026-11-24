import { expect, test } from 'bun:test';
import { UDR_LIVE, parseUdrCommunities, parseUdrPricing, udrListingUrl } from '../server/sources/udr.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.udr.com';
const WALL = `${ORIGIN}/new-york-city-apartments/lower-manhattan/95-wall/apartments-pricing/`;
const apartment = (name: string, id: string, bedrooms: number, price: unknown, availability = 'https://schema.org/InStock') => ({
  '@type': 'ListItem',
  item: {
    '@type': ['Apartment', 'Product'],
    name,
    url: `${WALL}?unitid=${id}`,
    offers: { availability, price },
    floorSize: { value: 487 },
    numberOfBathroomsTotal: 1,
    numberOfBedrooms: bedrooms,
  },
});
const pricingPage = (items: unknown[], address = '95 Wall Street, New York, NY 10005') =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'BreadcrumbList' })}</script>` +
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: items })}</script>` +
  `<script>var config = {"propertyId":40158,"propertyAddress":"${address}"};</script>`;
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('UDR reads its New York City communities’ pricing pages from the city page', () => {
  expect(
    parseUdrCommunities(
      `<a href="/new-york-city-apartments/lower-manhattan/95-wall/apartments-pricing/">x</a>
       <a href="/new-york-city-apartments/lower-manhattan/95-wall/apartments-pricing/">x</a>
       <a href="/new-york-city-apartments/lower-manhattan/95-wall/apartments-pricing//#/?beds=0">x</a>
       <a href="/new-york-city-apartments/lower-manhattan/95-wall/">x</a>`,
    ),
  ).toEqual([{ url: WALL }]);
  expect(() => parseUdrCommunities('<html></html>')).toThrow('recognized New York City page');
});

test('UDR lists each available apartment with its number, size and rent', () => {
  const listings = parseUdrPricing(
    pricingPage([
      apartment('Apartment 415', '13673508', 0, 4242),
      apartment('Apartment #775 - 07E', '10389375', 2, 6100),
      // Left out: not available, no rent, an unexpected name or link, malformed.
      apartment('Apartment 416', '1', 0, 4000, 'https://schema.org/OutOfStock'),
      apartment('Apartment 417', '2', 0, null),
      apartment('Penthouse', '3', 0, 9000),
      { ...apartment('Apartment 418', '4', 0, 4000), item: { name: 'Apartment 418', url: `${ORIGIN}/elsewhere?unitid=4` } },
      { item: null },
      null,
    ]),
    { url: WALL },
    at,
  );
  expect(
    listings.map(({ id, address, unit, city, zip, rent, bedrooms, squareFeet }) => ({
      id,
      address,
      unit,
      city,
      zip,
      rent,
      bedrooms,
      squareFeet,
    })),
  ).toEqual([
    {
      id: 'udr:13673508',
      address: '95 Wall Street',
      unit: '415',
      city: 'Manhattan',
      zip: '10005',
      rent: 4242,
      bedrooms: 0,
      squareFeet: 487,
    },
    {
      id: 'udr:10389375',
      address: '95 Wall Street',
      unit: '775-07E',
      city: 'Manhattan',
      zip: '10005',
      rent: 6100,
      bedrooms: 2,
      squareFeet: 487,
    },
  ]);
  expect(listings[0]).toMatchObject({ region: 'nyc', kind: 'feed', seenAt: at, sources: [{ url: `${WALL}?unitid=13673508` }] });
  const [noSize] = parseUdrPricing(
    pricingPage([
      {
        item: {
          ...apartment('Apartment 1', '5', 1, 3000).item,
          floorSize: null,
          offers: { availability: 'https://schema.org/InStock', price: 3000 },
        },
      },
    ]),
    { url: WALL },
    at,
  );
  expect(noSize).toMatchObject({ unit: '1', squareFeet: null });
  expect(parseUdrPricing(pricingPage([apartment('Apartment 1', '6', 1, 3000)], '1 Main St, Hoboken, NJ 07030'), { url: WALL }, at)).toEqual(
    [],
  );
  expect(parseUdrPricing(pricingPage([apartment('Apartment 1', '6', 1, 3000)], 'Somewhere'), { url: WALL }, at)).toEqual([]);
  expect(() => parseUdrPricing('<html></html>', { url: WALL }, at)).toThrow('recognized pricing page');
  expect(udrListingUrl(`${WALL}?unitid=13673508&x=1`)).toBe(`${WALL}?unitid=13673508`);
  expect(udrListingUrl(WALL)).toBeNull();
  expect(udrListingUrl(7)).toBeNull();
  expect(udrListingUrl('/relative')).toBeNull();
});

test('UDR loads the city page, then each community’s pricing page', async () => {
  const site: Record<string, string> = {
    [`${ORIGIN}/new-york-city-apartments/`]: `<a href="/new-york-city-apartments/lower-manhattan/95-wall/apartments-pricing/">x</a>
      <a href="/new-york-city-apartments/chelsea/21-chelsea/apartments-pricing/">x</a>`,
    [WALL]: pricingPage([apartment('Apartment 415', '13673508', 0, 4242)]),
  };
  const fetcher: FetchTransport = async (url) => (site[url] ? html(site[url]) : html('gone', 500));
  const result = await UDR_LIVE.load(fetcher, new Date(at));
  expect(result).toMatchObject({ pages: 2, partial: true, requestedPages: 3, failedPages: 1 });
  expect(result.listings.map(({ id }) => id)).toEqual(['udr:13673508']);
  site[`${ORIGIN}/new-york-city-apartments/`] = '<a href="/new-york-city-apartments/lower-manhattan/95-wall/apartments-pricing/">x</a>';
  expect(await UDR_LIVE.load(fetcher, new Date(at))).toEqual({ listings: [expect.objectContaining({ id: 'udr:13673508' })], pages: 2 });
});
