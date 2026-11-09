import { SearchInputError, isPoint, localWorkplace } from '../src/search.mjs';

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
