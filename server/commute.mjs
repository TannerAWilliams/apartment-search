import { SearchInputError, isPoint, localWorkplace } from '../src/search.mjs';

const ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function easternParts(date) {
  return Object.fromEntries(ET.formatToParts(date)
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

export function nextWeekdayArrival(arrival, now = new Date()) {
  const today = easternParts(now);
  const [hours, minutes] = arrival.split(':').map(Number);

  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const wallTime = new Date(Date.UTC(today.year, today.month - 1, today.day + daysAhead, hours, minutes));
    if ([0, 6].includes(wallTime.getUTCDay())) continue;

    // Translate the chosen New York wall time into UTC using the offset on that day.
    const eastern = easternParts(wallTime);
    const easternAsUtc = Date.UTC(eastern.year, eastern.month - 1, eastern.day,
      eastern.hour, eastern.minute, eastern.second);
    const utc = new Date(wallTime.getTime() + (wallTime.getTime() - easternAsUtc));
    if (utc > now) return utc.toISOString();
  }
  throw new Error('Could not determine the next weekday commute.');
}

export async function resolveWorkplace(filters, fetcher) {
  const preset = localWorkplace(filters);
  if (preset) return preset;

  const query = new URLSearchParams({
    address: filters.customWorkplace,
    benchmark: 'Public_AR_Current',
    format: 'json',
  });
  const response = await fetcher(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${query}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Workplace geocoding is temporarily unavailable.');
  const body = await response.json();
  const matches = body?.result?.addressMatches;
  if (!Array.isArray(matches) || matches.length !== 1 || !matches[0]?.coordinates) {
    throw new SearchInputError('Use a full workplace street address with city, state, and ZIP, or enter coordinates.');
  }

  const match = matches[0];
  const workplace = {
    label: match.matchedAddress || filters.customWorkplace,
    latitude: match.coordinates.y,
    longitude: match.coordinates.x,
  };
  if (!isPoint(workplace)) throw new SearchInputError('The workplace address could not be located.');
  return workplace;
}

function waypoint(point) {
  return { waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } } };
}

export async function fetchTransitRoutes(origins, workplace, arrival, apiKey, fetcher) {
  if (origins.length === 0) return new Map();
  const response = await fetcher('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,status,condition,duration,distanceMeters',
    },
    body: JSON.stringify({
      origins: origins.map(waypoint),
      destinations: [waypoint(workplace)],
      travelMode: 'TRANSIT',
      arrivalTime: arrival,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('Transit routing is temporarily unavailable.');

  const body = await response.json();
  if (!Array.isArray(body)) throw new Error('Transit routing returned an invalid response.');
  const result = new Map();
  for (const row of body) {
    if (!row) continue;
    const origin = origins[row.originIndex ?? 0];
    if (!origin || (row.destinationIndex ?? 0) !== 0 || (row.status?.code ?? 0) !== 0 || row.condition !== 'ROUTE_EXISTS') continue;
    const duration = typeof row.duration === 'string' ? row.duration.match(/^(\d+(?:\.\d+)?)s$/) : null;
    if (!duration || !Number.isFinite(Number(duration[1]))) continue;
    result.set(origin.id, {
      transitSeconds: Number(duration[1]),
      transitMiles: Number.isFinite(row.distanceMeters) && row.distanceMeters >= 0 ? row.distanceMeters / 1609.344 : null,
    });
  }
  return result;
}
