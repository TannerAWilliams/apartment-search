import { expect, test } from 'bun:test';
import { parseRealtyMxAreas } from '../server/sources/realny.ts';
import { TRIBRO_LIVE, grossRent, parseTriBroPage, tribroListingUrl } from '../server/sources/tribro.ts';

const at = new Date('2026-11-25T00:00:00.000Z');
const ORIGIN = 'https://tribronyc.com';
/** TriBro's rentals search as it was on 2026-11-25, trimmed to its neighborhood filter, ten cards and its pagination. */
const PAGE = await Bun.file(new URL('./fixtures/tribro-rentals.html', import.meta.url)).text();
/** The Census geocoder's answers for the fixture's streets, as it gave them on 2026-11-25 (30 Road, Astoria, it does not find). */
const CENSUS: Record<string, string> = {
  '129 RUSSELL STREET': '"Match","Exact","129 RUSSELL ST, BROOKLYN, NY, 11222","-73.944467276413,40.724966983794","59076944","L"',
  '395 SMITH STREET': '"Match","Exact","395 SMITH ST, BROOKLYN, NY, 11231","-73.995885466483,40.678488456536","59075285","L"',
  '461 LEXINGTON AVENUE': '"Match","Exact","461 LEXINGTON AVE, BROOKLYN, NY, 11221","-73.943626942652,40.68857605756","59079168","L"',
  '437 FRANKLIN AVENUE': '"Match","Exact","437 FRANKLIN AVE, BROOKLYN, NY, 11238","-73.956157452451,40.683948990188","59078815","L"',
  '1112 FULTON STREET': '"Match","Exact","1112 FULTON ST, BROOKLYN, NY, 11238","-73.956458339485,40.681240795045","59078824","R"',
  '2033 1ST AVENUE': '"Match","Exact","2033 1ST AVE, NEW YORK, NY, 10029","-73.940662776596,40.788926500834","59658188","L"',
};
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html;charset=UTF-8' } });

test('TriBro NYC: available rentals with a street number from its own search, at the gross rent', async () => {
  const requested: string[] = [];
  let census = '';
  const result = await TRIBRO_LIVE.load(async (url, init) => {
    requested.push(url);
    if (!url.startsWith('https://geocoding.geo.census.gov/')) return html(PAGE.replace('627 records found', '10 records found'));
    census = await ((init?.body as FormData).get('addressFile') as Blob).text();
    return new Response(
      census
        .split('\n')
        .map((row) => {
          const [id, street] = row.slice(1, -1).split('","');
          return CENSUS[street] ? `"${id}","x",${CENSUS[street]}` : `"${id}","x","No_Match"`;
        })
        .join('\n'),
    );
  }, at);
  // Its "available" rentals (status 2; 21 adds those with an application pending), 500 cards a page.
  expect(requested).toEqual([
    `${ORIGIN}/index.cfm?page=properties&status=2&isCompany=1&isMLS=1&maxRows=500&startAt=1`,
    'https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
  ]);
  // Left out before the Census: a hidden building number (East 82nd Street) and an application pending (#1D).
  expect(census.split('\n').map((row) => row.split('","').slice(1, 3).join(', '))).toEqual([
    '129 RUSSELL STREET, Brooklyn',
    '129 RUSSELL STREET, Brooklyn',
    '395 SMITH STREET, Brooklyn',
    '461 LEXINGTON AVENUE, Brooklyn',
    '30 ROAD, Astoria',
    '437 FRANKLIN AVENUE, Brooklyn',
    '1112 FULTON STREET, Brooklyn',
    '2033 1ST AVENUE, New York',
  ]);
  expect(result).toMatchObject({ pages: 1, total: 10, rawCount: 8, checkedAt: at.toISOString() });
  expect(
    result.listings.map(({ id, address, unit, city, zip, neighborhood, bedrooms, bathrooms, rent }) => [
      id,
      address,
      unit,
      city,
      zip,
      neighborhood,
      bedrooms,
      bathrooms,
      rent,
    ]),
  ).toEqual([
    ['tribro:2174', '129 RUSSELL STREET', '3B', 'Brooklyn', '11222', 'Greenpoint', 4, 2, 11800],
    // Advertised at $9,286 net effective with one month free on a 14-month lease.
    ['tribro:2403', '129 RUSSELL STREET', '1S', 'Brooklyn', '11222', 'Greenpoint', 3, 2.5, 10000],
    // A condo for rent is a rental.
    ['tribro:2542', '395 SMITH STREET', '3C', 'Brooklyn', '11231', 'Carroll Gardens', 3, 2, 6895],
    // A card that names only its borough.
    ['tribro:2638', '461 LEXINGTON AVENUE', '4', 'Brooklyn', '11221', 'Brooklyn', 3, 2, 7000],
    ['tribro:2497', '437 FRANKLIN AVENUE', '4A', 'Brooklyn', '11238', 'Bedford Stuyvesant', 1, 1, 3500],
    ['tribro:2204', '1112 FULTON STREET', '5A', 'Brooklyn', '11238', 'Bedford Stuyvesant', 0, 1, 2850],
    ['tribro:1263', '2033 1ST AVENUE', '6 FLOOR', 'Manhattan', '10029', 'East Harlem', 3, 1, 2700],
  ]);
  expect(result.listings[0]).toMatchObject({ company: 'TriBro NYC', latitude: 40.724966983794, region: 'nyc', kind: 'feed' });
  // TriBro's cards give no posting date.
  expect(result.listings[0]?.listedAt).toBeUndefined();
  expect(result.listings[0]?.sources[0]).toMatchObject({
    id: 'tribro',
    url: `${ORIGIN}/greenpoint/apartment-for-rent/129-russell-street-3b/2174`,
  });
});

