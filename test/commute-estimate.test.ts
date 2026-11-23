import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
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
  expect(savedCommuteEstimate({ transitSeconds: 600 })).toBeNull();
  for (const patch of [{ provider: 'invented' }, { arrivalPeriod: 'now' }, { checkedAt: 1 }, { checkedAt: 'bad' }, { destination: null },
    { destination: { ...destination, label: '' } }, { destination: { ...destination, label: 'x'.repeat(201) } },
    { destination: { ...destination, latitude: 91 } }, { destination: { ...destination, longitude: -181 } }]) {
    expect(savedCommuteEstimate({ commuteEstimate: { ...metadata(), ...patch } })).toBeNull();
  }
  const result = savedCommuteEstimate({ commuteEstimate: metadata(), transitSeconds: 601, drivingSeconds: 0 })!;
  expect(result.transitMinutes).toBe(11); expect(result.drivingMinutes).toBe(0);
  result.destination.label = 'changed'; expect(destination.label).toBe('Test workplace');
  for (const value of [-1, 10801, Infinity, '600', null]) expect(savedCommuteEstimate({ commuteEstimate: metadata(), transitSeconds: value })!.transitMinutes).toBeNull();
});
test('routing attaches actual query destination and timestamp, while invalid coordinates never inherit estimates', async () => {
  const invalid = { ...listing, id: 'invalid', latitude: '40.7', transitSeconds: 5, commuteEstimate: metadata() };
  const fetcher = async (_url: string, options?: RequestInit) => {
    const body = sentJson<TravelTimeRequest>(required(options).body);
    expect(body.locations.length).toBe(2);
    expect(body.locations[1].coords).toStrictEqual({ lat: destination.latitude, lng: destination.longitude });
    return new Response(JSON.stringify({ results: ['transit', 'driving'].map(search_id => ({ search_id, locations: [{ id: '0', properties: { travel_time: search_id === 'transit' ? 601 : 1200 } }] })) }));
  };
  const result = await routeCommutes([listing, invalid], destination, credentials, fetcher, new Date(checkedAt));
  expect(result[0].commuteEstimate).toStrictEqual(metadata());
  expect(savedCommuteEstimate(result[0])!.drivingMinutes).toBe(20);
  expect(result[1].commuteEstimate).toBeNull(); expect(result[1].transitSeconds).toBeNull();
  const rows = Object.fromEntries(comparisonRows(result[0] as ListingData));
  expect(rows['Transit estimate']).toBe('11 min (weekday morning)');
  expect(rows['Commute estimate checked']).toBe('Nov 16, 2026, 7:00 PM ET');
  expect(rows['Commute destination']).toMatch(/Test workplace.*40.7500/);
});
test('no coordinate or invalid workplace cannot yield stale or fabricated route estimates', async () => {
  const noPoint = { ...listing, latitude: null, transitSeconds: 10, drivingSeconds: 20, commuteEstimate: metadata() };
  const [result] = await routeCommutes([noPoint], destination, credentials, () => expect.unreachable('No route request'), new Date(checkedAt));
  expect(result.commuteEstimate).toBeNull(); expect(result.drivingSeconds).toBeNull();
  for (const workplace of [null, { ...destination, latitude: 999 }, { ...destination, label: '' }]) {
    await expect(routeCommutes([listing], workplace, credentials, () => expect.unreachable('No route request'))).rejects.toThrow(/valid workplace/);
  }
  await expect(routeCommutes([listing], destination, credentials, () => expect.unreachable('No route request'), new Date('bad'))).rejects.toThrow(/valid workplace/);
});

test('provider inventory cannot smuggle destination-specific route metadata into snapshots', () => {
  const supplied = { ...listing, transitSeconds: 1, drivingSeconds: 2, commuteEstimate: metadata() };
  expect(withoutCommuteEstimate(supplied)).toStrictEqual(listing);
  expect(supplied.transitSeconds).toBe(1);
});
