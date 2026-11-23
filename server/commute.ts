import type { AppEnv } from './contracts.ts';
import { isRecord, type Point, type SearchFilters } from '../src/domain.ts';
import type { SourceFetch } from './contracts.ts';
import type { Bucket } from './contracts.ts';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { SearchInputError, isPoint, localWorkplace } from '../src/search.ts';

const TRAVELTIME_URL = 'https://api.traveltimeapp.com/v4/time-filter/fast';
const MODES = { transit: 'public_transport', driving: 'driving+ferry' };

export class CommuteError extends Error {
  declare status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.status = status;
  }
}

export function routingCredentials(env: AppEnv) {
  const values = { appId: env.TRAVELTIME_APP_ID, apiKey: env.TRAVELTIME_API_KEY };
  return typeof values.appId === 'string' &&
    typeof values.apiKey === 'string' &&
    [values.appId, values.apiKey].every((value) => /^[\x21-\x7e]{1,256}$/.test(value))
    ? { appId: values.appId, apiKey: values.apiKey }
    : null;
}

const coords = ({ latitude: lat, longitude: lng }: Point) => ({ lat, lng });
const pointKey = ({ latitude, longitude }: Point) => `${latitude},${longitude}`;

/** Typical weekday-morning estimates change slowly, so routed times are reused for a week. */
const COMMUTE_CACHE_DAYS = 7;
const COMMUTE_CACHE_LIMIT = 60_000;
/** A TravelTime time-filter request: every listing to one workplace, by transit and by car. */
export type TravelTimeRequest = {
  locations: { id: string; coords: { lat: number; lng: number } }[];
  arrival_searches: {
    many_to_one: {
      id: string;
      arrival_location_id: string;
      departure_location_ids: string[];
      transportation: { type: string };
      travel_time: number;
      arrival_time_period: string;
      properties: string[];
    }[];
  };
};
type CachedTimes = { transit: number | null; driving: number | null; checkedAt: string };
type CommuteCache = { version: 1; workplace?: string; entries: Record<string, CachedTimes> };
/**
 * Workplaces can be any coordinates a user enters, and storage has no delete, so caches live in
 * a fixed number of slots chosen by a hash of the workplace. A new workplace may evict another's
 * cache; storage stays bounded either way.
 */
const COMMUTE_CACHE_SLOTS = 16;
const workplaceId = (workplace: Point) => `${workplace.latitude.toFixed(5)},${workplace.longitude.toFixed(5)}`;
function cacheKey(workplace: Point) {
  let hash = 0;
  for (const character of workplaceId(workplace)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `commutes/slot-${hash % COMMUTE_CACHE_SLOTS}.json.gz`;
}

async function readCommuteCache(bucket: Bucket, workplace: Point): Promise<CommuteCache> {
  try {
    const object = await bucket.get(cacheKey(workplace));
    // Written by saveCommuteCache below.
    const value = object
      ? (JSON.parse(strFromU8(gunzipSync(new Uint8Array(await object.arrayBuffer())))) as Partial<CommuteCache> | null)
      : null;
    return value?.version === 1 && value.workplace === workplaceId(workplace) && isRecord(value.entries)
      ? { version: 1, workplace: value.workplace, entries: value.entries }
      : { version: 1, workplace: workplaceId(workplace), entries: {} };
  } catch {
    return { version: 1, workplace: workplaceId(workplace), entries: {} };
  }
}

async function writeCommuteCache(bucket: Bucket, workplace: Point, cache: CommuteCache) {
  const newest = Object.entries(cache.entries)
    .sort(([, a], [, b]) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))
    .slice(0, COMMUTE_CACHE_LIMIT);
  // Best effort: a failed or concurrent write only means those origins are routed again.
  await bucket
    .put(
      cacheKey(workplace),
      gzipSync(strToU8(JSON.stringify({ version: 1, workplace: workplaceId(workplace), entries: Object.fromEntries(newest) }))),
    )
    .catch(() => null);
}

