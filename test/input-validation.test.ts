import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { bedroomLabel, parseFilters, SearchInputError } from '../src/search.ts';
import { listingLinkLabel } from '../src/listings.ts';
import { geocodeAddress, routeCommutes } from '../server/commute.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';

test('bedroom labels read naturally', () => {
  assert.deepEqual([null, 0, 1, 2].map(bedroomLabel), ['Any beds', 'Studio', '1 bedroom', '2 bedrooms']);
});

test('search filters reject input that is not a filter object or names no usable workplace', () => {
  for (const input of [null, 'manhattan', [1, 2]]) assert.throws(() => parseFilters(input), SearchInputError);
  assert.throws(() => parseFilters({ workplace: 'the-moon' }), /Choose a workplace/);
  assert.throws(() => parseFilters({ workplace: 'custom', customWorkplace: 'NYC' }), /full workplace address/);
  assert.throws(() => parseFilters({ workplace: 'custom', customWorkplace: 'x'.repeat(161) }), /full workplace address/);
  assert.equal(parseFilters({ workplace: 'custom', customWorkplace: '350 Fifth Avenue, New York, NY 10118' }).workplace, 'custom');
});

test('links say whether they open the live listing or an earlier copy', () => {
  assert.equal(listingLinkLabel({ name: 'Zumper', kind: 'feed' }), 'Open on Zumper');
  assert.equal(listingLinkLabel({ name: 'StreetEasy', kind: 'snapshot' }), 'View original on StreetEasy');
  assert.equal(listingLinkLabel({ name: 'Zumper', kind: 'cached' }), 'View original on Zumper');
});

test('address geocoding refuses input that cannot be a street address without a request', async () => {
  let requests = 0;
  const fetcher = async () => { requests++; return new Response('{}'); };
  for (const address of [undefined, 42, 'NY', 'x'.repeat(161)]) await assert.rejects(geocodeAddress(address, fetcher), /full street address/);
  assert.equal(requests, 0);
});

test('an unreadable commute cache is ignored and rebuilt rather than failing the search', async () => {
  const bucket = createMemoryBucket();
  const workplace = { label: 'Rockefeller Center', latitude: 40.75874, longitude: -73.97867 };
  for (let slot = 0; slot < 16; slot++) await bucket.put(`commutes/slot-${slot}.json.gz`, 'not gzip');
  let routed = 0;
  const fetcher = async (_url: string, options?: RequestInit) => {
    routed++;
    const ids = JSON.parse(String(options?.body)).locations.filter((location: { id: string }) => location.id !== 'workplace').map(({ id }: { id: string }) => id);
    return Response.json({ results: ['transit', 'driving'].map((search_id) => ({ search_id, locations: ids.map((id: string) => ({ id, properties: { travel_time: 900 } })) })) });
  };
  const [listing] = await routeCommutes([{ latitude: 40.7, longitude: -73.95 }], workplace, { appId: 'a', apiKey: 'b' }, fetcher, new Date(), bucket);
  assert.equal(listing.transitSeconds, 900);
  assert.equal(routed, 1);
});
