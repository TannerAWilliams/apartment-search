import { expect, test } from 'bun:test';
import { loadTfc, parseTfcFeed, TFC_LIVE, tfcListingUrl } from '../server/sources/tfc.ts';

const at = '2026-11-24T00:00:00.000Z';
const building = { MarketingPropertyCode: '45WAA1', Address: '45 Wall St', Zip: '10005', Latitude: 40.706, Longitude: -74.01 };
const unit = (overrides: Record<string, unknown> = {}) => ({
  Code: '45WAA1::2203',
  MarketingPropertyCode: '45WAA1',
  Apartment: '2203',
  NumBedrooms: 1,
  NumBathrooms: 1,
  Neighborhood: 'Financial District',
  Price: 5152,
  GrossRent: 5455,
  IsListed: true,
  WebUrl: 'https://tfc.com/financial-district-luxury-no-fee-apartments/45-wall-street/apt-2203',
  ...overrides,
});
const feed = (units: unknown[], properties: unknown[] = [building]) => ({ Properties: { Data: properties }, Units: { Data: units } });

test('TF Cornerstone lists each apartment at its gross rent, in its building', () => {
  const listings = parseTfcFeed(
    feed(
      [
        unit(),
        // No gross rent: the advertised price is used.
        unit({
          Code: '45WAA1::308',
          Apartment: '308',
          GrossRent: 0,
          Price: 4450,
          NumBedrooms: 0,
          WebUrl: unit().WebUrl.replace('2203', '308'),
        }),
        // Left out: not listed, unknown building, outside the five boroughs, a link elsewhere, no unit, five bedrooms.
        unit({ Code: 'a', IsListed: false }),
        unit({ Code: 'b', MarketingPropertyCode: 'NOPE' }),
        unit({ Code: 'c', MarketingPropertyCode: 'NJ1' }),
        unit({ Code: 'd', WebUrl: 'https://example.com/apt-1' }),
        unit({ Code: 'e', Apartment: null }),
        unit({ Code: 'f', NumBedrooms: 5 }),
        'not a unit',
      ],
      [building, { MarketingPropertyCode: 'NJ1', Address: '1 River Rd', Zip: '07302' }, { MarketingPropertyCode: 'X', Zip: 10005 }],
    ),
    at,
  );
  expect(listings.map(({ id, unit, rent, bedrooms, city }) => ({ id, unit, rent, bedrooms, city }))).toEqual([
    { id: 'tfc:45WAA1::2203', unit: '2203', rent: 5455, bedrooms: 1, city: 'Manhattan' },
    { id: 'tfc:45WAA1::308', unit: '308', rent: 4450, bedrooms: 0, city: 'Manhattan' },
  ]);
  expect(listings[0]).toMatchObject({ address: '45 Wall St', zip: '10005', latitude: 40.706, neighborhood: 'Financial District' });
  expect(tfcListingUrl(listings[0]?.sources[0]?.url)).toBe(unit().WebUrl);
  for (const broken of [null, {}, feed([unit()], []), { Properties: { Data: [building] }, Units: {} }])
    expect(() => parseTfcFeed(broken, at)).toThrow(/recognized listings file/);
});

test('TF Cornerstone reads one file, and says when it is refused, too large or empty', async () => {
  const requested: string[] = [];
  const answer = (response: Response) => async (url: string) => {
    requested.push(url);
    return response;
  };
  const result = await TFC_LIVE.load(answer(Response.json(feed([unit()]))), new Date(at));
  expect(result).toMatchObject({ pages: 1 });
  expect(result.listings).toHaveLength(1);
  expect(requested).toEqual(['https://cdn.tfc.com/tfc-com/initial-data.json']);
  await expect(loadTfc(answer(new Response(null, { status: 503 })), new Date(at))).rejects.toThrow(/HTTP 503/);
  await expect(loadTfc(answer(new Response('', { status: 403, headers: { 'cf-mitigated': 'challenge' } })), new Date(at))).rejects.toThrow(
    /bot protection/,
  );
  await expect(
    loadTfc(answer(new Response('{}', { headers: { 'content-length': String(13 * 1024 * 1024) } })), new Date(at)),
  ).rejects.toThrow(/too large/);
  await expect(loadTfc(answer(new Response(' '.repeat(12 * 1024 * 1024 + 1))), new Date(at))).rejects.toThrow(/too large/);
  await expect(loadTfc(answer(Response.json(feed([unit({ IsListed: false })]))), new Date(at))).rejects.toThrow(/no supported apartment/);
});
