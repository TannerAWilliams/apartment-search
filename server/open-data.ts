/**
 * Public lists the app keeps, refreshed by the sync Workflow. Two are read by every search, monthly:
 * - every building that registers rent-stabilized units with New York State (DHCR's registered buildings, about
 *   57,000), matched to listings by street address and ZIP code;
 * - every New York City subway station (MTA, data.ny.gov), with the lines that stop there in the daytime.
 * Searches read them from storage at most every ten minutes per Worker.
 *
 * The third is read by building reports, weekly: every eviction of residents that a city marshal carried out in
 * two years, counted by tax lot. The city's service answers a question about one building slowly or not at all,
 * and the whole two years in one read, so the count is taken from this copy.
 */
import { log } from './log.ts';
import * as v from 'valibot';
import { isRecord } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { buildingKey } from '../src/listings.ts';
import type { Station } from '../src/subway.ts';
import type { Bucket } from './contracts.ts';
import { checkedDocument } from './storage/stored-documents.ts';
import { loadRailStops, RAIL_STOPS_KEY, readRailStops } from './transit-stops.ts';
import { readWalkability } from './walkability.ts';

const REGISTRY =
  'https://services8.arcgis.com/ek7Sxtay3Z4WZWvk/arcgis/rest/services/registered_buildings_unit_counts/FeatureServer/0/query';
const STATIONS = 'https://data.ny.gov/resource/39hk-dx4f.json';
const EVICTIONS = 'https://data.cityofnewyork.us/resource/6z8x-wfk4.json';
export const EVICTIONS_KEY = 'buildings/evictions.json';
const EVICTIONS_REFRESH_DAYS = 7;
const EVICTION_YEARS = 2;
export const REGISTRY_KEY = 'buildings/stabilized.json';
export const STATIONS_KEY = 'transit/stations.json';
const PAGE = 1000;
const MAX_PAGES = 120;
const MAX_BYTES = 4 * 1024 * 1024;
/** Lists older than this are loaded again. */
export const REFRESH_DAYS = 30;
/** A building counts as rent-stabilized when it registered this year or one of the two before. */
const RECENT_YEARS = 2;

const RegistrySchema = v.object({ checkedAt: v.string(), buildings: v.record(v.string(), v.number()) });
const EvictionsSchema = v.object({ checkedAt: v.string(), since: v.string(), lots: v.record(v.string(), v.number()) });
export type EvictionsByLot = v.InferOutput<typeof EvictionsSchema>;
const StationsSchema = v.object({
  checkedAt: v.string(),
  stations: v.array(
    v.object({
      name: v.string(),
      routes: v.array(v.string()),
      latitude: v.number(),
      longitude: v.number(),
      accessible: v.optional(v.boolean()),
    }),
  ),
});

async function readJson(fetcher: FetchTransport, url: string): Promise<unknown> {
  const response = await fetcher(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Open data returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error('Open data returned too much.');
  return JSON.parse(text);
}

/**
 * The street addresses a registry entry names, without city and ZIP: "168 / 170 E 81st St, New York, 10028" is
 * both 168 and 170 East 81st Street.
 */
export function registryStreets(address: string) {
  const street = address.split(',')[0].trim();
  const range = street.match(/^(\d+(?:-\d+)?)\s*\/\s*(\d+(?:-\d+)?)\s+(.+)$/);
  return range ? [`${range[1]} ${range[3]}`, `${range[2]} ${range[3]}`] : [street];
}

/** Loads the whole registry, a page at a time; registered units by building key. */
export async function loadStabilizedRegistry(fetcher: FetchTransport, now = new Date()) {
  const buildings: Record<string, number> = {};
  const since = now.getUTCFullYear() - RECENT_YEARS;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      f: 'json',
      where: `last_year_registered >= ${since}`,
      outFields: 'address,zip_code,registered_units',
      returnGeometry: 'false',
      orderByFields: 'ObjectId',
      resultOffset: String(page * PAGE),
      resultRecordCount: String(PAGE),
    });
    const data = await readJson(fetcher, REGISTRY + '?' + query);
    if (!isRecord(data) || !Array.isArray(data.features)) throw new Error('The rent registration list was not recognized.');
    for (const feature of data.features) {
      const info = isRecord(feature) && isRecord(feature.attributes) ? feature.attributes : null;
      if (!info || typeof info.address !== 'string' || typeof info.zip_code !== 'number') continue;
      const zip = String(info.zip_code).padStart(5, '0');
      const units = typeof info.registered_units === 'number' && info.registered_units >= 0 ? info.registered_units : 0;
      for (const street of registryStreets(info.address)) {
        const key = buildingKey({ address: street, state: 'NY', zip });
        if (key) buildings[key] = units;
      }
    }
    // The service says when more pages follow.
    if (data.exceededTransferLimit !== true || !data.features.length) break;
  }
  if (!Object.keys(buildings).length) throw new Error('The rent registration list was empty.');
  return { checkedAt: now.toISOString(), buildings };
}

