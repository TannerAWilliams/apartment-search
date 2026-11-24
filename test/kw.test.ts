import { expect, test } from 'bun:test';
import { KW_LIVE } from '../server/sources/kw.ts';

test('Keller Williams NYC reads every New York rental from kwnyc.com and keeps those with an address', async () => {
  const bodies: Record<string, unknown>[] = [];
  const requested: string[] = [];
  const result = await KW_LIVE.load(async (url, init) => {
    requested.push(url);
    bodies.push((JSON.parse(String(init?.body)) as { variables: Record<string, unknown> }).variables);
    return Response.json({
      data: {
        propertiesCount: { count: 2 },
        properties: [
          {
            id: 'b8193850-2120-4f9a-b2ab-aac02cf0f63a',
            slug: 'KW234614',
            status: 'For Lease',
            leaseProperty: true,
            leasePrice: 5795,
            leasePeriod: 'MONTH',
            privateAddress: false,
            bedroomCount: 3,
            bathCount: 1,
            addressLine1: '343 East 5th Street #6',
            addressState: 'NY',
            postalCode: '10003',
            types: [],
          },
          // "Call For Address" listings are left out.
          {
            id: 'x',
            slug: 'KW273549',
            status: 'For Lease',
            leaseProperty: true,
            leasePrice: 29500,
            privateAddress: true,
            addressState: 'NY',
          },
        ],
      },
    });
  }, new Date('2026-11-24T00:00:00Z'));
  expect(requested).toEqual(['https://kwnyc.com/api-gw/graphql']);
  expect(bodies[0]).toMatchObject({ companyId: 'd36fff22-1ea6-464a-8fbd-aee2a2b71bb2', leaseProperty: true, offset: 0, limit: 100 });
  expect(bodies[0]?.propertyTypeIds).toBeUndefined();
  expect(result.pages).toBe(1);
  expect(result.listings.map(({ id, address, unit, city }) => ({ id, address, unit, city }))).toEqual([
    { id: 'kw:b8193850-2120-4f9a-b2ab-aac02cf0f63a', address: '343 East 5th Street', unit: '6', city: 'Manhattan' },
  ]);
  expect(result.listings[0]?.sources[0]?.url).toBe('https://kwnyc.com/properties/KW234614');
  expect(KW_LIVE).toMatchObject({ id: 'kw-live', marketplace: 'kw', maxPages: 15, rowsPerPage: 100 });
  expect(KW_LIVE.listingUrl('https://serhant.com/properties/KW234614')).toBeNull();
});
