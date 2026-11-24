import { expect, test } from 'bun:test';
import { GREYSTAR_LIVE, greystarListingUrl, parseGreystarMetro, parseGreystarProperty } from '../server/sources/greystar.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.greystar.com';
const FLATBUSH = `${ORIGIN}/1-flatbush-brooklyn-ny/p_16991`;
const card = (path: string, name: string, address: string, price = '12 month lease from') =>
  `<a href="${path}" class="card"><h3>${name}</h3><p>${address}</p><p>${price}</p><p>$3,550</p></a>`;
const metroPage = (...cards: string[]) => `<html>${cards.join('')}</html>`;
const flight = (text: string) => `<script>self.__next_f.push(${JSON.stringify([1, text])})</script>`;
const business = (overrides: Record<string, unknown> = {}) => ({
  '@type': 'LodgingBusiness',
  address: { streetAddress: '558 Fulton St, Suite 301', postalCode: '11217' },
  latitude: 40.688,
  longitude: -73.982,
  containsPlace: [
    { identifier: '586168', numberOfBedrooms: 0, numberOfBathroomsTotal: 1 },
    { identifier: '586188', numberOfBedrooms: 1, numberOfBathroomsTotal: 1 },
    'not a plan',
  ],
  ...overrides,
});
const unit = (overrides: Record<string, unknown> = {}) => ({
  unitId: '10450386',
  unitNumber: '1410',
  floorPlanId: '586168',
  area: 424,
  minPrice: 3475,
  ...overrides,
});
const propertyPage = (thing: unknown, units: unknown) =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'BreadcrumbList' })}</script>` +
  `<script type="application/ld+json">${JSON.stringify(thing)}</script>` +
  flight('1:"$Sreact.fragment"\n') +
  flight(`2:["$","div",null,{"note":"a ] and \\" in a string","propertyUnits":${JSON.stringify(units)},"x":1}]`) +
  '<script>self.__next_f.push([2])</script>';
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('Greystar reads the New York City buildings on its metro page that show prices', () => {
  expect(
    parseGreystarMetro(
      metroPage(
        card('/1-flatbush-brooklyn-ny/p_16991', '1 Flatbush', '558 Fulton St, Suite 301, Brooklyn, NY 11217'),
        card('/1-flatbush-brooklyn-ny/p_16991', '1 Flatbush', '558 Fulton St, Suite 301, Brooklyn, NY 11217'),
        card(
          '/116-john-new-york-ny/p_21674',
          '116 John',
          '116 John Street, New York, NY 10038',
          'Contact the community for more information',
        ),
        card('/25-maple-new-rochelle-ny/p_22538', '25 Maple', '25 Maple Avenue, New Rochelle, NY 10801'),
      ),
    ),
  ).toEqual([{ url: FLATBUSH }]);
  expect(() => parseGreystarMetro('<html></html>')).toThrow('recognized metro page');
});

test('Greystar lists each available unit with its floor plan’s size and the building address', () => {
  const listings = parseGreystarProperty(
    propertyPage(business(), [
      unit(),
      unit({ unitId: '10450398', unitNumber: '1601', floorPlanId: '586188', minPrice: 4300 }),
      // Left out: an unknown floor plan (no bedroom count), no rent, malformed.
      unit({ unitId: 'a', floorPlanId: '9' }),
      unit({ unitId: 'b', minPrice: null }),
      unit({ unitId: 7 }),
      unit({ unitId: 'c', unitNumber: null, note: 'a ] and " in a string' }),
      'not a unit',
    ]),
    { url: FLATBUSH },
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
      id: 'greystar:10450386',
      address: '558 Fulton St',
      unit: '1410',
      city: 'Brooklyn',
      zip: '11217',
      rent: 3475,
      bedrooms: 0,
      squareFeet: 424,
    },
    {
      id: 'greystar:10450398',
      address: '558 Fulton St',
      unit: '1601',
      city: 'Brooklyn',
      zip: '11217',
      rent: 4300,
      bedrooms: 1,
      squareFeet: 424,
    },
  ]);
  expect(listings[0]).toMatchObject({ latitude: 40.688, longitude: -73.982, region: 'nyc', seenAt: at, sources: [{ url: FLATBUSH }] });
  // Outside the five boroughs, or with no floor plans listed.
  expect(
    parseGreystarProperty(
      propertyPage(business({ address: { streetAddress: '1 Main', postalCode: '10801' } }), [unit()]),
      { url: FLATBUSH },
      at,
    ),
  ).toEqual([]);
  expect(parseGreystarProperty(propertyPage(business({ address: { postalCode: '11217' } }), [unit()]), { url: FLATBUSH }, at)).toEqual([]);
  expect(parseGreystarProperty(propertyPage(business({ address: { streetAddress: '1 Main' } }), [unit()]), { url: FLATBUSH }, at)).toEqual(
    [],
  );
  expect(parseGreystarProperty(propertyPage(business({ containsPlace: null }), [unit()]), { url: FLATBUSH }, at)).toEqual([]);
  expect(() => parseGreystarProperty(propertyPage(business(), null), { url: FLATBUSH }, at)).toThrow('recognized building page');
  expect(() => parseGreystarProperty(propertyPage({ '@type': 'Place' }, []), { url: FLATBUSH }, at)).toThrow('recognized building page');
  expect(() => parseGreystarProperty(flight('"propertyUnits":[1,'), { url: FLATBUSH }, at)).toThrow('recognized building page');
  expect(greystarListingUrl(`${FLATBUSH}?unit=1`)).toBe(FLATBUSH);
  expect(greystarListingUrl(`${ORIGIN}/api/x`)).toBeNull();
});

test('Greystar loads the metro page, then each building page', async () => {
  const site: Record<string, string> = {
    [`${ORIGIN}/homes-to-rent/us/ny/new-york-city`]: metroPage(
      card('/1-flatbush-brooklyn-ny/p_16991', '1 Flatbush', '558 Fulton St, Suite 301, Brooklyn, NY 11217'),
      card('/the-octagon-new-york-ny/p_20865', 'The Octagon', '888 Main Street, New York, NY 10044'),
    ),
    [FLATBUSH]: propertyPage(business(), [unit()]),
  };
  const fetcher: FetchTransport = async (url) => (site[url] ? html(site[url]) : html('gone', 500));
  const result = await GREYSTAR_LIVE.load(fetcher, new Date(at));
  expect(result).toMatchObject({ pages: 2, partial: true, requestedPages: 3, failedPages: 1 });
  expect(result.listings.map(({ id }) => id)).toEqual(['greystar:10450386']);

  site[`${ORIGIN}/homes-to-rent/us/ny/new-york-city`] = metroPage(
    card('/1-flatbush-brooklyn-ny/p_16991', '1 Flatbush', '1 Flatbush, Brooklyn, NY 11217'),
  );
  expect(await GREYSTAR_LIVE.load(fetcher, new Date(at))).toEqual({
    listings: [expect.objectContaining({ id: 'greystar:10450386' })],
    pages: 2,
  });

  site[`${ORIGIN}/homes-to-rent/us/ny/new-york-city`] = metroPage(card('/x-yonkers-ny/p_1', 'X', '1 Main St, Yonkers, NY 10701'));
  await expect(GREYSTAR_LIVE.load(fetcher, new Date(at))).rejects.toThrow('no New York City buildings');
});
