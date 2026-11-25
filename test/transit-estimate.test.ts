import { expect, test } from 'bun:test';
import { STATIONS_KEY } from '../server/open-data.ts';
import { offline, search } from '../server/search.ts';
import { RAIL_STOPS_KEY } from '../server/transit-stops.ts';
import { parseFilters } from '../src/search.ts';
import { miles, transitEstimator } from '../src/transit-estimate.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

// A few real stations: the L across 14th Street and into Williamsburg, and the 6 up Lexington to 51st Street.
const stations = [
  { name: 'Bedford Av', routes: ['L'], latitude: 40.717304, longitude: -73.956872 },
  { name: '14 St-Union Sq', routes: ['L', '4', '5', '6', 'N', 'Q', 'R', 'W'], latitude: 40.735736, longitude: -73.990568 },
  { name: '51 St', routes: ['6'], latitude: 40.757107, longitude: -73.97192 },
  { name: 'Grand Central', routes: ['4', '5', '6', '7', 'S'], latitude: 40.751776, longitude: -73.976848 },
  { name: 'Journal Square', routes: ['PATH'], latitude: 40.7326, longitude: -74.06272 },
];
const rockefeller = { latitude: 40.75874, longitude: -73.97867 };

test('a trip is estimated door to door: walk, wait, ride, transfer, walk', () => {
  const estimate = transitEstimator(stations, rockefeller);
  // Williamsburg to Midtown: the L to Union Square, the 6 to 51st Street; a planner says about 30 to 40 minutes.
  const williamsburg = estimate({ latitude: 40.7172, longitude: -73.9567 })!;
  expect(williamsburg).toBeGreaterThan(25);
  expect(williamsburg).toBeLessThan(45);
  // Next door, walking wins.
  expect(estimate({ latitude: 40.7585, longitude: -73.979 })).toBeLessThan(3);
  // Harlem with no station known near it: a two-hour walk is not shown as a commute.
  expect(estimate({ latitude: 40.8184, longitude: -73.9403 })).toBeNull();
  // Nowhere near a station and over two hours on foot.
  expect(estimate({ latitude: 41.3, longitude: -74.5 })).toBeNull();
  expect(estimate(null)).toBeNull();
  expect(estimate({ latitude: Number.NaN, longitude: 1 })).toBeNull();
  expect(Math.round(miles(stations[0]!, stations[1]!) * 10) / 10).toBe(2.2);
});

test('listings shown get an estimate to the destination when there is no routing service', async () => {
  const bucket = createMemoryBucket();
  const all = await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: null }), { BUCKET: bucket }, offline);
  // Every NYC listing's neighborhood has a station near it in this made-up list: one at each listing's own spot.
  const near = all.matches
    .filter((listing) => typeof listing.latitude === 'number')
    .slice(0, 5)
    .map((listing, index) => ({ name: `Station ${index}`, routes: ['A'], latitude: listing.latitude!, longitude: listing.longitude! }));
  await bucket.put(
    STATIONS_KEY,
    JSON.stringify({
      checkedAt: '2026-11-24T00:00:00Z',
      stations: [...near, { name: 'Midtown', routes: ['A'], latitude: 40.7587, longitude: -73.9787 }],
    }),
  );
  await bucket.put(
    RAIL_STOPS_KEY,
    JSON.stringify({
      checkedAt: '2026-11-24T00:00:00Z',
      stops: [{ name: 'Hoboken', system: 'path', line: 'PATH', latitude: 40.7348, longitude: -74.0294 }],
    }),
  );
  const { openData } = await import('../server/open-data.ts');
  await openData(bucket, Date.now() + 3_600_000);
  const estimated = await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: 50_000 }), { BUCKET: bucket }, offline);
  expect(estimated.matches.some((listing) => typeof listing.insights?.transitMinutes === 'number')).toBe(true);
});
