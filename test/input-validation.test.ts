import { expect, test } from 'bun:test';
import { bedroomLabel, parseFilters, SearchInputError } from '../src/search.ts';
import { listingLinkLabel } from '../src/listings.ts';
import { routeCommutes } from '../server/commute.ts';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { readJson, sentJson, type ErrorBody } from './fixtures/json.ts';
import type { TravelTimeRequest } from '../server/commute.ts';

test('bedroom labels read naturally', () => {
  expect([null, 0, 1, 2].map(bedroomLabel)).toStrictEqual(['Any beds', 'Studio', '1 bedroom', '2 bedrooms']);
});

test('search filters reject input that is not a filter object or names no usable workplace', () => {
  for (const input of [null, 'manhattan', [1, 2]]) expect(() => parseFilters(input)).toThrow(SearchInputError);
  expect(() => parseFilters({ workplace: 'the-moon' })).toThrow(/Choose a workplace/);
  expect(() => parseFilters({ workplace: 'custom', customWorkplace: 'NYC' })).toThrow(/full workplace address/);
  expect(() => parseFilters({ workplace: 'custom', customWorkplace: 'x'.repeat(161) })).toThrow(/full workplace address/);
  expect(parseFilters({ workplace: 'custom', customWorkplace: '350 Fifth Avenue, New York, NY 10118' }).workplace).toBe('custom');
});

test('links say whether they open the live listing or an earlier copy', () => {
  expect(listingLinkLabel({ name: 'Zumper', kind: 'feed' })).toBe('Open on Zumper');
  expect(listingLinkLabel({ name: 'StreetEasy', kind: 'snapshot' })).toBe('View original on StreetEasy');
  expect(listingLinkLabel({ name: 'Zumper', kind: 'cached' })).toBe('View original on Zumper');
});

test('address geocoding refuses input that cannot be a street address without a request', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return new Response('{}'); };
  for (const address of [undefined, 42, 'NY', 'x'.repeat(161)]) {
    const response = await handleApi(new Request('https://app.test/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }) }), {}, { fetcher });
    expect(response.status).toBe(422);
    expect((await readJson<ErrorBody>(response)).error).toMatch(/full street address/);
  }
  expect(requests).toBe(0);
});

test('an unreadable commute cache is ignored and rebuilt rather than failing the search', async () => {
  const bucket = createMemoryBucket();
  const workplace = { label: 'Rockefeller Center', latitude: 40.75874, longitude: -73.97867 };
  for (let slot = 0; slot < 16; slot++) await bucket.put(`commutes/slot-${slot}.json.gz`, 'not gzip');
  let routed = 0;
  const fetcher = async (_url: string, options?: RequestInit) => {
    routed++;
    const ids = sentJson<TravelTimeRequest>(options?.body).locations.filter((location) => location.id !== 'workplace').map(({ id }) => id);
    return Response.json({ results: ['transit', 'driving'].map((search_id) => ({ search_id, locations: ids.map((id: string) => ({ id, properties: { travel_time: 900 } })) })) });
  };
  const [listing] = await routeCommutes([{ latitude: 40.7, longitude: -73.95 }], workplace, { appId: 'a', apiKey: 'b' }, fetcher, new Date(), bucket);
  expect(listing.transitSeconds).toBe(900);
  expect(routed).toBe(1);
});
