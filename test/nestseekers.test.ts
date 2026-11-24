import { expect, test } from 'bun:test';
import { NESTSEEKERS_LIVE, loadNestSeekers, nestseekersListingUrl, parseNestSeekersPage } from '../server/sources/nestseekers.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.nestseekers.com';
const card = ({
  id = '5846317',
  slug = '128-summit-street-3-nyc-ny-11231-3br',
  place = ['128 Summit Street', 'Carroll Gardens', 'Brooklyn'],
  facts = ['3 bed', '2½ bath', '3+ bedroom apartment', 'Condo'],
  price = '$7,500',
} = {}) =>
  `<a href="${ORIGIN}/${id}/${slug}" class="hover:no-underline group block"><div class="text-white/85 mt-1 text-sm leading-tight"><div>mobile copy</div></div>` +
  `<div class="hidden grow px-2 pt-2"><div class="mb-2 text-lg" title="x">x</div><div class="flex"><div class="w-2/3 pr-2">` +
  `<div class="text-base leading-tight">${place.map((line) => `<div>${line}</div>`).join('')}</div>` +
  `<div class="mt-2 text-sm text-gray-600">WebId #${id}</div></div>` +
  `<div class="w-1/3 text-sm leading-tight text-right">${facts.map((line) => `<div>${line}</div>`).join('')}</div></div></div>` +
  `<div class="mt-auto hidden flex-col"><div class="max-w-72 w-full mx-auto text-base font-semibold leading-tight text-center">${price}</div></div></a>`;
const page = (cards: string[], lastPage = 1) =>
  `<html><div id="search-results">${lastPage > 1 ? `<a href="/Rentals/brooklyn/?page=${lastPage}"` + '>last</a>' : ''}${cards.join('')}</div></html>`;
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('Nest Seekers cards keep homes with a building number, a single rent and bedrooms', () => {
  const { lastPage, cards } = parseNestSeekersPage(
    page(
      [
        card(),
        // The ZIP code and unit in the address; bedrooms only in the kind of home; no baths.
        card({
          id: '5848309',
          slug: '67-livingston-street',
          place: ['67 Livingston Street, Unit 20, Brooklyn, NY 11201', 'Brooklyn Heights', 'Brooklyn'],
          facts: ['', '', '2 bedroom apartment', 'Rental'],
          price: '$12,500',
        }),
        // A studio in Manhattan, with an apostrophe and an ampersand.
        card({
          id: '1',
          place: ['74 Washington Pl', 'Hell&#x27;s Kitchen &amp; More', 'New York', 'Manhattan'],
          facts: ['Studio', '1 bath', 'Apartment', ''],
        }),
        // Left out: a commercial lease, a price range, no building number, outside the boroughs, no bedrooms,
        // a link elsewhere.
        card({ id: '2', facts: ['', '2 bath', 'Commercial Lease', 'Mixed Use'] }),
        card({ id: '3', price: '$2,550 - $3,250' }),
        card({ id: '4', place: ['W 37th St', 'Midtown', 'Manhattan'] }),
        card({ id: '5', place: ['1 Main St', 'Hoboken', 'New Jersey'] }),
        card({ id: '6', facts: ['', '1 bath', 'Townhouse'] }),
        card({ id: '7', slug: 'Bad_Slug' }),
      ],
      7,
    ),
  );
  expect(lastPage).toBe(7);
  expect(cards).toEqual([
    {
      id: '5846317',
      url: `${ORIGIN}/5846317/128-summit-street-3-nyc-ny-11231-3br`,
      street: '128 Summit Street',
      unit: '',
      zip: '',
      neighborhood: 'Carroll Gardens',
      borough: 'Brooklyn',
      bedrooms: 3,
      bathrooms: 2.5,
      rent: 7500,
    },
    expect.objectContaining({
      id: '5848309',
      street: '67 Livingston Street',
      unit: '20',
      zip: '11201',
      bedrooms: 2,
      bathrooms: Number.NaN,
    }),
    expect.objectContaining({
      id: '1',
      street: '74 Washington Pl',
      neighborhood: "Hell's Kitchen & More",
      borough: 'Manhattan',
      bedrooms: 0,
    }),
  ]);
  expect(parseNestSeekersPage(page([])).lastPage).toBe(1);
  expect(() => parseNestSeekersPage('<html></html>')).toThrow(/recognized rentals page/);
  expect(nestseekersListingUrl(`${ORIGIN}/Rentals/brooklyn/`)).toBeNull();
});

