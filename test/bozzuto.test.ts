import { expect, test } from 'bun:test';
import {
  BOZZUTO_LIVE,
  bozzutoListingUrl,
  loadBozzuto,
  parseBozzutoBuilding,
  parseBozzutoFloorPlans,
  parseBozzutoProperties,
} from '../server/sources/bozzuto.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.bozzuto.com';
const AALTO = `${ORIGIN}/apartments-for-rent/ny/new-york/aalto57`;
const ld = (...things: unknown[]) => things.map((thing) => `<script type="application/ld+json">${JSON.stringify(thing)}</script>`).join('');
const statePage = (...paths: string[]) =>
  `<h1>Apartments for Rent in New York</h1>${paths.map((path) => `<a href="${path}">x</a>`).join('')}`;
const buildingPage = (postalCode = '10022', extra: Record<string, unknown> = {}) =>
  ld({
    '@graph': [
      { '@type': 'ItemPage' },
      {
        '@type': 'ApartmentComplex',
        address: { streetAddress: '1065 2nd Ave', postalCode },
        geo: { latitude: '40.758949', longitude: '-73.965795' },
        ...extra,
      },
    ],
  });
const plan = (id: string, bedrooms: unknown, price: string, availability = 'https://schema.org/InStock') => ({
  '@type': 'FloorPlan',
  numberOfBedrooms: bedrooms,
  numberOfBathroomsTotal: 1,
  floorSize: { value: '830' },
  url: `${AALTO}/floor-plans/${id}`,
  offers: { price, availability },
});
const plansPage = (...plans: unknown[]) => ld({ '@graph': plans }, null);
const building = { address: '1065 2nd Ave', zip: '10022', city: 'Manhattan', latitude: '40.75', longitude: '-73.96' };
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('Bozzuto reads the New York City buildings linked from its New York page', () => {
  expect(
    parseBozzutoProperties(
      statePage(
        '/apartments-for-rent/ny/new-york/aalto57',
        '/apartments-for-rent/ny/new-york/aalto57',
        '/apartments-for-rent/ny/new-york/aalto57/reviews',
        '/apartments-for-rent/ny/brooklyn/hub',
        '/apartments-for-rent/ny/yonkers/sawyer-place',
      ),
    ),
  ).toEqual([AALTO, `${ORIGIN}/apartments-for-rent/ny/brooklyn/hub`]);
  expect(() => parseBozzutoProperties('<html></html>')).toThrow('recognized New York page');
});

test('Bozzuto buildings give their address and borough', () => {
  expect(parseBozzutoBuilding(buildingPage())).toEqual({
    address: '1065 2nd Ave',
    zip: '10022',
    city: 'Manhattan',
    latitude: '40.758949',
    longitude: '-73.965795',
  });
  expect(parseBozzutoBuilding(buildingPage('10022', { geo: null }))).toMatchObject({ latitude: undefined });
  expect(parseBozzutoBuilding(buildingPage('10701'))).toBeNull();
  expect(() => parseBozzutoBuilding(buildingPage('10022', { address: { streetAddress: '1 Main St' } }))).toThrow('address');
  expect(() => parseBozzutoBuilding(ld({ '@type': 'ApartmentComplex' }, 'x'))).toThrow('address');
});

test('Bozzuto lists each available floor plan at its lowest price', () => {
  const listings = parseBozzutoFloorPlans(
    plansPage(
      plan('3463254', 1, '8850'),
      plan('3463277', 3, '10150'),
      // Left out: not available, no price, five bedrooms, an unexpected link.
      plan('3463231', 0, '0', 'https://schema.org/OutOfStock'),
      plan('3463232', 0, '0'),
      plan('3463233', 5, '20000'),
      { ...plan('3463234', 1, '5000'), url: 'https://aalto57.securecafe.com/x', floorSize: null, offers: null },
      { '@type': 'WebPage' },
    ),
    building,
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
    { id: 'bozzuto:3463254', address: '1065 2nd Ave', unit: '', city: 'Manhattan', zip: '10022', rent: 8850, bedrooms: 1, squareFeet: 830 },
    {
      id: 'bozzuto:3463277',
      address: '1065 2nd Ave',
      unit: '',
      city: 'Manhattan',
      zip: '10022',
      rent: 10150,
      bedrooms: 3,
      squareFeet: 830,
    },
  ]);
  expect(listings[0]).toMatchObject({ region: 'nyc', kind: 'feed', seenAt: at, sources: [{ url: `${AALTO}/floor-plans/3463254` }] });
  expect(() => parseBozzutoFloorPlans('<html></html>', building, at)).toThrow('recognized floor-plans page');
});

test('Bozzuto floor plan links', () => {
  expect(bozzutoListingUrl(`${AALTO}/floor-plans/3463254?x=1`)).toBe(`${AALTO}/floor-plans/3463254`);
  expect(bozzutoListingUrl(`${AALTO}/floor-plans`)).toBeNull();
  expect(bozzutoListingUrl(7)).toBeNull();
  expect(bozzutoListingUrl('http://[')).toBeNull();
});

test('Bozzuto loads the New York page, then each building and its floor plans', async () => {
  const requested: string[] = [];
  const site: Record<string, string> = {
    [`${ORIGIN}/apartments-for-rent/ny`]: statePage(
      '/apartments-for-rent/ny/new-york/aalto57',
      '/apartments-for-rent/ny/brooklyn/elsewhere',
    ),
    [AALTO]: buildingPage(),
    [`${AALTO}/floor-plans`]: plansPage(plan('3463254', 1, '8850')),
    // A building whose address turns out to be outside the five boroughs is not asked for its floor plans.
    [`${ORIGIN}/apartments-for-rent/ny/brooklyn/elsewhere`]: buildingPage('07302'),
  };
  const fetcher: FetchTransport = async (url) => {
    requested.push(url);
    return html(site[url]);
  };
  const result = await loadBozzuto(fetcher, new Date(at), 1);
  expect(result).toMatchObject({ pages: 4 });
  expect(result.listings.map(({ id }) => id)).toEqual(['bozzuto:3463254']);
  expect(requested).toHaveLength(4);
  expect(BOZZUTO_LIVE).toMatchObject({ id: 'bozzuto-live', marketplace: 'bozzuto', load: loadBozzuto });

  await expect(loadBozzuto(async () => html(statePage()), new Date(at), 1)).rejects.toThrow('no New York City buildings');
  site[`${AALTO}/floor-plans`] = plansPage(plan('3463231', 0, '0', 'https://schema.org/OutOfStock'));
  await expect(loadBozzuto(fetcher, new Date(at), 1)).rejects.toThrow('no available New York City apartments');
  await expect(loadBozzuto(async () => html('', 403), new Date(at), 1)).rejects.toThrow('HTTP 403');
});
