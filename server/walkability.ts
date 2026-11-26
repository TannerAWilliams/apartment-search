/**
 * Walkability, from the EPA's National Walkability Index: a figure from 1 to 20 for every census block group in
 * the country, from how dense its street intersections are, how mixed its jobs and homes, and how near transit
 * is. It is public and free to use. The index is asked for by point, so the app keeps what it has learned by map
 * cell (about a block across) and the nightly run asks about the cells listings are in that it does not know yet.
 */
import { isRecord, type ListingData } from '../src/domain.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { walkCell } from '../src/insights.ts';
import * as v from 'valibot';
import { mapLimit } from './concurrency.ts';
import type { Bucket } from './contracts.ts';
import { checkedDocument } from './storage/stored-documents.ts';

const SERVICE = 'https://geodata.epa.gov/arcgis/rest/services/OA/WalkabilityIndex/MapServer/0/query';
export const WALKABILITY_KEY = 'places/walkability.json';
/** A cell with no figure (water, a park, outside the index) is remembered as this, so it is not asked about again. */
const NONE = 0;
const Schema = v.object({ cells: v.record(v.string(), v.number()) });

/** The index at a point, or null where the EPA has none. Throws when the service cannot be read. */
export async function walkabilityAt(latitude: number, longitude: number, fetcher: FetchTransport) {
  const query = new URLSearchParams({
    f: 'json',
    geometry: `${longitude},${latitude}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'NatWalkInd',
    returnGeometry: 'false',
  });
  const response = await fetcher(SERVICE + '?' + query, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`The walkability index returned HTTP ${response.status}.`);
  const data: unknown = await response.json();
  if (!isRecord(data) || data.error || !Array.isArray(data.features)) throw new Error('The walkability index was not recognized.');
  const [feature] = data.features;
  const index = isRecord(feature) && isRecord(feature.attributes) ? feature.attributes.NatWalkInd : undefined;
  return typeof index === 'number' && index >= 1 && index <= 20 ? index : null;
}

/** Walkability by map cell, as kept; empty before the first night's run. */
export async function readWalkability(bucket: Bucket): Promise<Record<string, number>> {
  const object = await bucket.get(WALKABILITY_KEY);
  return (object && checkedDocument(Schema, await object.json().catch(() => null), WALKABILITY_KEY)?.cells) ?? {};
}

/**
 * Learns the index for up to `limit` cells that listings are in and the app does not know yet, a few at a time.
 * A cell the service cannot answer for tonight is asked about again another night. Returns how many it learned.
 */
export async function fillWalkability(bucket: Bucket, listings: ListingData[], fetcher: FetchTransport, limit = 800) {
  const cells = await readWalkability(bucket);
  const wanted = new Map<string, [number, number]>();
  for (const { latitude, longitude } of listings) {
    const cell = walkCell(latitude, longitude);
    if (!cell || cell in cells || wanted.has(cell)) continue;
    wanted.set(cell, [latitude as number, longitude as number]);
    if (wanted.size >= limit) break;
  }
  const learned = await mapLimit([...wanted], 4, async ([cell, [latitude, longitude]]) => {
    try {
      return [cell, (await walkabilityAt(latitude, longitude, fetcher)) ?? NONE] as const;
    } catch {
      return null;
    }
  });
  const found = learned.filter((entry) => entry !== null);
  if (found.length) await bucket.put(WALKABILITY_KEY, JSON.stringify({ cells: { ...cells, ...Object.fromEntries(found) } }));
  return found.length;
}

/** Learns the next cells from saved inventory (see fillWalkability). */
export async function fillWalkabilityFromInventory(
  env: Parameters<typeof import('./search.ts').search>[1] & { BUCKET: Bucket },
  fetcher: FetchTransport,
) {
  const { search, offline } = await import('./search.ts');
  const { parseFilters } = await import('../src/search.ts');
  const { matches } = await search(parseFilters({ region: 'all', bedrooms: null, maxRent: null }), env, offline, true);
  return fillWalkability(env.BUCKET, matches, fetcher);
}
