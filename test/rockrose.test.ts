import { expect, test } from 'bun:test';
import { ROCKROSE_LIVE, parseRockroseAvailabilities, rockroseListingUrl } from '../server/sources/rockrose.ts';

const at = new Date('2026-11-24T00:00:00.000Z');
const card = ({
  id = '47080',
  price = '3991.16',
  place = '43-10 Crescent Street,<br>Queens, NY 11101',
  unit = '#2317',
  size = 'Studio, 1 Bath',
  slug = '2317',
} = {}) => `<li class='col-xs-12 col-s-6 grid-item my17'
     data-price='${price}'
     data-id='${id}'
     data-lat='40.74872'
     data-lng='-73.94283'>
    <header><a href="https://rockrose.com/listing/${slug}/" class="uppercase save-availabilities-order" aria-label="View">x</a></header>
    <div class="address-wrapper">
        <span class='address'>${place}</span>
        <span class='address'>${unit}</span>
    </div>
    <ul><li class='price'>$3,991</li><li class='size'>
        ${size}                </li></ul>
</li>
`;
const page = (cards: string[]) =>
  `<html><section class="grid"><ul class='row' id='availabilities-grid'>\n${cards.join('')}</ul>\n</section>` +
  `<script type="text/template"><span class='address'><%= address %></span></script></html>`;
const respond = (html: string) => async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });

test('Rockrose reads every apartment card on its availabilities page', async () => {
  const html = page([
    card(),
    card({
      id: '212750',
      price: '6545.00',
      place: '47-05 Center Blvd,<br>Queens, NY 11109',
      unit: '#508',
      size: '2 Bedroom, 2 Bath',
      slug: '508-7',
    }),
    card({
      id: '3',
      price: '5395',
      place: '110 Horatio &#038; Street,<br>Manhattan, NY 10014',
      unit: '#PH-19',
      size: '1 Bedroom',
      slug: 'ph-19',
    }),
    // Left out: a size with no bedroom count, a loft, and an address outside the five boroughs.
    card({ id: '4', size: 'Flex 2, 1 Bath', slug: '1101-4' }),
    card({ id: '5', size: 'Loft, 2 Bath', slug: '515-2' }),
    card({ id: '6', place: '1 Main Street,<br>Jersey City, NY 07302', slug: 'jc' }),
  ]);
  const result = await ROCKROSE_LIVE.load(respond(html), at);
  expect(result).toMatchObject({ pages: 1, total: 6, rawCount: 6, transport: 'rockrose-availabilities-page', checkedAt: at.toISOString() });
  expect(
    result.listings.map((listing) => [
      listing.id,
      listing.address,
      listing.unit,
      listing.city,
      listing.zip,
      listing.bedrooms,
      listing.bathrooms,
      listing.rent,
    ]),
  ).toEqual([
    ['rockrose:47080', '43-10 Crescent Street', '2317', 'Queens', '11101', 0, 1, 3991.16],
    ['rockrose:212750', '47-05 Center Blvd', '508', 'Queens', '11109', 2, 2, 6545],
    ['rockrose:3', '110 Horatio & Street', 'PH-19', 'Manhattan', '10014', 1, null, 5395],
  ]);
  expect(result.listings[0]).toMatchObject({
    region: 'nyc',
    kind: 'feed',
    latitude: 40.74872,
    longitude: -73.94283,
    seenAt: at.toISOString(),
  });
  expect(result.listings.every((listing) => ROCKROSE_LIVE.listingUrl(listing.sources[0].url))).toBe(true);
});

test('Rockrose refuses a page it does not recognize or an apartment it did not fully describe', () => {
  expect(() => parseRockroseAvailabilities('<html>Just a moment</html>')).toThrow('did not return a recognized');
  expect(() => parseRockroseAvailabilities(page([]))).toThrow('did not list any apartments');
  for (const broken of [{ price: 'call' }, { id: 'x' }, { place: 'Somewhere' }, { unit: '2317' }, { slug: 'Bad Slug' }, { size: '' }])
    expect(() => parseRockroseAvailabilities(page([card(broken)]))).toThrow('did not fully describe');
});

test('Rockrose links only to its own listing pages', () => {
  expect(rockroseListingUrl('https://rockrose.com/listing/2813-4/')).toBe('https://rockrose.com/listing/2813-4/');
  expect(rockroseListingUrl('https://rockrose.com/listing/2813-4')).toBeNull();
  expect(rockroseListingUrl('https://example.com/listing/2813-4/')).toBeNull();
  expect(rockroseListingUrl(7)).toBeNull();
});
