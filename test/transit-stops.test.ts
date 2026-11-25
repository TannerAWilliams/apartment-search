import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { transitStops } from '../server/open-data.ts';
import { loadMetroNorthStops, loadNewJerseyStops, loadRailStops, RAIL_STOPS_KEY } from '../server/transit-stops.ts';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const now = new Date('2026-11-24T00:00:00Z');
const station = (STATION: unknown, RAIL_LINE: unknown, x: unknown = -74.03, y: unknown = 40.73) => ({
  attributes: { STATION, RAIL_LINE },
  geometry: { x, y },
});
const newJersey = {
  features: [
    station('Hoboken', 'PATH'),
    station('Hoboken Terminal', 'Morris and Essex Line'),
    station('Newport', 'Hudson-Bergen Light Rail'),
    station('Broken', 'PATH', 'x'),
    station(1, 'PATH'),
  ],
};
const metroNorthZip = (stops: string) => zipSync({ 'stops.txt': strToU8(stops), 'routes.txt': strToU8('route_id\n1') });
const metroNorth = metroNorthZip(
  '﻿stop_id,stop_code,stop_name,stop_lat,stop_lon\n1,GCT,"Grand Central",40.752998,-73.977056\n2,HM,Harlem-125 St,40.805157,-73.939149\n3,X,Nowhere,0,0\n\n',
);

function fetcher({
  nj = Response.json(newJersey) as Response | (() => Response),
  mnr = new Response(metroNorth) as Response | (() => Response),
} = {}) {
  return async (url: string) => {
    const pick = new URL(url).hostname === 'services.arcgis.com' ? nj : mnr;
    return typeof pick === 'function' ? pick() : pick.clone();
  };
}

test('New Jersey’s stations are sorted into NJ Transit, light rail and PATH', async () => {
  const stops = await loadNewJerseyStops(fetcher());
  expect(stops.map(({ name, system }) => `${name}:${system}`)).toEqual(['Hoboken:path', 'Hoboken Terminal:njt', 'Newport:light-rail']);
  await expect(loadNewJerseyStops(fetcher({ nj: Response.json({ error: 1 }) }))).rejects.toThrow(/not recognized/);
  await expect(loadNewJerseyStops(fetcher({ nj: new Response('busy', { status: 503 }) }))).rejects.toThrow(/HTTP 503/);
  await expect(loadNewJerseyStops(fetcher({ nj: new Response('x'.repeat(17 * 1024 * 1024)) }))).rejects.toThrow(/too much/);
});

test('Metro-North’s stations come from the stops in its timetable', async () => {
  const stops = await loadMetroNorthStops(fetcher());
  expect(stops).toEqual([
    { name: 'Grand Central', system: 'metro-north', line: 'Metro-North', latitude: 40.752998, longitude: -73.977056 },
    { name: 'Harlem-125 St', system: 'metro-north', line: 'Metro-North', latitude: 40.805157, longitude: -73.939149 },
  ]);
  await expect(loadMetroNorthStops(fetcher({ mnr: new Response(zipSync({ 'routes.txt': strToU8('x') })) }))).rejects.toThrow(/no stops/);
  await expect(loadMetroNorthStops(fetcher({ mnr: new Response(metroNorthZip('id,name\n1,x')) }))).rejects.toThrow(/not recognized/);
});

test('a source that fails keeps the stops it had; both failing keeps everything as it was', async () => {
  const fresh = await loadRailStops(fetcher(), [], now);
  expect(fresh.stops.filter(({ system }) => system === 'path').map(({ name }) => name)).toContain('World Trade Center');
  expect(fresh.stops.some(({ system }) => system === 'metro-north')).toBe(true);
  const down = () => new Response('busy', { status: 503 });
  const keptNj = await loadRailStops(fetcher({ nj: down }), fresh.stops, now);
  expect(keptNj.stops.filter(({ name }) => name === 'Hoboken')).toHaveLength(1);
  expect(
    keptNj.stops.filter(({ name }) => name === 'World Trade Center'),
    'Manhattan PATH is never doubled',
  ).toHaveLength(1);
  const keptMnr = await loadRailStops(fetcher({ mnr: down }), fresh.stops, now);
  expect(keptMnr.stops.some(({ name }) => name === 'Grand Central')).toBe(true);
  await expect(loadRailStops(fetcher({ nj: down, mnr: down }), fresh.stops, now)).rejects.toThrow(/HTTP 503/);
});

test('the map’s transit layer is public, kept a day, and empty until loaded', async () => {
  const bucket = createMemoryBucket();
  const get = () => handleApi(new Request('https://app.test/api/transit'), { BUCKET: bucket }, { privateAuthenticated: false });
  const empty = await get();
  expect(empty.headers.get('Cache-Control')).toBe('public, max-age=86400');
  expect(await empty.json()).toEqual({ subway: [], rail: [] });
  await bucket.put(RAIL_STOPS_KEY, JSON.stringify(await loadRailStops(fetcher(), [], now)));
  expect((await transitStops(bucket)).rail.length).toBeGreaterThan(5);
  expect((await handleApi(new Request('https://app.test/api/transit'), {})).status, 'no storage').toBe(400);
});

test('unreadable stops read as none, and are loaded again', async () => {
  const bucket = createMemoryBucket();
  await bucket.put(RAIL_STOPS_KEY, 'not json');
  expect((await transitStops(bucket)).rail).toEqual([]);
  const broken = { ...bucket, get: async () => Promise.reject(new Error('D1 busy')) } as unknown as typeof bucket;
  expect(await transitStops(broken)).toEqual({ subway: [], rail: [] });
  // A refresh that cannot read the stored stops loads them again.
  const flaky = {
    ...bucket,
    get: (key: string) => (key === RAIL_STOPS_KEY ? Promise.reject(new Error('D1 busy')) : bucket.get(key)),
  } as unknown as typeof bucket;
  const { refreshOpenData } = await import('../server/open-data.ts');
  const stations = Response.json([{ stop_name: 'Bedford Av', daytime_routes: 'L', gtfs_latitude: '40.7', gtfs_longitude: '-73.9' }]);
  const registry = Response.json({
    features: [{ attributes: { address: '1 A St, New York, 10002', zip_code: 10002, registered_units: 5 } }],
  });
  const all = async (url: string) => {
    const host = new URL(url).hostname;
    if (host === 'data.ny.gov') return stations.clone();
    if (host === 'services8.arcgis.com') return registry.clone();
    return fetcher()(url);
  };
  expect(await refreshOpenData(flaky, all, now)).toContain('rail stops');
});
