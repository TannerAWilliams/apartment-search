import { expect, test } from 'bun:test';
import {
  REALNY_LIVE,
  censusLocations,
  loadRealtyMx,
  parseRealtyMxAreas,
  parseRealtyMxPage,
  realnyListingUrl,
} from '../server/sources/realny.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.realnyproperties.com';
const area = (name: string, group: number) =>
  `<input aria-label="${name}" type="checkbox" name="cat" value="1"\n  class="styled checkCat_${group} cat">`;
const FILTER = [
  `<a class="accordion-toggle" id="Cat_23" href="#cat23">Manhattan <i></i></a>`,
  `<a class="accordion-toggle" id="Cat_103" href="#cat103">Brooklyn <i></i></a>`,
  `<a class="accordion-toggle" id="Cat_108" href="#cat108">Queens <i></i></a>`,
  `<a class="accordion-toggle" id="Cat_198" href="#cat198">Long Island</a>`,
  area('Upper East Side', 23),
  area('Hell&#x27;s Kitchen', 23),
  area('Brooklyn Heights', 103),
  area('Astoria', 108),
  area('Long Beach', 198),
].join('\n');
const card = ({
  id = '221784',
  path = '/brooklyn-heights/apartment-for-rent/145-henry-street-2a/221784',
  title = '145 HENRY STREET, #2A',
  type = 'Apartment',
  hood = 'Brooklyn Heights',
  price = '$7,333',
  rooms = '2 BR <span>|</span> 1 BT',
} = {}) => `<li class="property-card item graphic">
  <a href="javascript:;" class="heartIconLink" data-pid="${id}"></a>
  <div class="image-caption"><h3>
    <a class="" href="${ORIGIN}${path}" data-pid="${id}" title="x">
      ${title}
    </a></h3>
  <span class="meta"><span class="property-grid-type">${type} </span>
  <span class="property-grid-area" style="float:right;">${hood}</span></span>
  <div class="price"><span>${price}</span>
    <div class="bedrooms" style="float:right;">${rooms}</div></div></div></li>`;
const page = (total: number, ...cards: string[]) =>
  `<html>${FILTER}<ul>${cards.join('\n')}</ul><div class="pagination"><br /><h3>${total.toLocaleString('en-US')} records found</h3></div></html>`;
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
const census = (...rows: string[]) => new Response(rows.join('\n'), { headers: { 'content-type': 'text/plain' } });
const match = (id: string, matched: string, point = '-73.99,40.69') => `"${id}","x","Match","Exact","${matched}","${point}","1","L"`;

test('RealtyMX neighborhoods take the borough of the group they are listed under', () => {
  expect(Object.fromEntries(parseRealtyMxAreas(FILTER))).toEqual({
    'Upper East Side': 'Manhattan',
    "Hell's Kitchen": 'Manhattan',
    'Brooklyn Heights': 'Brooklyn',
    Astoria: 'Queens',
    Manhattan: 'Manhattan',
    Brooklyn: 'Brooklyn',
    Queens: 'Queens',
  });
});

