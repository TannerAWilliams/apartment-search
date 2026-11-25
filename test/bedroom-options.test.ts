import { expect, test } from 'bun:test';
import { bathroomBucket, bedroomsLabel, matchListings, parseFilters } from '../src/search.ts';
import { suggestPlaces } from '../server/commute.ts';
import { testListing } from './fixtures/listing.ts';

test('several bedroom and bathroom counts are searched at once', () => {
  const listings = [
    testListing({ id: 'studio', bedrooms: 0, bathrooms: 1 }),
    testListing({ id: 'one', bedrooms: 1, bathrooms: 1.5 }),
    testListing({ id: 'two', bedrooms: 2, bathrooms: 2 }),
    testListing({ id: 'five', bedrooms: 5, bathrooms: 3.5 }),
    testListing({ id: 'unknown-baths', bedrooms: 1, bathrooms: null }),
  ];
  const ids = (input: object) =>
    matchListings(listings, parseFilters({ region: 'all', maxRent: null, ...input }), { latitude: 40.75, longitude: -73.98 }).map(
      ({ id }) => id,
    );
  expect(ids({ bedroomOptions: [1, 4] })).toEqual(['one', 'five', 'unknown-baths']);
  expect(ids({ bedroomOptions: [2] }), 'one count is the plain bedroom filter').toEqual(['two']);
  expect(parseFilters({ bedroomOptions: [2] })).toMatchObject({ bedrooms: 2 });
  expect(parseFilters({ bedroomOptions: [2, 1, 2] })).toMatchObject({ bedrooms: null, bedroomOptions: [1, 2] });
  expect(ids({ bedrooms: null, bathroomOptions: [1, 3] })).toEqual(['studio', 'one', 'five']);
  expect([null, 0, 1, 1.5, 2, 2.5, 3, 4].map(bathroomBucket)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  expect(bedroomsLabel({ bedrooms: null })).toBe('Any beds');
  expect(bedroomsLabel({ bedrooms: 2, bedroomOptions: undefined })).toBe('2 bedrooms');
  expect(bedroomsLabel({ bedrooms: null, bedroomOptions: [0, 1, 4] })).toBe('Studio, 1 BR or 4+ BR');
});

test('place suggestions are kept in Cloudflare’s cache when there is one', async () => {
  const stored = new Map<string, Response>();
  const original = (globalThis as { caches?: unknown }).caches;
  (globalThis as { caches?: unknown }).caches = {
    default: {
      match: async (url: string) => stored.get(url)?.clone(),
      put: async (url: string, response: Response) => void stored.set(url, response),
    },
  };
  try {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return Response.json({
        features: [{ geometry: { coordinates: [-74, 40.7] }, properties: { name: 'Hoboken Terminal', city: 'Hoboken' } }],
      });
    };
    expect((await suggestPlaces('hoboken', fetcher))[0]?.label).toBe('Hoboken Terminal, Hoboken');
    expect((await suggestPlaces('hoboken', fetcher))[0]?.label).toBe('Hoboken Terminal, Hoboken');
    expect(calls).toBe(1);
  } finally {
    (globalThis as { caches?: unknown }).caches = original;
  }
});
