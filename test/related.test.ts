import { expect, test } from 'bun:test';
import {
  RELATED_LIVE,
  parseRelatedBuildings,
  parseRelatedSearch,
  relatedListing,
  relatedListingUrl,
  relatedSearchUrl,
} from '../server/sources/related.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.relatedrentals.com';
const TATE = `${ORIGIN}/apartment-rentals/new-york-city/chelsea/the-tate`;
const card = (slug: string, id: string, bedrooms: string, price: string, extra = '') =>
  `<article class="node node--type-unit node--view-mode-teaser" data-api-id="${id}" data-price="${price}" data-dimension6="${bedrooms}" ${extra}>
   <a href="/apartment-rentals/new-york-city/chelsea/the-tate/${slug}-${id}" class="field-group-link">x</a></article>`;
const searchPage = (cards: string[], lastPage = 0) =>
  `<form id="views-exposed-form-unit-solr-search-full-search"></form><article class="node node--type-page">x</article>${cards.join('')}` +
  (lastPage ? `<a href="?city=x&amp;page=0">1</a><a href="?city=x&amp;page=${lastPage}">last</a>` : '');
const buildingPage = (places: unknown) =>
  `<script type="application/json" data-drupal-selector="drupal-settings-json">${JSON.stringify({ relatedData: { 'map-properties': places } })}</script>`;
const tate = {
  address: '535 West 23rd Street, New York, NY 10011',
  page_url: '/apartment-rentals/new-york-city/chelsea/the-tate',
  lat: 40.748,
  lon: -74.005,
};
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('Related reads apartment cards and the last page from its search', () => {
  const { cards, lastPage } = parseRelatedSearch(
    searchPage(
      [card('alcove-studio-1-bath', '27069', '0.5', '6350', 'data-dimension7="1.0"'), card('2-bedroom-2-bath', '27100', '2.0', '9000')],
      5,
    ),
  );
  expect(lastPage).toBe(5);
  expect(cards).toEqual([
    { id: '27069', url: `${TATE}/alcove-studio-1-bath-27069`, building: TATE, bedrooms: 0.5, bathrooms: 1, rent: 6350 },
    { id: '27100', url: `${TATE}/2-bedroom-2-bath-27100`, building: TATE, bedrooms: 2, bathrooms: NaN, rent: 9000 },
  ]);
  expect(parseRelatedSearch(searchPage([], 99)).lastPage).toBe(29);
  expect(() => parseRelatedSearch('<html></html>')).toThrow('recognized search page');
  expect(() => parseRelatedSearch(searchPage([card('studio', '1', '0', 'call')]))).toThrow('did not fully describe');
});

test('Related buildings come from the map data on a building page, five boroughs only', () => {
  const buildings = parseRelatedBuildings(
    buildingPage([
      tate,
      { address: '135 Clarendon Street , Boston, MA 02116', page_url: '/apartment-rentals/boston/back-bay/one-back-bay' },
      { address: 'Somewhere', page_url: '/x' },
      { page_url: '/y' },
      'not a building',
    ]),
  );
  expect([...buildings]).toEqual([
    [TATE, { address: '535 West 23rd Street', zip: '10011', city: 'Manhattan', latitude: 40.748, longitude: -74.005 }],
  ]);
  expect(() => parseRelatedBuildings('<html></html>')).toThrow('addresses');
  expect(() => parseRelatedBuildings(buildingPage(null))).toThrow('addresses');
});

test('Related listings use the building address and whole bedrooms', () => {
  const buildings = parseRelatedBuildings(buildingPage([tate]));
  const base = { id: '27069', url: `${TATE}/alcove-studio-1-bath-27069`, building: TATE, bathrooms: 1, rent: 6350 };
  expect(relatedListing({ ...base, bedrooms: 0.5 }, buildings, at)).toMatchObject({
    id: 'related:27069',
    address: '535 West 23rd Street',
    unit: '',
    city: 'Manhattan',
    zip: '10011',
    bedrooms: 0,
    bathrooms: 1,
    rent: 6350,
    region: 'nyc',
    seenAt: at,
  });
  expect(relatedListing({ ...base, bedrooms: 1.5, bathrooms: NaN }, buildings, at)).toMatchObject({ bedrooms: 1, bathrooms: null });
  expect(relatedListing({ ...base, bedrooms: 1, building: `${ORIGIN}/elsewhere` }, buildings, at)).toBeNull();
  expect(relatedListingUrl(`${TATE}/alcove-studio-1-bath-27069?x`)).toBe(`${TATE}/alcove-studio-1-bath-27069`);
  expect(relatedListingUrl(TATE)).toBeNull();
});

test('Related loads the first search page, a building page, then the other search pages', async () => {
  const site: Record<string, string> = {
    [relatedSearchUrl(0)]: searchPage([card('studio', '1', '0', '4000')], 2),
    [TATE]: buildingPage([tate]),
    [relatedSearchUrl(1)]: searchPage([card('studio', '1', '0', '4000'), card('1-bedroom', '2', '1', '5000')], 2),
  };
  const requested: string[] = [];
  const fetcher: FetchTransport = async (url) => {
    requested.push(url);
    return site[url] ? html(site[url]) : html('gone', 500);
  };
  const result = await RELATED_LIVE.load(fetcher, new Date(at));
  expect(requested).toEqual([relatedSearchUrl(0), TATE, relatedSearchUrl(1), relatedSearchUrl(2)]);
  expect(result).toMatchObject({ pages: 3, partial: true, requestedPages: 4, failedPages: 1 });
  expect(result.listings.map(({ id }) => id)).toEqual(['related:1', 'related:2']);

  site[relatedSearchUrl(0)] = searchPage([card('studio', '1', '0', '4000')]);
  expect(await RELATED_LIVE.load(fetcher, new Date(at))).toEqual({ listings: [expect.objectContaining({ id: 'related:1' })], pages: 2 });

  site[relatedSearchUrl(0)] = searchPage([card('studio', '1', '0', '4000')], 1);
  expect(await RELATED_LIVE.load(fetcher, new Date(at))).toMatchObject({ pages: 3 });
  expect((await RELATED_LIVE.load(fetcher, new Date(at))).partial).toBeUndefined();

  site[relatedSearchUrl(0)] = searchPage([]);
  await expect(RELATED_LIVE.load(fetcher, new Date(at))).rejects.toThrow('no New York City apartments');
});