export async function routeCommutes<T extends { latitude?: unknown; longitude?: unknown }>(
  listings: T[],
  workplace: unknown,
  credentials: ReturnType<typeof routingCredentials>,
  fetcher: SourceFetch,
  now = new Date(),
  cache?: Bucket,
) {
  if (!credentials) throw new CommuteError('Automatic commute estimates are unavailable because the routing service is disconnected.');
  if (
    !isPoint(workplace) ||
    !('label' in workplace) ||
    typeof workplace.label !== 'string' ||
    !workplace.label ||
    workplace.label.length > 200 ||
    !Number.isFinite(now.getTime())
  )
    throw new CommuteError('Choose a valid workplace before calculating commute times.', 422);
  const origins = new Map();
  for (const listing of listings) {
    if (isPoint(listing) && !origins.has(pointKey(listing))) {
      origins.set(pointKey(listing), { id: String(origins.size), coords: coords(listing) });
    }
  }
  if (!origins.size) return listings.map((listing) => ({ ...listing, transitSeconds: null, drivingSeconds: null, commuteEstimate: null }));
  if (origins.size > 100_000) throw new CommuteError('Choose a smaller area or a lower rent limit to calculate commute times.', 422);
  const saved = cache ? await readCommuteCache(cache, workplace as Point) : null;
  const fresh = (entry: CachedTimes | undefined) => entry && now.getTime() - Date.parse(entry.checkedAt) < COMMUTE_CACHE_DAYS * 86_400_000;
  const known = new Map<string, CachedTimes>();
  for (const key of origins.keys()) {
    const entry = saved?.entries[key];
    if (fresh(entry)) known.set(key, entry!);
  }
  const locations = [...origins.entries()].filter(([key]) => !known.has(key)).map(([, origin]) => origin);
  const departure_location_ids = locations.map(({ id }) => id);
  const searches = Object.entries(MODES).map(([id, type]) => ({
    id,
    arrival_location_id: 'workplace',
    departure_location_ids,
    transportation: { type },
    travel_time: 10800,
    arrival_time_period: 'weekday_morning',
    properties: ['travel_time'],
  }));
  const body: TravelTimeRequest = {
    locations: [...locations, { id: 'workplace', coords: coords(workplace) }],
    arrival_searches: { many_to_one: searches },
  };

  let results: { search_id?: string; locations?: { id: string; properties?: { travel_time?: number } }[] }[] = [];
  if (locations.length)
    try {
      const response = await fetcher(TRAVELTIME_URL, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'X-Application-Id': credentials.appId, 'X-Api-Key': credentials.apiKey },
        body: JSON.stringify(body),
      });
      if ([401, 403].includes(response.status)) throw new CommuteError('The routing service rejected the server credentials.');
      if (response.status === 429) throw new CommuteError('TravelTime reached its request limit. Try the commute search again later.');
      if (!response.ok) throw new Error('Routing request failed');
      const routed = (await response.json()) as { results?: typeof results } | null;
      if (!Array.isArray(routed?.results)) throw new Error('Invalid routing response');
      results = routed.results;
    } catch (error) {
      if (error instanceof CommuteError) throw error;
      throw new CommuteError('TravelTime couldn’t calculate routes. Try again, or search without commute times.');
    }
  const timesByMode = Object.fromEntries(
    searches.map(({ id }) => {
      if (!locations.length) return [id, new Map()];
      const result = results.find((entry) => entry?.search_id === id);
      if (!Array.isArray(result?.locations)) throw new CommuteError('TravelTime returned incomplete commute estimates. Try again.');
      return [
        id,
        new Map(
          result.locations.flatMap((location) => {
            const seconds = location?.properties?.travel_time;
            return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 && seconds <= 10800
              ? [[location.id, seconds]]
              : [];
          }),
        ),
      ];
    }),
  );
  const checkedAt = now.toISOString();
  const keyById = new Map([...origins.entries()].map(([key, origin]) => [origin.id, key]));
  for (const { id } of locations) {
    known.set(keyById.get(id)!, { transit: timesByMode.transit.get(id) ?? null, driving: timesByMode.driving.get(id) ?? null, checkedAt });
  }
  if (cache && saved && locations.length) {
    await writeCommuteCache(cache, workplace as Point, { version: 1, entries: { ...saved.entries, ...Object.fromEntries(known) } });
  }
  return listings.map((listing) => {
    const times = isPoint(listing) ? known.get(pointKey(listing)) : undefined;
    return {
      ...listing,
      commuteEstimate:
        times === undefined
          ? null
          : {
              provider: 'TravelTime',
              arrivalPeriod: 'weekday_morning',
              checkedAt: times.checkedAt,
              destination: { label: workplace.label, latitude: workplace.latitude, longitude: workplace.longitude },
            },
      transitSeconds: times?.transit ?? null,
      drivingSeconds: times?.driving ?? null,
    };
  });
}

