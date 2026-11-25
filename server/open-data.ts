/**
 * Two public lists the app keeps, each refreshed monthly by the sync Workflow and read by every search:
 * - every building that registers rent-stabilized units with New York State (DHCR's registered buildings, about
 *   57,000), matched to listings by street address and ZIP code;
 * - every New York City subway station (MTA, data.ny.gov), with the lines that stop there in the daytime.
 * Searches read them from storage at most every ten minutes per Worker.
 */
import * as v from 'valibot';
import { isRecord } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { buildingKey } from '../src/listings.ts';
import type { Station } from '../src/subway.ts';
import type { Bucket } from './contracts.ts';
import { checkedDocument } from './storage/stored-documents.ts';
import { loadRailStops, RAIL_STOPS_KEY, readRailStops } from './transit-stops.ts';

const REGISTRY =
  'https://services8.arcgis.com/ek7Sxtay3Z4WZWvk/arcgis/rest/services/registered_buildings_unit_counts/FeatureServer/0/query';
const STATIONS = 'https://data.ny.gov/resource/39hk-dx4f.json';
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

/** Loads either list again when it is missing or a month old. Returns which were refreshed. */
export async function refreshOpenData(bucket: Bucket, fetcher: FetchTransport, now = new Date()) {
  const stale = (checkedAt: string | undefined) => !checkedAt || Date.parse(checkedAt) < now.getTime() - REFRESH_DAYS * 86_400_000;
  const refreshed: string[] = [];
  if (stale((await readDocument(bucket, REGISTRY_KEY, RegistrySchema))?.checkedAt)) {
    await bucket.put(REGISTRY_KEY, JSON.stringify(await loadStabilizedRegistry(fetcher, now)));
    refreshed.push('registry');
  }
  if (stale((await readDocument(bucket, STATIONS_KEY, StationsSchema))?.checkedAt)) {
    await bucket.put(STATIONS_KEY, JSON.stringify(await loadStations(fetcher, now)));
    refreshed.push('stations');
  }
  const rail = await readRailStops(bucket).catch(() => null);
  if (stale(rail?.checkedAt)) {
    await bucket.put(RAIL_STOPS_KEY, JSON.stringify(await loadRailStops(fetcher, rail?.stops, now)));
    refreshed.push('rail stops');
  }
  return refreshed;
}

const CACHE_MS = 10 * 60_000;
let cache: { at: number; bucket: Bucket; registry: Record<string, number>; stations: Station[]; path: Station[] } | null = null;

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
  const [registry, stations, rail] = await Promise.all([
    readDocument(bucket, REGISTRY_KEY, RegistrySchema).catch(() => null),
    readDocument(bucket, STATIONS_KEY, StationsSchema).catch(() => null),
    readRailStops(bucket).catch(() => null),
  ]);
  // PATH's stations, as one more line, for transit time estimates.
  const path = (rail?.stops ?? [])
    .filter(({ system }) => system === 'path')
    .map(({ name, latitude, longitude }) => ({ name, routes: ['PATH'], latitude, longitude }));
  cache = { at: now, bucket, registry: registry?.buildings ?? {}, stations: stations?.stations ?? [], path };
  return cache;
}