test('Nest Seekers reads Brooklyn, Queens and Manhattan newest first, with ZIP codes from the Census', async () => {
  const requested: string[] = [];
  let census = '';
  const fetcher = async (url: string, init?: RequestInit) => {
    requested.push(url);
    if (url.includes('census')) {
      census = await ((init?.body as FormData).get('addressFile') as Blob).text();
      return new Response(
        [
          '"5846317","x","Match","Exact","128 SUMMIT ST, BROOKLYN, NY, 11231","-74.0,40.68","1","L"',
          // Found in another borough than the card says.
          '"8","x","Match","Exact","1 STEINWAY ST, BROOKLYN, NY, 11201","-73.9,40.7","1","L"',
          '"9","x","Match","Exact","74 WASHINGTON PL, NEW YORK, NY, 10011","-74.0,40.73","1","L"',
        ].join('\n'),
      );
    }
    if (url.includes('/brooklyn/'))
      return html(
        page([
          card(),
          card({ id: '5848309', place: ['67 Livingston Street, Unit 20, Brooklyn, NY 11201', 'Brooklyn Heights', 'Brooklyn'] }),
          // Five bedrooms: refused when normalized.
          card({ id: '10', place: ['67 Livingston Street, Brooklyn, NY 11201', 'Brooklyn Heights', 'Brooklyn'], facts: ['5 bed'] }),
        ]),
      );
    if (url.includes('/queens/')) return html(page([card({ id: '8', place: ['1 Steinway St', 'Astoria', 'Queens', 'LIC / Queens'] })]));
    return html(page([card({ id: '9', place: ['74 Washington Pl', 'Greenwich Village', 'New York', 'Manhattan'], facts: ['1 bed'] })]));
  };
  const result = await NESTSEEKERS_LIVE.load(fetcher, new Date(at));
  expect(requested).toEqual([
    `${ORIGIN}/Rentals/brooklyn/?sortBy=newest`,
    `${ORIGIN}/Rentals/queens/?sortBy=newest`,
    `${ORIGIN}/Rentals/manhattan/?sortBy=newest`,
    'https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
  ]);
  expect(census.split('\n')).toEqual([
    '"5846317","128 Summit Street","Brooklyn","NY",""',
    '"5848309","67 Livingston Street","Brooklyn","NY",""',
    '"10","67 Livingston Street","Brooklyn","NY",""',
    '"8","1 Steinway St","Astoria","NY",""',
    '"9","74 Washington Pl","New York","NY",""',
  ]);
  expect(result).toMatchObject({ pages: 3, rawCount: 5, checkedAt: at });
  expect(result.listings.map(({ id, zip, city, unit, latitude, bathrooms }) => ({ id, zip, city, unit, latitude, bathrooms }))).toEqual([
    { id: 'nestseekers:5846317', zip: '11231', city: 'Brooklyn', unit: '', latitude: 40.68, bathrooms: 2.5 },
    { id: 'nestseekers:5848309', zip: '11201', city: 'Brooklyn', unit: '20', latitude: Number.NaN, bathrooms: 2.5 },
    { id: 'nestseekers:9', zip: '10011', city: 'Manhattan', unit: '', latitude: 40.73, bathrooms: null },
  ]);
  expect(NESTSEEKERS_LIVE.listingUrl(result.listings[0]?.sources[0]?.url)).toBeTruthy();
}, 20_000);

test('Nest Seekers stops at its page budget', async () => {
  const requested: string[] = [];
  const result = await loadNestSeekers(
    async (url) => {
      requested.push(url);
      return url.includes('census') ? new Response('') : html(page([card()], 50));
    },
    new Date(at),
    0,
  );
  expect(result.pages).toBe(39);
  expect(requested.filter((url) => url.includes('/Rentals/'))).toHaveLength(39);
  expect(requested[1]).toBe(`${ORIGIN}/Rentals/brooklyn/?sortBy=newest&page=2`);
  expect(requested.some((url) => url.includes('/queens/'))).toBe(false);
  expect(result.listings).toEqual([]);
});
