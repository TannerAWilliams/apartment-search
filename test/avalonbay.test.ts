import { expect, test } from 'bun:test';
import type { FetchTransport } from '../src/fetch-type.ts';
import {
  AVALONBAY_LIVE,
  avalonbayListingUrl,
  parseAvalonCommunities,
  parseAvalonCommunity,
  streetAddress,
} from '../server/sources/avalonbay.ts';

const at = '2026-11-24T00:00:00.000Z';
const ORIGIN = 'https://www.avaloncommunities.com';
const page = (content: unknown) => `<html><script>Fusion.globalContent=${JSON.stringify(content)};Fusion.x=1</script></html>`;
const statePage = (items: unknown) => page({ communityResults: { communities: { itemsCount: 3, items } } });
const community = (path: string, zip: string) => ({ url: path, address: { zip } });
const unit = (overrides: Record<string, unknown> = {}) => ({
  unitId: 'AVB-NY533-001-014P',
  unitName: '014P',
  address: { addressLine1: '515 W 52nd St. #014P', zip: '10019' },
  bedroomNumber: 0,
  bathroomNumber: 1,
  squareFeet: 481,
  unitStatus: 'VacantAvailable',
  url: `${ORIGIN}/new-york/new-york-city-apartments/avalon-clinton/apartment/NY533-NY533-001-014P`,
  startingAtPricesUnfurnished: { prices: { price: 3831, totalPrice: 3921 } },
  ...overrides,
});
const communityPage = (units: unknown, extra: Record<string, unknown> = {}) =>
  page({ coordinates: { latitude: 40.7665, longitude: -73.9916 }, units, ...extra });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

test('AvalonBay reads its own New York City community pages and skips other places and linked-out buildings', () => {
  expect(
    parseAvalonCommunities(
      statePage([
        community('/new-york/new-york-city-apartments/avalon-clinton', '10019'),
        community('/new-york/brooklyn-apartments/ava-dobro/', '11201'),
        community('/new-york/brooklyn-apartments/ava-dobro', '11201'),
        community('/new-york/yonkers-apartments/avalon-yonkers', '10701'),
        community('https://equityapartments.com/new-york-city/chelsea/beatrice-apartments', '10001'),
        { url: '/new-york/queens-apartments/no-address' },
        'not a community',
      ]),
    ),
  ).toEqual([
    { url: `${ORIGIN}/new-york/new-york-city-apartments/avalon-clinton/` },
    { url: `${ORIGIN}/new-york/brooklyn-apartments/ava-dobro/` },
  ]);
  expect(() => parseAvalonCommunities('<html></html>')).toThrow('recognized New York page');
  expect(() => parseAvalonCommunities(page({ communityResults: {} }))).toThrow('did not list');
});

