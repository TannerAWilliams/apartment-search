import { expect, test } from 'bun:test';
import {
  loadStabilizedRegistry,
  loadStations,
  openData,
  REGISTRY_KEY,
  refreshOpenData,
  registryStreets,
  STATIONS_KEY,
} from '../server/open-data.ts';
import { withInsights } from '../src/insights.ts';
import { matchListings, parseFilters } from '../src/search.ts';
import { nearbyLines, stationIndex } from '../src/subway.ts';
import { understand } from '../src/natural-search.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';

const now = new Date('2026-11-24T00:00:00Z');
const registryPage = (features: unknown[], more = false) => ({ features, exceededTransferLimit: more });
const entry = (address: string, units: unknown = 10) => ({
  attributes: { address, zip_code: Number(address.split(', ').at(-1)), registered_units: units },
});
const stationRows = [
  { stop_name: 'Bedford Av', daytime_routes: 'L', gtfs_latitude: '40.717304', gtfs_longitude: '-73.956872' },
  { stop_name: 'Lorimer St', daytime_routes: 'L', gtfs_latitude: '40.714063', gtfs_longitude: '-73.950275' },
  { stop_name: 'Metropolitan Av', daytime_routes: 'G', gtfs_latitude: '40.712792', gtfs_longitude: '-73.951418' },
  { stop_name: 'Union Sq', daytime_routes: '4 5 6', gtfs_latitude: '40.735736', gtfs_longitude: '-73.990568' },
  { stop_name: 'Union Sq', daytime_routes: 'L', gtfs_latitude: '40.734789', gtfs_longitude: '-73.99073' },
  { stop_name: 'Broken', daytime_routes: 'Q', gtfs_latitude: 'x', gtfs_longitude: '1' },
  { stop_name: 'No lines', daytime_routes: '??', gtfs_latitude: '40', gtfs_longitude: '-73' },
  'junk',
];

function openDataFetcher(
  pages: unknown[][] = [[entry('160 Allen St, New York, 10002'), entry('168 / 170 E 81st St, New York, 10028', null)]],
) {
  const requests: URL[] = [];
  const fetcher = async (url: string) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.hostname === 'data.ny.gov') return Response.json(stationRows);
    const page = Number(parsed.searchParams.get('resultOffset')) / 1000;
    return Response.json(registryPage(pages[page] ?? [], page < pages.length - 1));
  };
  return { fetcher, requests };
}

test('the state’s registry of rent-stabilized buildings is loaded page by page and matched by address', async () => {
  expect(registryStreets('168 / 170 E 81st St, New York, 10028')).toEqual(['168 E 81st St', '170 E 81st St']);
  expect(registryStreets('84-27 Lander St, Queens, 11435')).toEqual(['84-27 Lander St']);
  const { fetcher, requests } = openDataFetcher([
    [entry('160 Allen St, New York, 10002'), entry('168 / 170 E 81st St, New York, 10028', null), { attributes: { address: 1 } }, 'x'],
    [entry('1 Last St, Bronx, 10451')],
  ]);
  const registry = await loadStabilizedRegistry(fetcher, now);
  expect(registry.buildings).toEqual({
    'NY|10002|160 allen st': 10,
    'NY|10028|168 e 81st st': 0,
    'NY|10028|170 e 81st st': 0,
    'NY|10451|1 last st': 10,
  });
  expect(requests[0]?.searchParams.get('where')).toBe('last_year_registered >= 2024');
  expect(requests.map((url) => url.searchParams.get('resultOffset'))).toEqual(['0', '1000']);
  await expect(loadStabilizedRegistry(openDataFetcher([[]]).fetcher, now)).rejects.toThrow(/empty/);
  await expect(loadStabilizedRegistry(async () => Response.json({ error: 'x' }), now)).rejects.toThrow(/not recognized/);
  await expect(loadStabilizedRegistry(async () => new Response('busy', { status: 503 }), now)).rejects.toThrow(/HTTP 503/);
  await expect(loadStabilizedRegistry(async () => new Response('x'.repeat(5 * 1024 * 1024)), now)).rejects.toThrow(/too much/);
});

test('subway stations are loaded with their daytime lines, and listings learn the stations within a short walk', async () => {
  const { stations } = await loadStations(openDataFetcher().fetcher, now);
  expect(stations.map(({ name, routes }) => `${name}: ${routes.join(' ')}`)).toEqual([
    'Bedford Av: L',
    'Lorimer St: L',
    'Metropolitan Av: G',
    'Union Sq: 4 5 6',
    'Union Sq: L',
  ]);
  await expect(loadStations(async () => Response.json({}), now)).rejects.toThrow(/not recognized/);
  await expect(loadStations(async () => Response.json([]), now)).rejects.toThrow(/empty/);
  const near = stationIndex(stations);
  expect(near(40.7172, -73.9567)).toEqual([
    { station: 'Bedford Av', routes: ['L'], minutes: 1 },
    { station: 'Lorimer St', routes: ['L'], minutes: 10 },
  ]);
  expect(near(40.7356, -73.9906)).toEqual([{ station: 'Union Sq', routes: ['4', '5', '6', 'L'], minutes: 1 }]);
  expect(near(40.5, -74.2), 'nothing near').toEqual([]);
  expect(near(null, undefined)).toEqual([]);
  expect(nearbyLines(near(40.7356, -73.9906))).toEqual(['4', '5', '6', 'L']);
  expect(nearbyLines(undefined)).toEqual([]);
});