/** One Census geocoder match for a street address (already checked by GeocodeRequestSchema or SearchFiltersSchema). */
/** The NY, NJ and CT area the app covers, as Nominatim's west,north,east,south viewbox. */
const METRO_VIEWBOX = '-75.6,41.7,-71.7,39.9';
/**
 * OpenStreetMap's Nominatim finds places by name (Empire State Building, Hoboken PATH) as well as addresses.
 * Its usage policy asks for an identifying User-Agent, at most one request a second and caching; searches
 * repeat the same destination, so answers are kept for 30 days in Cloudflare's cache (where there is one), and
 * the API's lookup limit bounds the rest.
 */
async function nominatim(query: string, fetcher: SourceFetch) {
  const params = new URLSearchParams({ q: query, format: 'jsonv2', limit: '1', countrycodes: 'us', viewbox: METRO_VIEWBOX, bounded: '1' });
  const url = `https://nominatim.openstreetmap.org/search?${params}`;
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cached = await cache?.match(url);
  const response =
    cached ??
    (await fetcher(url, {
      headers: { 'User-Agent': 'ApartmentSearch/1.0 (personal apartment search app)', Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    }));
  if (!response.ok) throw new Error('OpenStreetMap search is temporarily unavailable.');
  if (cache && !cached) {
    const body = await response.clone().text();
    await cache.put(url, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=2592000' } }));
  }
  const matches = (await response.json()) as { display_name?: unknown; lat?: unknown; lon?: unknown }[] | null;
  const match = Array.isArray(matches) ? matches[0] : undefined;
  if (!match) return null;
  const point = {
    // "Empire State Building, 350, 5th Avenue, Koreatown, …" → its first three parts.
    label: typeof match.display_name === 'string' ? match.display_name.split(', ').slice(0, 3).join(', ') : query,
    latitude: Number(match.lat),
    longitude: Number(match.lon),
  };
  return isPoint(point) ? point : null;
}

/** A destination typed as an address or a place name: OpenStreetMap first, then the U.S. Census geocoder. */
export async function geocodeAddress(address: string, fetcher: SourceFetch = fetch) {
  return (await nominatim(address.trim(), fetcher).catch(() => null)) ?? censusAddress(address, fetcher);
}

/** The U.S. Census geocoder: exact street addresses only, one match or none. */
async function censusAddress(address: string, fetcher: SourceFetch) {
  const query = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  const response = await fetcher(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${query}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Address geocoding is temporarily unavailable.');
  const body = (await response.json()) as {
    result?: { addressMatches?: ({ matchedAddress?: string; coordinates?: { x?: unknown; y?: unknown } } | null)[] };
  } | null;
  const matches = body?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1 || !matches[0]?.coordinates) {
    throw new SearchInputError('That place could not be found. Try a street address with the city, or a landmark name.');
  }
  const { matchedAddress, coordinates } = matches[0];
  const point = { label: matchedAddress || address, latitude: coordinates.y, longitude: coordinates.x };
  if (!isPoint(point)) throw new SearchInputError('The address could not be located.');
  return point;
}

export async function resolveWorkplace(filters: SearchFilters, fetcher: SourceFetch) {
  return localWorkplace(filters) ?? geocodeAddress(filters.customWorkplace, fetcher);
}
