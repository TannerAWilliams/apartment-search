import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { savedCommuteEstimate, withoutCommuteEstimate } from '../src/commute-estimate.ts';
import { routeCommutes } from '../server/commute.ts';
import { comparisonRows } from '../src/comparison.ts';
import type { ListingData } from '../src/domain.ts';
import { sentJson } from './fixtures/json.ts';
import type { TravelTimeRequest } from '../server/commute.ts';
const destination = { label: 'Test workplace', latitude: 40.75, longitude: -73.98 };
const checkedAt = '2026-11-17T00:00:00.000Z';
const metadata = () => ({ provider: 'TravelTime', arrivalPeriod: 'weekday_morning', checkedAt, destination });
const listing: ListingData = { id: 'one', address: 'Test apartment', city: 'Brooklyn', state: 'NY', zip: '11201', kind: 'feed', sources: [], latitude: 40.7, longitude: -74, rent: 2000, bedrooms: 1 };
const credentials = { appId: 'test', apiKey: 'fixture-not-a-real-key' };
test('saved estimates require validated destination/provider/time context, never raw legacy durations', () => {
  assert.equal(savedCommuteEstimate({ transitSeconds: 600 }), null);
  for (const patch of [{ provider: 'invented' }, { arrivalPeriod: 'now' }, { checkedAt: 1 }, { checkedAt: 'bad' }, { destination: null },
    { destination: { ...destination, label: '' } }, { destination: { ...destination, label: 'x'.repeat(201) } },
    { destination: { ...destination, latitude: 91 } }, { destination: { ...destination, longitude: -181 } }]) {
    assert.equal(savedCommuteEstimate({ commuteEstimate: { ...metadata(), ...patch } }), null);
  }
  const result = savedCommuteEstimate({ commuteEstimate: metadata(), transitSeconds: 601, drivingSeconds: 0 })!;
  assert.equal(result.transitMinutes, 11); assert.equal(result.drivingMinutes, 0);
  result.destination.label = 'changed'; assert.equal(destination.label, 'Test workplace');
  for (const value of [-1, 10801, Infinity, '600', null]) assert.equal(savedCommuteEstimate({ commuteEstimate: metadata(), transitSeconds: value })!.transitMinutes, null);
});
test('routing attaches actual query destination and timestamp, while invalid coordinates never inherit estimates', async () => {
  const invalid = { ...listing, id: 'invalid', latitude: '40.7', transitSeconds: 5, commuteEstimate: metadata() };
  const fetcher = async (_url: string, options?: RequestInit) => {
    const body = sentJson<TravelTimeRequest>(required(options).body);
    assert.equal(body.locations.length, 2);
    assert.deepEqual(body.locations[1].coords, { lat: destination.latitude, lng: destination.longitude });
    return new Response(JSON.stringify({ results: ['transit', 'driving'].map(search_id => ({ search_id, locations: [{ id: '0', properties: { travel_time: search_id === 'transit' ? 601 : 1200 } }] })) }));
  };
  const result = await routeCommutes([listing, invalid], destination, credentials, fetcher, new Date(checkedAt));
  assert.deepEqual(result[0].commuteEstimate, metadata());
  assert.equal(savedCommuteEstimate(result[0])!.drivingMinutes, 20);
  assert.equal(result[1].commuteEstimate, null); assert.equal(result[1].transitSeconds, null);
  const rows = Object.fromEntries(comparisonRows(result[0] as ListingData));
  assert.equal(rows['Transit estimate'], '11 min (weekday morning)');
  assert.equal(rows['Commute estimate checked'], 'Nov 16, 2026, 7:00 PM ET');
  assert.match(rows['Commute destination'], /Test workplace.*40.7500/);
});
test('no coordinate or invalid workplace cannot yield stale or fabricated route estimates', async () => {
  const noPoint = { ...listing, latitude: null, transitSeconds: 10, drivingSeconds: 20, commuteEstimate: metadata() };
  const [result] = await routeCommutes([noPoint], destination, credentials, () => assert.fail('No route request'), new Date(checkedAt));
  assert.equal(result.commuteEstimate, null); assert.equal(result.drivingSeconds, null);
  for (const workplace of [null, { ...destination, latitude: 999 }, { ...destination, label: '' }]) {
    await assert.rejects(routeCommutes([listing], workplace, credentials, () => assert.fail('No route request')), /valid workplace/);
  }
  await assert.rejects(routeCommutes([listing], destination, credentials, () => assert.fail('No route request'), new Date('bad')), /valid workplace/);
});

test('provider inventory cannot smuggle destination-specific route metadata into snapshots', () => {
  const supplied = { ...listing, transitSeconds: 1, drivingSeconds: 2, commuteEstimate: metadata() };
  assert.deepEqual(withoutCommuteEstimate(supplied), listing);
  assert.equal(supplied.transitSeconds, 1);
});