/** Residents evicted by a marshal over two years, counted by tax lot (BBL). */
export async function loadEvictions(fetcher: FetchTransport, now = new Date()): Promise<EvictionsByLot> {
  const since = new Date(now.getTime() - EVICTION_YEARS * 365 * 86_400_000).toISOString().slice(0, 10);
  const rows = await readJson(
    fetcher,
    EVICTIONS +
      '?' +
      new URLSearchParams({ $select: 'bbl,residential_commercial_ind', $where: `executed_date >= '${since}T00:00:00'`, $limit: '100000' }),
  );
  if (!Array.isArray(rows)) throw new Error('The evictions list was not recognized.');
  const lots: Record<string, number> = {};
  for (const row of rows) {
    // The city places most evictions on a tax lot, and marks each as residential or commercial, in words or by a letter.
    if (!isRecord(row) || typeof row.bbl !== 'string' || !/^[1-5]\d{9}$/.test(row.bbl)) continue;
    if (!/^r/i.test(String(row.residential_commercial_ind ?? ''))) continue;
    lots[row.bbl] = (lots[row.bbl] ?? 0) + 1;
  }
  if (!Object.keys(lots).length) throw new Error('The evictions list was empty.');
  return { checkedAt: now.toISOString(), since, lots };
}

const NUMBER = /^-?\d+(?:\.\d+)?$/;
/** Loads every subway station with its daytime lines. */
export async function loadStations(fetcher: FetchTransport, now = new Date()) {
  const rows = await readJson(fetcher, STATIONS + '?' + new URLSearchParams({ $limit: '1000' }));
  if (!Array.isArray(rows)) throw new Error('The subway station list was not recognized.');
  const stations: Station[] = rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.stop_name !== 'string' || typeof row.daytime_routes !== 'string') return [];
    const latitude = String(row.gtfs_latitude ?? '');
    const longitude = String(row.gtfs_longitude ?? '');
    if (!NUMBER.test(latitude) || !NUMBER.test(longitude)) return [];
    const routes = row.daytime_routes.split(/\s+/).filter((route) => /^[0-9A-Z]{1,2}$/.test(route));
    // ADA 1 is fully accessible; 2 is partly (one direction only), which is not enough to count on.
    const accessible = String(row.ada) === '1';
    return routes.length
      ? [{ name: row.stop_name, routes, latitude: Number(latitude), longitude: Number(longitude), ...(accessible ? { accessible } : {}) }]
      : [];
  });
  if (!stations.length) throw new Error('The subway station list was empty.');
  return { checkedAt: now.toISOString(), stations };
}

async function readDocument<T extends v.GenericSchema>(bucket: Bucket, key: string, schema: T) {
  const object = await bucket.get(key);
  return object ? checkedDocument(schema, await object.json().catch(() => null), key) : null;
}