test('AvalonBay lists each available unit with its street address, borough and rent', () => {
  const listings = parseAvalonCommunity(
    communityPage([
      unit(),
      unit({
        unitId: 'AVB-NY011-002-405',
        unitName: '405',
        address: { addressLine1: '4-75 48th Avenue 405', zip: '11109' },
        bedroomNumber: 2,
        unitStatus: 'NoticeAvailable',
        url: `${ORIGIN}/new-york/long-island-city-apartments/avalon-riverview/apartment/NY011-405`,
      }),
      // Left out: not available, outside the five boroughs, no address, no rent, five bedrooms, an unexpected link.
      unit({ unitId: 'a', unitStatus: 'Leased' }),
      unit({ unitId: 'b', address: { addressLine1: '1 Main St #1', zip: '10701' } }),
      unit({ unitId: 'c', address: null }),
      unit({ unitId: 'd', startingAtPricesUnfurnished: null }),
      unit({ unitId: 'e', startingAtPricesUnfurnished: { prices: null } }),
      unit({ unitId: 'f', bedroomNumber: 5 }),
      unit({ unitId: 'g', url: 'https://equityapartments.com/x' }),
      'not a unit',
    ]),
    { url: '' },
    at,
  );
  expect(
    listings.map(({ id, address, unit, city, zip, rent, bedrooms, region }) => ({ id, address, unit, city, zip, rent, bedrooms, region })),
  ).toEqual([
    {
      id: 'avalonbay:AVB-NY533-001-014P',
      address: '515 W 52nd St.',
      unit: '014P',
      city: 'Manhattan',
      zip: '10019',
      rent: 3831,
      bedrooms: 0,
      region: 'nyc',
    },
    {
      id: 'avalonbay:AVB-NY011-002-405',
      address: '4-75 48th Avenue',
      unit: '405',
      city: 'Queens',
      zip: '11109',
      rent: 3831,
      bedrooms: 2,
      region: 'nyc',
    },
  ]);
  expect(listings[0]).toMatchObject({ latitude: 40.7665, longitude: -73.9916, seenAt: at, kind: 'feed' });
  // Communities that show the total price list that instead; pages without coordinates still list units.
  const [total] = parseAvalonCommunity(page({ useTotalPrice: true, units: [unit()] }), { url: '' }, at);
  expect(total).toMatchObject({ rent: 3921 });
  expect(total.latitude).toBeNaN();
  expect(() => parseAvalonCommunity(page({}), { url: '' }, at)).toThrow('did not list');
  expect(() => parseAvalonCommunity('', { url: '' }, at)).toThrow('recognized community page');
});

test('AvalonBay unit addresses and links', () => {
  expect(streetAddress('11 East First St. Apt #406', '406')).toBe('11 East First St.');
  expect(streetAddress('343 Gold Street Apartment 12A', '12A')).toBe('343 Gold Street');
  expect(streetAddress('100 Willoughby Street', '7J')).toBe('100 Willoughby Street');
  expect(streetAddress('1 Main St Unit (B)', '(B)')).toBe('1 Main St');
  expect(avalonbayListingUrl(`${ORIGIN}/new-york/brooklyn-apartments/ava-dobro/apartment/NY037-7J?x=1`)).toBe(
    `${ORIGIN}/new-york/brooklyn-apartments/ava-dobro/apartment/NY037-7J`,
  );
  expect(avalonbayListingUrl(`${ORIGIN}/new-york/brooklyn-apartments/ava-dobro/`)).toBeNull();
});

test('AvalonBay loads the New York page, then each community page', async () => {
  const requested: string[] = [];
  const fetcher = (async (url: string) => {
    requested.push(url);
    if (url === `${ORIGIN}/new-york/`)
      return html(
        statePage([
          community('/new-york/new-york-city-apartments/avalon-clinton', '10019'),
          community('/new-york/brooklyn-apartments/ava-dobro', '11201'),
        ]),
      );
    if (url.endsWith('/avalon-clinton/')) return html(communityPage([unit()]));
    return html('gone', 500);
  }) as FetchTransport;
  const result = await AVALONBAY_LIVE.load(fetcher, new Date(at));
  expect(requested).toEqual([
    `${ORIGIN}/new-york/`,
    `${ORIGIN}/new-york/new-york-city-apartments/avalon-clinton/`,
    `${ORIGIN}/new-york/brooklyn-apartments/ava-dobro/`,
  ]);
  expect(result).toMatchObject({ pages: 2, partial: true, requestedPages: 3, failedPages: 1 });
  expect(result.listings).toHaveLength(1);

  const complete = await AVALONBAY_LIVE.load(
    (async (url: string) =>
      html(
        url.endsWith('/new-york/')
          ? statePage([community('/new-york/new-york-city-apartments/avalon-clinton', '10019')])
          : communityPage([unit()]),
      )) as FetchTransport,
    new Date(at),
  );
  expect(complete).toEqual({ listings: complete.listings, pages: 2 });

  await expect(AVALONBAY_LIVE.load((async () => html(statePage([]))) as FetchTransport, new Date(at))).rejects.toThrow(
    'no New York City communities',
  );
});
