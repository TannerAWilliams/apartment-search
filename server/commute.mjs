import { SearchInputError, isPoint, localWorkplace } from '../src/search.mjs';

const TRAVELTIME_URL = 'https://api.traveltimeapp.com/v4/time-filter/fast';
const MODES = { transit: 'public_transport', driving: 'driving+ferry' };

export class CommuteError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

export function routingCredentials(env) {
  const values = { appId: env.TRAVELTIME_APP_ID, apiKey: env.TRAVELTIME_API_KEY };
  return [values.appId, values.apiKey].every((value) =>
    typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value)) ? values : null;
}

const coords = ({ latitude: lat, longitude: lng }) => ({ lat, lng });
const pointKey = ({ latitude, longitude }) => `${latitude},${longitude}`;

export async function routeCommutes(listings, workplace, credentials, fetcher) {
  if (!credentials) throw new CommuteError('Automatic commute estimates are unavailable because the routing service is disconnected.');
  const origins = new Map();
  for (const listing of listings) {
    if (isPoint(listing) && !origins.has(pointKey(listing))) {
      origins.set(pointKey(listing), { id: String(origins.size), coords: coords(listing) });
    }
  }
  if (!origins.size) return listings;
  if (origins.size > 100_000) throw new CommuteError('Choose a smaller area or a lower rent limit to calculate commute times.', 422);
  const locations = [...origins.values()];
  const departure_location_ids = locations.map(({ id }) => id);
  const searches = Object.entries(MODES).map(([id, type]) => ({
    id, arrival_location_id: 'workplace', departure_location_ids,
    transportation: { type }, travel_time: 10800, arrival_time_period: 'weekday_morning', properties: ['travel_time'],
  }));
  const body = { locations: [...locations, { id: 'workplace', coords: coords(workplace) }],
    arrival_searches: { many_to_one: searches } };

  let results;
  try {
    const response = await fetcher(TRAVELTIME_URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', 'X-Application-Id': credentials.appId, 'X-Api-Key': credentials.apiKey },
      body: JSON.stringify(body),
    });
    if ([401, 403].includes(response.status)) throw new CommuteError('The routing service rejected the server credentials.');
    if (response.status === 429) throw new CommuteError('TravelTime reached its request limit. Try the commute search again later.');
    if (!response.ok) throw new Error('Routing request failed');
    ({ results } = await response.json());
    if (!Array.isArray(results)) throw new Error('Invalid routing response');
  } catch (error) {
    if (error instanceof CommuteError) throw error;
    throw new CommuteError('TravelTime couldn’t calculate routes. Try again, or search without commute times.');
  }
  const timesByMode = Object.fromEntries(searches.map(({ id }) => {
    const result = results.find((entry) => entry?.search_id === id);
    if (!Array.isArray(result?.locations)) throw new CommuteError('TravelTime returned incomplete commute estimates. Try again.');
    return [id, new Map(result.locations.flatMap((location) => {
      const seconds = location?.properties?.travel_time;
      return Number.isFinite(seconds) && seconds >= 0 && seconds <= 10800 ? [[location.id, seconds]] : [];
    }))];
  }));
  return listings.map((listing) => {
    const id = origins.get(pointKey(listing))?.id;
    return { ...listing, transitSeconds: timesByMode.transit.get(id) ?? null, drivingSeconds: timesByMode.driving.get(id) ?? null };
  });
}

export async function geocodeAddress(address, fetcher = fetch) {
  if (typeof address !== 'string' || address.trim().length < 4 || address.length > 160) {
    throw new SearchInputError('Enter a full street address with city, state and ZIP.');
  }
  const query = new URLSearchParams({
    address,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  const response = await fetcher(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${query}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Address geocoding is temporarily unavailable.');
  const body = await response.json();
  const matches = body?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1 || !matches[0]?.coordinates) {
    throw new SearchInputError('Use a full street address with city, state, and ZIP, or enter coordinates.');
  }
  const match = matches[0];
  const point = {
    label: match.matchedAddress || address,
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
  };
  if (!isPoint(point)) throw new SearchInputError('The address could not be located.');
  return point;
}

export async function resolveWorkplace(filters, fetcher) {
  return localWorkplace(filters) ?? geocodeAddress(filters.customWorkplace, fetcher);
}