test('searches read both lists, refreshed monthly; listings near a line or in a registered building can be filtered', async () => {
  const bucket = createMemoryBucket();
  expect(await openData(bucket, 1)).toMatchObject({ registry: {}, stations: [] });
  const { fetcher, requests } = openDataFetcher();
  expect(await refreshOpenData(bucket, fetcher, now)).toEqual(['registry', 'stations', 'rail stops']);
  expect(await refreshOpenData(bucket, fetcher, new Date(now.getTime() + 86_400_000)), 'fresh').toEqual([]);
  const calls = requests.length;
  expect(await refreshOpenData(bucket, fetcher, new Date(now.getTime() + 31 * 86_400_000))).toEqual(['registry', 'stations', 'rail stops']);
  expect(requests.length).toBeGreaterThan(calls);
  expect(await bucket.get(REGISTRY_KEY)).not.toBeNull();
  expect(await bucket.get(STATIONS_KEY)).not.toBeNull();

  expect((await openData(bucket, 2)).registry, 'kept in memory for ten minutes').toEqual({});
  const lists = await openData(bucket, 1 + 11 * 60_000);
  expect(await openData(createMemoryBucket(), 1 + 11 * 60_000), 'another database is read on its own').not.toBe(lists);
  expect(Object.keys(lists.registry)).toContain('NY|10002|160 allen st');

  const listings = withInsights(
    [
      testListing({
        id: 'allen',
        address: '160 Allen Street',
        state: 'NY',
        zip: '10002',
        region: 'nyc',
        latitude: 40.7172,
        longitude: -73.9567,
      }),
      testListing({ id: 'far', address: '1 Far Street', state: 'NY', zip: '10301', region: 'nyc', latitude: 40.5, longitude: -74.2 }),
      testListing({ id: 'nj', address: '2 Grove Street', latitude: 40.7172, longitude: -73.9567 }),
    ],
    {},
    lists,
  );
  expect(listings[0].building).toMatchObject({ stabilized: true, openViolations: null });
  expect(listings[0].insights.subway?.[0]).toEqual({ station: 'Bedford Av', routes: ['L'], minutes: 1 });
  expect(listings[2].insights.subway, 'outside New York City').toBeUndefined();
  const ids = (raw: Record<string, unknown>) =>
    matchListings(listings, parseFilters({ region: 'all', bedrooms: null, maxRent: null, ...raw }), null).map(({ id }) => id);
  expect(ids({ nearSubway: true })).toEqual(['allen']);
  expect(ids({ subwayLines: ['L', 'L'] })).toEqual(['allen']);
  expect(ids({ subwayLines: ['G'] })).toEqual([]);
  expect(ids({ stabilizedOnly: true })).toEqual(['allen']);
  expect(parseFilters({ subwayLines: ['X'] }).subwayLines, 'unknown lines are dropped').toBeUndefined();
});

test('plain-English search understands subway lines and “near the subway”', () => {
  expect(understand('1 bedroom near the L').changes).toEqual({ bedrooms: 1, subwayLines: ['L'] });
  expect(understand('on the 4/5/6 under 3k').understood).toEqual(['under $3,000', 'near the 4/5/6']);
  expect(understand('A, C or E train in Brooklyn').changes.subwayLines).toEqual(['A', 'C', 'E']);
  expect(understand('close to the subway').changes).toEqual({ nearSubway: true });
  expect(understand('near a park').changes).toEqual({});
  expect(understand('on the 1st floor').changes).toEqual({});
});

test('accessible stations are marked, filtered and understood', async () => {
  const { stations } = await loadStations(
    async () =>
      Response.json([
        { stop_name: 'Union Sq', daytime_routes: 'L', gtfs_latitude: '40.734789', gtfs_longitude: '-73.99073', ada: '1' },
        { stop_name: 'Union Sq', daytime_routes: '4 5 6', gtfs_latitude: '40.734789', gtfs_longitude: '-73.99073', ada: '0' },
        { stop_name: '3 Av', daytime_routes: 'L', gtfs_latitude: '40.732849', gtfs_longitude: '-73.986122', ada: '2' },
      ]),
    now,
  );
  expect(stations.map(({ accessible }) => accessible)).toEqual([true, undefined, undefined]);
  const near = stationIndex(stations);
  expect(near(40.7347, -73.9907)[0]).toMatchObject({ station: 'Union Sq', accessible: true, routes: ['L', '4', '5', '6'] });
  const reversed = stationIndex([...stations].reverse());
  expect(reversed(40.7347, -73.9907)[0]?.accessible, 'either order').toBe(true);
  const listings = withInsights(
    [
      testListing({ id: 'union', region: 'nyc', latitude: 40.7347, longitude: -73.9907 }),
      testListing({ id: 'third', region: 'nyc', latitude: 40.7328, longitude: -73.9861 + 0.004 }),
    ],
    {},
    { stations },
  );
  expect(
    matchListings(listings, parseFilters({ region: 'all', bedrooms: null, maxRent: null, accessibleSubway: true }), null).map(
      ({ id }) => id,
    ),
  ).toEqual(['union']);
  expect(understand('wheelchair accessible 2br').changes).toEqual({ bedrooms: 2, accessibleSubway: true });
  expect(understand('new listings in New Jersey').changes).toEqual({ region: 'nj', neighborhood: '', newWithinDays: 3 });
  expect(understand('studio in new york city').changes).toEqual({ bedrooms: 0, region: 'nyc', neighborhood: '' });
});

test('searches carry on without the lists when storage cannot be read', async () => {
  const broken = {
    ...createMemoryBucket(),
    get: async () => {
      throw new Error('storage down');
    },
  };
  expect(await openData(broken, 1)).toMatchObject({ registry: {}, stations: [] });
});