test('TriBro NYC neighborhoods take their borough from its search filter', () => {
  const areas = parseRealtyMxAreas(PAGE);
  expect([areas.get('Greenpoint'), areas.get('East Harlem'), areas.get('Astoria'), areas.get('Baychester'), areas.get('Brooklyn')]).toEqual(
    ['Brooklyn', 'Manhattan', 'Queens', 'Bronx', 'Brooklyn'],
  );
});

test('TriBro NYC cards that are not homes for rent or not fully described are left out', () => {
  const first = PAGE.slice(PAGE.indexOf('<div class="property-card'), PAGE.indexOf('</article>') + '</article>\n\t\t</div>'.length);
  const page = (...cards: string[]) => `<html>${cards.join('\n')}<h3>${cards.length} records found</h3></html>`;
  const variant = (from: string, to: string) => first.replaceAll(from, to);
  const { total, cards } = parseTriBroPage(
    page(
      variant('<span>Apartment</span>', '<span>Retail</span>'),
      variant('<span>$11,800</span>', '<span>Call</span>'),
      variant('/greenpoint/apartment-for-rent/', '/greenpoint/apartment-for-sale/'),
      variant('data-pid="2174"', 'data-pid=""'),
      variant('<span class="search-featured-card-location-label">Greenpoint</span>', ''),
      variant('<span>4 BR</span>', '<span>Loft</span>'),
      // Six bedrooms count as four; a card without baths keeps its bedrooms.
      variant('<span>4 BR</span>', '<span>6 BR</span>').replace('data-pid="2174"', 'data-pid="1"'),
      variant('<span>2 BT</span>', '').replace('data-pid="2174"', 'data-pid="2"'),
    ),
    tribroListingUrl,
    'TriBro NYC',
  );
  expect(total).toBe(8);
  expect(cards.map(({ id, bedrooms, bathrooms }) => [id, bedrooms, bathrooms])).toEqual([
    ['1', 4, 2],
    ['2', 4, Number.NaN],
  ]);
  expect(() => parseTriBroPage('<html></html>', tribroListingUrl, 'TriBro NYC')).toThrow('recognized rentals search page');
});

test('A net effective rent becomes the gross rent only when its concession can be read', () => {
  expect(grossRent(8098, '0.5 Month Free w/12 Month Lease')).toBe(8450);
  expect(grossRent(7995, '1.5 Months Free w/14 Month Lease')).toBe(8954);
  expect(grossRent(5000, 'Ask about our specials')).toBeNull();
  expect(grossRent(5000, '12 Months Free w/12 Month Lease')).toBeNull();
  expect(grossRent(5000, '0 Months Free w/12 Month Lease')).toBeNull();
  // A card marked NER without a readable concession keeps its advertised rent.
  const { cards } = parseTriBroPage(PAGE.replace('1 Month Free w/14 Month Lease', 'Free month'), tribroListingUrl, 'TriBro NYC');
  expect(cards.find(({ id }) => id === '2403')?.rent).toBe(9286);
});

test('TriBro NYC links only to its own rental pages', () => {
  expect(tribroListingUrl(`${ORIGIN}/chelsea/condo-for-rent/west-22nd-street/1893`)).toBe(
    `${ORIGIN}/chelsea/condo-for-rent/west-22nd-street/1893`,
  );
  for (const url of [
    `${ORIGIN}/chinatown/condo-for-sale/60-henry-street-9d/2009`,
    `${ORIGIN}/greenpoint/apartment/129-russell-street-1d/2175`,
    `${ORIGIN}/images/2174.jpg`,
    'https://evil.example/greenpoint/apartment-for-rent/129-russell-street-3b/2174',
  ])
    expect(tribroListingUrl(url), url).toBeNull();
});