test('RealtyMX cards keep homes with a building number, rent and bedrooms', () => {
  const { total, cards } = parseRealtyMxPage(
    page(
      1420,
      card(),
      // A studio with a unit written out; a 1.5 bedroom; a building number with a hyphen and no unit.
      card({
        id: '2',
        path: '/gramercy-park/condo-for-rent/305-second-avenue-apt-716/2',
        title: '305 SECOND AVENUE, APT 716',
        type: 'Condo',
        hood: 'Upper East Side',
        rooms: 'Studio <span>|</span> 1 BT',
      }),
      card({
        id: '3',
        path: '/astoria/apartment-for-rent/27-16-21st-street/3',
        title: '27-16 21ST STREET',
        hood: 'Astoria',
        rooms: '2 FM | 1.5 BR',
      }),
      // Left out: no building number, not a home, no rent, no bedrooms, a link elsewhere, no id.
      card({ id: '4', title: '1ST AVENUE' }),
      card({ id: '5', type: 'Retail' }),
      card({ id: '6', price: 'Call' }),
      card({ id: '7', rooms: '' }),
      card({ id: '8', path: '/miami-beach/house-for-rent/1-ocean-dr/8/MLS' }),
      card({ id: '' }),
      card({ id: '9', hood: '' }),
    ),
    realnyListingUrl,
    'REAL New York',
  );
  expect(total).toBe(1420);
  expect(cards).toEqual([
    {
      id: '221784',
      url: `${ORIGIN}/brooklyn-heights/apartment-for-rent/145-henry-street-2a/221784`,
      street: '145 HENRY STREET',
      unit: '2A',
      area: 'Brooklyn Heights',
      type: 'Apartment',
      rent: 7333,
      bedrooms: 2,
      bathrooms: 1,
    },
    expect.objectContaining({ id: '2', street: '305 SECOND AVENUE', unit: '716', bedrooms: 0, bathrooms: 1, type: 'Condo' }),
    expect.objectContaining({ id: '3', street: '27-16 21ST STREET', unit: '', bedrooms: 1, bathrooms: Number.NaN }),
  ]);
  expect(() => parseRealtyMxPage('<html></html>', realnyListingUrl, 'REAL New York')).toThrow(/recognized rentals search page/);
});

test('The Census geocoder gives ZIP codes and points of matched NYC addresses', async () => {
  let sent = '';
  const located = await censusLocations(
    async (url, init) => {
      expect(url).toBe('https://geocoding.geo.census.gov/geocoder/locations/addressbatch');
      sent = await ((init?.body as FormData).get('addressFile') as Blob).text();
      return census(
        match('1', '145 HENRY ST, BROOKLYN, NY, 11201', '-73.9935,40.6962'),
        '"2","x","No_Match"',
        match('3', '1 MAIN ST, ALBANY, NY, 12207', '-73.75,42.65'),
        '"4","x","Tie"',
        match('5', 'NO ZIP'),
      );
    },
    [{ id: '1', street: '145 HENRY "STREET"', city: 'Brooklyn' }],
  );
  expect(sent).toBe('"1","145 HENRY ""STREET""","Brooklyn","NY",""');
  expect([...located]).toEqual([['1', { zip: '11201', latitude: 40.6962, longitude: -73.9935 }]]);
  // Nothing to look up asks nothing.
  expect((await censusLocations(async () => Promise.reject(new Error('asked')), [])).size).toBe(0);
  await expect(censusLocations(async () => new Response('', { status: 500 }), [{ id: '1', street: 'x', city: 'y' }])).rejects.toThrow(
    'Census geocoder returned HTTP 500',
  );
});

