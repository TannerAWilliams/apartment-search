import { expect, test } from 'bun:test';
import { MNS_LIVE, mnsListingUrl, parseMnsRentals } from '../server/sources/mns.ts';

const at = '2026-11-24T00:00:00.000Z';
const card = ({
  id = '143806',
  address = '350  Albany ST',
  zip = '10280',
  bed = '1',
  bath = '1',
  sq = '754',
  price = '4995.00',
  hood = 'Battery Park City',
  href = 'https://www.mns.com/details/143806/rental/battery+park+city/manhattan',
  unit = ', 15F',
} = {}) => `<div class="listings_card" data-name="Hudson Tower" data-address="${address}" data-hood="${hood}" id="${id}" bed="${bed}" bath="${bath}"
  hood="${hood}" price="${price}" property="Mid Rise" sq="${sq}" whole="Hudson Tower ${hood} New York ${zip} ${address}" title="x">
  <a href="${href}" class="bg_style listings_pic"></a>
  <div class="list_bar_info"><h3>${hood}</h3>
  <h3>${address}${unit}</h3></div></div>`;
const page = (...cards: string[]) => `<html><body>${cards.join('\n')}</body></html>`;

test('MNS listing cards become listings with their ZIP code, unit and size', () => {
  const listings = parseMnsRentals(
    page(
      card(),
      // A 1.5 bedroom counts as one bedroom; no size or bath; an apostrophe in the neighborhood; no unit.
      card({
        id: '241073',
        address: '306  W 48 ST',
        zip: '10036',
        bed: '1.5',
        bath: '',
        sq: '',
        hood: 'Hell&#039;s Kitchen',
        href: 'https://www.mns.com/details/241073/rental/_/_',
        unit: '',
      }),
      // Left out: outside NYC, a ZIP code that belongs to another address, an unexpected link, no street number,
      // a non-numeric id, and five bedrooms.
      card({ id: '1', zip: '07302' }),
      card({ id: '2' }).replace('New York 10280 350  Albany ST', 'New York 10280 1 Other ST'),
      card({ id: '3', href: 'https://example.com/details/3/rental/a/b' }),
      card({ id: '4', address: 'Albany ST' }),
      card({ id: 'x' }),
      card({ id: '5', bed: '5' }),
    ),
    null,
    at,
  );
  expect(listings.map(({ id, address, unit, city, zip, bedrooms, rent }) => ({ id, address, unit, city, zip, bedrooms, rent }))).toEqual([
    { id: 'mns:143806', address: '350 Albany ST', unit: '15F', city: 'Manhattan', zip: '10280', bedrooms: 1, rent: 4995 },
    { id: 'mns:241073', address: '306 W 48 ST', unit: '', city: 'Manhattan', zip: '10036', bedrooms: 1, rent: 4995 },
  ]);
  expect(listings[0]).toMatchObject({ bathrooms: 1, squareFeet: 754, neighborhood: 'Battery Park City', region: 'nyc' });
  expect(listings[0]?.sources[0]?.url).toBe('https://www.mns.com/details/143806/rental/battery+park+city/manhattan');
  expect(listings[1]).toMatchObject({ bathrooms: null, squareFeet: null, neighborhood: "Hell's Kitchen" });
  expect(() => parseMnsRentals('<html></html>', null, at)).toThrow(/recognized rentals page/);
  expect(mnsListingUrl('https://www.mns.com/details/1/rental/kip%27s+bay/manhattan')).toBe(
    'https://www.mns.com/details/1/rental/kip%27s+bay/manhattan',
  );
  expect(mnsListingUrl('https://www.mns.com/details/1/sale/a/b')).toBeNull();
});

test('MNS reads its one rentals page', async () => {
  const requested: string[] = [];
  const result = await MNS_LIVE.load(async (url) => {
    requested.push(url);
    return new Response(page(card()), { headers: { 'content-type': 'text/html' } });
  }, new Date(at));
  expect(requested).toEqual(['https://www.mns.com/mns_listings/rent']);
  expect(result).toMatchObject({ pages: 1 });
  expect(result.listings).toHaveLength(1);
});
