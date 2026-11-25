/**
 * Rail stops for the map's transit layer, besides the subway (open-data.ts keeps the MTA's subway stations):
 * - NJ Transit rail and light rail, and PATH in New Jersey, from New Jersey's passenger rail stations (NJGIN);
 * - Metro-North, from the MTA's published timetable (GTFS) for the railroad;
 * - PATH's six Manhattan stations, which New Jersey's list leaves out.
 * Refreshed monthly with the other open data; each source that fails keeps the stops loaded before.
 */
import { strFromU8, unzipSync } from 'fflate';
import * as v from 'valibot';
import type { FetchTransport } from '../src/fetch-type.ts';
import type { Bucket } from './contracts.ts';
import { checkedDocument } from './storage/stored-documents.ts';

export const RAIL_STOPS_KEY = 'transit/rail-stops.json';
const NJ_STATIONS =
  'https://services.arcgis.com/Aur8tCo478N3VovT/arcgis/rest/services/NJ_Passenger_Rail_Stations/FeatureServer/0/query?where=RAIL_LINE%3C%3E%27PATCO%27&outFields=STATION,RAIL_LINE&returnGeometry=true&outSR=4326&geometryPrecision=5&f=json';
const METRO_NORTH_GTFS = 'https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip';
const MAX_BYTES = 16 * 1024 * 1024;

export type RailSystem = 'path' | 'njt' | 'light-rail' | 'metro-north';
export type RailStop = { name: string; system: RailSystem; line: string; latitude: number; longitude: number };

/** PATH in Manhattan: World Trade Center and the 6th Avenue stations to 33rd Street. */
const PATH_MANHATTAN: RailStop[] = [
  ['World Trade Center', 40.71271, -74.01193],
  ['Christopher Street', 40.73301, -74.00707],
  ['9th Street', 40.73424, -73.99895],
  ['14th Street', 40.73739, -73.99688],
  ['23rd Street', 40.74291, -73.99278],
  ['33rd Street', 40.74893, -73.98824],
].map(([name, latitude, longitude]) => ({
  name: name as string,
  system: 'path',
  line: 'PATH',
  latitude: latitude as number,
  longitude: longitude as number,
}));

const StopsSchema = v.object({
  checkedAt: v.string(),
  stops: v.array(
    v.object({
      name: v.string(),
      system: v.picklist(['path', 'njt', 'light-rail', 'metro-north']),
      line: v.string(),
      latitude: v.number(),
      longitude: v.number(),
    }),
  ),
});

async function download(fetcher: FetchTransport, url: string) {
  const response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Transit data returned HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('Transit data returned too much.');
  return bytes;
}

/** New Jersey's stations: NJ Transit rail, its light rail lines, and PATH. */
export async function loadNewJerseyStops(fetcher: FetchTransport): Promise<RailStop[]> {
  const data: unknown = JSON.parse(strFromU8(await download(fetcher, NJ_STATIONS)));
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) throw new Error('The New Jersey station list was not recognized.');
  return features.flatMap((feature) => {
    const { attributes, geometry } = feature as {
      attributes?: { STATION?: unknown; RAIL_LINE?: unknown };
      geometry?: { x?: unknown; y?: unknown };
    };
    const name = attributes?.STATION;
    const line = attributes?.RAIL_LINE;
    if (typeof name !== 'string' || typeof line !== 'string' || typeof geometry?.x !== 'number' || typeof geometry?.y !== 'number')
      return [];
    const system: RailSystem = line === 'PATH' ? 'path' : /light rail/i.test(line) ? 'light-rail' : 'njt';
    return [{ name: name.trim(), system, line, latitude: geometry.y, longitude: geometry.x }];
  });
}

/** Metro-North's stations, from the stops in its timetable. */
export async function loadMetroNorthStops(fetcher: FetchTransport): Promise<RailStop[]> {
  const files = unzipSync(await download(fetcher, METRO_NORTH_GTFS), { filter: (file) => file.name === 'stops.txt' });
  const text = files['stops.txt'];
  if (!text) throw new Error('The Metro-North timetable has no stops.');
  const [header = '', ...rows] = strFromU8(text).replace(/^﻿/, '').split(/\r?\n/);
  const columns = header.split(',');
  const at = (name: string) => columns.indexOf(name);
  const [name, latitude, longitude] = [at('stop_name'), at('stop_lat'), at('stop_lon')];
  if (name < 0 || latitude < 0 || longitude < 0) throw new Error('The Metro-North stops were not recognized.');
  return rows.flatMap((row) => {
    // Station names have no commas in Metro-North's file; a quoted one is unquoted.
    const cells = row.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim());
    const lat = Number(cells[latitude]);
    const lng = Number(cells[longitude]);
    if (!cells[name] || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) return [];
    return [{ name: cells[name]!, system: 'metro-north' as const, line: 'Metro-North', latitude: lat, longitude: lng }];
  });
}

/** Every source's stops; a source that fails keeps the stops it had in `before`. */
export async function loadRailStops(fetcher: FetchTransport, before: RailStop[] = [], now = new Date()) {
  const kept = (system: RailSystem[]) =>
    before.filter((stop) => system.includes(stop.system) && !PATH_MANHATTAN.some(({ name }) => name === stop.name));
  const [newJersey, metroNorth] = await Promise.allSettled([loadNewJerseyStops(fetcher), loadMetroNorthStops(fetcher)]);
  if (newJersey.status === 'rejected' && metroNorth.status === 'rejected') throw newJersey.reason;
  const stops = [
    ...(newJersey.status === 'fulfilled' ? newJersey.value : kept(['njt', 'light-rail', 'path'])),
    ...(metroNorth.status === 'fulfilled' ? metroNorth.value : kept(['metro-north'])),
    ...PATH_MANHATTAN,
  ];
  return { checkedAt: now.toISOString(), stops };
}

export async function readRailStops(bucket: Bucket) {
  const object = await bucket.get(RAIL_STOPS_KEY);
  return object ? checkedDocument(StopsSchema, await object.json().catch(() => null), RAIL_STOPS_KEY) : null;
}
