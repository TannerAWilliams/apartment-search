import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { routeCommutes } from '../server/commute.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';

const workplace = { label: 'Rockefeller Center', latitude: 40.75874, longitude: -73.97867 };
const credentials = { appId: 'synthetic-app', apiKey: 'synthetic-key' };
const point = (n: number) => ({ id: 'l' + n, latitude: 40.7 + n / 1000, longitude: -73.95 });

function traveltime() {
  const sent: number[] = [];
  const fetcher = async (_url: string, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body));
    const origins = body.locations.filter((location: { id: string }) => location.id !== 'workplace');
    sent.push(origins.length);
    return Response.json({ results: ['transit', 'driving'].map((search_id) => ({ search_id,
      // The second origin of each request has no transit route.
      locations: origins.filter((_: unknown, index: number) => search_id === 'driving' || index !== 1)
        .map((location: { id: string }) => ({ id: location.id, properties: { travel_time: 600 + Number(location.id) } })) })) });
  };
  return { fetcher, sent };
}

test('commute times are routed once per origin and reused for a week', async () => {
  const bucket = createMemoryBucket();
  const api = traveltime();
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n));
  const first = await routeCommutes([point(1), point(2)], workplace, credentials, api.fetcher, day(0), bucket);
  assert.deepEqual(api.sent, [2]);
  assert.equal(first[1].transitSeconds, null, 'no transit route');
  const again = await routeCommutes([point(1), point(2)], workplace, credentials, api.fetcher, day(1), bucket);
  assert.deepEqual(api.sent, [2], 'a repeat search sends no origins');
  assert.deepEqual(again.map(({ transitSeconds, drivingSeconds }) => [transitSeconds, drivingSeconds]),
    first.map(({ transitSeconds, drivingSeconds }) => [transitSeconds, drivingSeconds]));
  assert.equal(again[0].commuteEstimate?.checkedAt, day(0).toISOString(), 'the estimate keeps its routed date');
  await routeCommutes([point(1), point(2), point(3)], workplace, credentials, api.fetcher, day(2), bucket);
  assert.deepEqual(api.sent, [2, 1], 'only the new origin is sent');
  await routeCommutes([point(1)], workplace, credentials, api.fetcher, day(8), bucket);
  assert.deepEqual(api.sent, [2, 1, 1], 'week-old estimates are routed again');
  await routeCommutes([point(1)], { ...workplace, label: 'Elsewhere', latitude: 40.7 }, credentials, api.fetcher, day(8), bucket);
  assert.deepEqual(api.sent, [2, 1, 1, 1], 'another workplace has its own cache');
});

test('commute routing without a cache still routes every origin', async () => {
  const api = traveltime();
  await routeCommutes([point(1)], workplace, credentials, api.fetcher);
  await routeCommutes([point(1)], workplace, credentials, api.fetcher);
  assert.deepEqual(api.sent, [1, 1]);
});