test('REAL New York is read page by page, and kept where the Census finds it in the expected borough', async () => {
  const requested: string[] = [];
  let censusRows = '';
  const fetcher = async (url: string, init?: RequestInit) => {
    requested.push(url);
    if (url.startsWith('https://geocoding.geo.census.gov/')) {
      censusRows = await ((init?.body as FormData).get('addressFile') as Blob).text();
      return census(
        match('221784', '145 HENRY ST, BROOKLYN, NY, 11201'),
        match('2', '305 2ND AVE, NEW YORK, NY, 10003'),
        // Found, but in another borough than its neighborhood.
        match('3', '27 21ST ST, BROOKLYN, NY, 11232'),
        match('10', '1 GROUP ST, BROOKLYN, NY, 11201'),
      );
    }
    return html(
      url.endsWith('startAt=1')
        ? page(
            3,
            card(),
            card({
              id: '2',
              path: '/gramercy-park/condo-for-rent/305-second-avenue/2',
              title: '305 SECOND AVENUE',
              hood: 'Upper East Side',
            }),
            // Outside the five boroughs: not looked up.
            card({ id: '11', title: '1 BEACH ST', hood: 'Long Beach' }),
          )
        : page(
            3,
            card(),
            card({ id: '3', title: '27-16 21ST STREET', hood: 'Astoria' }),
            card({ id: '10', title: '1 GROUP STREET', hood: 'Brooklyn' }),
            // Not geocoded.
            card({ id: '12', title: '9 NOWHERE STREET' }),
          ),
    );
  };
  const site = {
    source: { id: 'realny', name: 'REAL New York', kind: 'feed' },
    origin: ORIGIN,
    status: '2,21',
    rowsPerPage: 2,
    maxPages: 2,
    listingUrl: realnyListingUrl,
  };
  const result = await loadRealtyMx(site, fetcher, new Date(at), 0);
  expect(requested.slice(0, 2)).toEqual([
    `${ORIGIN}/index.cfm?page=properties&status=2,21&isCompany=1&isMLS=1&maxRows=2&startAt=1`,
    `${ORIGIN}/index.cfm?page=properties&status=2,21&isCompany=1&isMLS=1&maxRows=2&startAt=3`,
  ]);
  expect(censusRows.split('\n')).toEqual([
    '"221784","145 HENRY STREET","Brooklyn","NY",""',
    '"2","305 SECOND AVENUE","New York","NY",""',
    '"3","27-16 21ST STREET","Astoria","NY",""',
    '"10","1 GROUP STREET","Brooklyn","NY",""',
    '"12","9 NOWHERE STREET","Brooklyn","NY",""',
  ]);
  expect(result).toMatchObject({ pages: 2, total: 3, rawCount: 7, checkedAt: at });
  expect(result.listings.map(({ id, address, unit, city, zip, neighborhood }) => ({ id, address, unit, city, zip, neighborhood }))).toEqual(
    [
      { id: 'realny:221784', address: '145 HENRY STREET', unit: '2A', city: 'Brooklyn', zip: '11201', neighborhood: 'Brooklyn Heights' },
      { id: 'realny:2', address: '305 SECOND AVENUE', unit: '', city: 'Manhattan', zip: '10003', neighborhood: 'Upper East Side' },
      { id: 'realny:10', address: '1 GROUP STREET', unit: '', city: 'Brooklyn', zip: '11201', neighborhood: 'Brooklyn' },
    ],
  );
  expect(result.listings[0]).toMatchObject({ rent: 7333, bedrooms: 2, bathrooms: 1, latitude: 40.69, longitude: -73.99, region: 'nyc' });
  // A bathroom count it cannot read is left blank.
  const noBaths = await loadRealtyMx(
    { ...site, maxPages: 1 },
    async (url) =>
      url.includes('census') ? census(match('221784', '145 HENRY ST, BROOKLYN, NY, 11201')) : html(page(1, card({ rooms: '2 BR' }))),
    new Date(at),
  );
  expect(noBaths.listings[0]?.bathrooms).toBeNull();
  // A listing normalizeListing refuses (more than four bedrooms) is left out.
  const tooBig = await loadRealtyMx(
    { ...site, maxPages: 1 },
    async (url) =>
      url.includes('census') ? census(match('221784', '145 HENRY ST, BROOKLYN, NY, 11201')) : html(page(1, card({ rooms: '5 BR' }))),
    new Date(at),
  );
  expect(tooBig.listings).toEqual([]);
  // An empty search is one page.
  expect((await loadRealtyMx(site, async () => html(page(0)), new Date(at))).pages).toBe(1);
  await expect(loadRealtyMx(site, async () => html(page(5)), new Date(at))).rejects.toThrow(/more rentals than expected/);
  await expect(loadRealtyMx(site, async () => html(page(1).replace(FILTER, '')), new Date(at))).rejects.toThrow(
    /did not list its neighborhoods/,
  );
});

test('REAL New York reads 500 cards a page from its rentals search', async () => {
  const requested: string[] = [];
  const result = await REALNY_LIVE.load(async (url) => {
    requested.push(url);
    return url.includes('census') ? census(match('221784', '145 HENRY ST, BROOKLYN, NY, 11201')) : html(page(1, card()));
  }, new Date(at));
  expect(requested[0]).toBe(`${ORIGIN}/index.cfm?page=properties&status=2,21&isCompany=1&isMLS=1&maxRows=500&startAt=1`);
  expect(result.listings.map(({ id }) => id)).toEqual(['realny:221784']);
  expect(REALNY_LIVE.listingUrl(result.listings[0]?.sources[0]?.url)).toBeTruthy();
});