/** Evictions by tax lot, as last loaded; null before the first load. */
export const readEvictions = (bucket: Bucket) => readDocument(bucket, EVICTIONS_KEY, EvictionsSchema).catch(() => null);

/** Loads each list again when it is missing or old (a month; a week for evictions). Returns which were refreshed. */
export async function refreshOpenData(bucket: Bucket, fetcher: FetchTransport, now = new Date()) {
  const stale = (checkedAt: string | undefined, days = REFRESH_DAYS) =>
    !checkedAt || Date.parse(checkedAt) < now.getTime() - days * 86_400_000;
  const refreshed: string[] = [];
  // Each list on its own, the small ones first, so one source failing never keeps the others from loading.
  const parts: [string, () => Promise<boolean>][] = [
    [
      'stations',
      async () =>
        stale((await readDocument(bucket, STATIONS_KEY, StationsSchema))?.checkedAt) &&
        (await bucket.put(STATIONS_KEY, JSON.stringify(await loadStations(fetcher, now))), true),
    ],
    [
      'rail stops',
      async () => {
        const rail = await readRailStops(bucket).catch(() => null);
        return (
          stale(rail?.checkedAt) && (await bucket.put(RAIL_STOPS_KEY, JSON.stringify(await loadRailStops(fetcher, rail?.stops, now))), true)
        );
      },
    ],
    [
      'registry',
      async () =>
        stale((await readDocument(bucket, REGISTRY_KEY, RegistrySchema))?.checkedAt) &&
        (await bucket.put(REGISTRY_KEY, JSON.stringify(await loadStabilizedRegistry(fetcher, now))), true),
    ],
    [
      'evictions',
      async () =>
        stale((await readEvictions(bucket))?.checkedAt, EVICTIONS_REFRESH_DAYS) &&
        (await bucket.put(EVICTIONS_KEY, JSON.stringify(await loadEvictions(fetcher, now))), true),
    ],
  ];
  const failures: unknown[] = [];
  for (const [name, refresh] of parts) {
    try {
      if (await refresh()) refreshed.push(name);
    } catch (cause) {
      log.warn('open_data_failed', { part: name, error: cause instanceof Error ? cause.message : String(cause) });
      failures.push(cause);
    }
  }
  if (failures.length === parts.length) throw failures[0];
  return refreshed;
}

const CACHE_MS = 10 * 60_000;
let cache: {
  at: number;
  bucket: Bucket;
  registry: Record<string, number>;
  stations: Station[];
  path: Station[];
  walkability: Record<string, number>;
} | null = null;

/** The map's transit layer: every subway station and the other rail stops, as stored. Empty lists when not loaded yet. */
export async function transitStops(bucket: Bucket) {
  const [stations, rail] = await Promise.all([
    readDocument(bucket, STATIONS_KEY, StationsSchema).catch(() => null),
    readRailStops(bucket).catch(() => null),
  ]);
  return { subway: stations?.stations ?? [], rail: rail?.stops ?? [] };
}

/** Both lists for a search, from this Worker's memory when read in the last ten minutes. Empty when not loaded yet. */
export async function openData(bucket: Bucket, now = Date.now()) {
  if (cache && cache.bucket === bucket && now - cache.at < CACHE_MS) return cache;
  const [registry, stations, rail, walkability] = await Promise.all([
    readDocument(bucket, REGISTRY_KEY, RegistrySchema).catch(() => null),
    readDocument(bucket, STATIONS_KEY, StationsSchema).catch(() => null),
    readRailStops(bucket).catch(() => null),
    readWalkability(bucket).catch(() => ({})),
  ]);
  // PATH's stations, as one more line, for transit time estimates.
  const path = (rail?.stops ?? [])
    .filter(({ system }) => system === 'path')
    .map(({ name, latitude, longitude }) => ({ name, routes: ['PATH'], latitude, longitude }));
  cache = { at: now, bucket, registry: registry?.buildings ?? {}, stations: stations?.stations ?? [], path, walkability };
  return cache;
}
