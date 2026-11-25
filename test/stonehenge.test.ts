import { expect, test } from 'bun:test';
import { STONEHENGE_LIVE, parseStonehengeApartments, stonehengeListingUrl } from '../server/sources/stonehenge.ts';

const at = new Date('2026-11-25T00:00:00.000Z');
/** stonehengenyc.com/apartments as it was on 2026-11-25, trimmed to eight of its cards. */
const PAGE = await Bun.file(new URL('./fixtures/stonehenge-apartments.html', import.meta.url)).text();
/** The Census geocoder's answers for the fixture's buildings, as it gave them on 2026-11-25. */
const CENSUS: Record<string, string> = {
  '101 West 15th Street': '"Match","Exact","101 W 15TH ST, NEW YORK, NY, 10011","-73.996366385437,40.738121891266","611131323","R"',
  '165 East 66th Street': '"Match","Exact","165 E 66TH ST, NEW YORK, NY, 10065","-73.963933614067,40.766211517574","59657466","L"',
  '42-20 24th Street': '"Match","Exact","42-20 24TH ST, LONG ISLAND CITY, NY, 11101","-73.941938932082,40.750485895517","59729884","R"',
  '364 West 18th Street': '"Match","Exact","364 W 18TH ST, NEW YORK, NY, 10011","-74.002573503225,40.742975152905","59659738","L"',
  '340 East 51 Street': '"Match","Exact","340 E 51ST ST, NEW YORK, NY, 10022","-73.967122723791,40.755041054141","59658727","R"',
  // Placed in another borough than its neighborhood: left out.
  '360 East 65th Street': '"Match","Exact","360 E 65TH ST, BROOKLYN, NY, 11220","-74.01,40.64","1","R"',
};
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

function site(page = PAGE) {
  const requested: string[] = [];
  let census = '';
  const fetcher = async (url: string, init?: RequestInit) => {
    requested.push(url);
    if (!url.startsWith('https://geocoding.geo.census.gov/')) return html(page);
    census = await ((init?.body as FormData).get('addressFile') as Blob).text();
    return new Response(
      census
        .split('\n')
        .map((row) => {
          const id = row.split('","')[0].slice(1);
          return CENSUS[id] ? `"${id}","x",${CENSUS[id]}` : `"${id}","x","No_Match"`;
        })
        .join('\n'),
    );
  };
  return { fetcher, requested, census: () => census };
}

test('Stonehenge: every apartment on its own apartments page, placed by the Census', async () => {
  const { fetcher, requested, census } = site();
  const result = await STONEHENGE_LIVE.load(fetcher, at);
  // Only the apartments page (no query string, which robots.txt disallows) and one Census request.
  expect(requested).toEqual([
    'https://www.stonehengenyc.com/apartments',
    'https://geocoding.geo.census.gov/geocoder/locations/addressbatch',
  ]);
  // One lookup a building; Long Island City is a Queens postal name.
  expect(census().split('\n')).toEqual([
    '"101 West 15th Street","101 West 15th Street","New York","NY",""',
    '"165 East 66th Street","165 East 66th Street","New York","NY",""',
    '"42-20 24th Street","42-20 24th Street","Long Island City","NY",""',
    '"364 West 18th Street","364 West 18th Street","New York","NY",""',
    '"340 East 51 Street","340 East 51 Street","New York","NY",""',
    '"360 East 65th Street","360 East 65th Street","New York","NY",""',
  ]);
  // Each card is shown twice (list and map views) but counted once.
  expect(result).toMatchObject({ pages: 1, total: 6, rawCount: 6, transport: 'stonehenge-apartments-page', checkedAt: at.toISOString() });
  expect(result.listings.map(({ id, address, unit, city, zip, bedrooms, rent }) => [id, address, unit, city, zip, bedrooms, rent])).toEqual(
    [
      ['stonehenge:555sixth-110', '101 West 15th Street', '110', 'Manhattan', '10011', 0, 5595],
      ['stonehenge:165e66ow-02d', '165 East 66th Street', '02D', 'Manhattan', '10065', 2, 12795],
      ['stonehenge:oneqps-030a', '42-20 24th Street', '030A', 'Queens', '11101', 1, 4623],
      ['stonehenge:364w18st-006g', '364 West 18th Street', '006G', 'Manhattan', '10011', 1, 6195],
      ['stonehenge:340e51ow-phb', '340 East 51 Street', 'PHB', 'Manhattan', '10022', 4, 17500],
    ],
  );
  expect(result.listings[2]).toMatchObject({
    neighborhood: 'Long Island City',
    bathrooms: 1,
    squareFeet: 695,
    latitude: 40.750485895517,
    longitude: -73.941938932082,
    company: 'Stonehenge NYC',
    kind: 'feed',
    region: 'nyc',
    seenAt: at.toISOString(),
  });
  // The site gives no posting date.
  expect(result.listings[2]?.listedAt).toBeUndefined();
  expect(result.listings[0]?.sources[0]).toMatchObject({ id: 'stonehenge', url: 'https://www.stonehengenyc.com/apartments/555sixth-110' });
});

test('Stonehenge: cards that are not apartments or are not fully described are left out', () => {
  const cards = parseStonehengeApartments(
    PAGE.replaceAll('/apartments/555sixth-110', '/commercial-unit/108w15stst1')
      .replace('>$12,795<', '>Call<')
      .replaceAll('>42-20 24th Street<', '>24th Street<')
      .replaceAll('>4 Bedroom<', '>Penthouse<')
      .replaceAll('>1.5<', '><'),
  );
  expect(cards.map(({ id }) => id)).toEqual(['364w18st-006g', 'east65ow-008d']);
  expect(cards[1]?.bathrooms).toBeNaN();
  // Five bedrooms count as four, the most the app tells apart.
  expect(parseStonehengeApartments(PAGE.replace('>4 Bedroom<', '>5 Bedrooms<')).find(({ id }) => id === '340e51ow-phb')?.bedrooms).toBe(4);
});

test('Stonehenge: an unrecognized page, or one as full as a Webflow list gets, saves nothing', async () => {
  expect(() => parseStonehengeApartments('<html></html>')).toThrow('recognized apartments page');
  const card = PAGE.slice(
    PAGE.indexOf('<div role="listitem"'),
    PAGE.indexOf('<div role="listitem"', PAGE.indexOf('<div role="listitem"') + 1),
  );
  const full = Array.from({ length: 100 }, (_, index) => card.replaceAll('555sixth-110', 'unit-' + index)).join('');
  expect(() => parseStonehengeApartments(full)).toThrow('more apartments than its page shows');
  await expect(STONEHENGE_LIVE.load(site('<html></html>').fetcher, at)).rejects.toThrow('recognized apartments page');
});

test('Stonehenge links only to its own apartment pages, without query strings', () => {
  expect(stonehengeListingUrl('https://www.stonehengenyc.com/apartments/141e33st-003a')).toBe(
    'https://www.stonehengenyc.com/apartments/141e33st-003a',
  );
  expect(stonehengeListingUrl('/apartments/141e33st-003a?building=141e33st')).toBe(
    'https://www.stonehengenyc.com/apartments/141e33st-003a',
  );
  for (const url of [
    'https://www.stonehengenyc.com/commercial-unit/108w15stst1',
    'https://www.stonehengenyc.com/apartments',
    'https://www.stonehengenyc.com/apartments/a/b',
    'https://stonehengenyc.com/apartments/141e33st-003a',
    'https://evil.example/apartments/141e33st-003a',
  ])
    expect(stonehengeListingUrl(url), url).toBeNull();
});
