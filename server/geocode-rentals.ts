import type { ListingData } from '../src/domain.ts';
import type { SourceFetch } from './refresh.ts';
import { parse } from 'csv-parse/browser/esm/sync';

const csvField = (value: unknown) => '"' + String(value).replaceAll('"', '""') + '"';

export async function geocodeRentalAddresses<T extends Pick<ListingData, 'id' | 'address' | 'city' | 'state' | 'zip'>>(listings: T[], fetcher: SourceFetch, timeout = 14000) {
  if (!listings.length) return listings;
  const data = listings.map(({ id, address, city, state, zip }) =>
    [id, address, city === 'Manhattan' ? 'New York' : city, state, zip].map(csvField).join(',')).join('\n');
  const form = new FormData();
  form.set('addressFile', new Blob([data], { type: 'text/csv' }), 'apartments.csv');
  form.set('benchmark', 'Public_AR_Current');
  const response = await fetcher('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
    method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) return listings;
  const points = new Map();
  for (const row of parse(await response.text(), { skip_empty_lines: true, relax_column_count: true })) {
    if (row[2] !== 'Match' || row[3] !== 'Exact') continue;
    const [longitude, latitude] = (row[5] ?? '').split(',').map(Number);
    if (latitude >= 40 && latitude <= 42 && longitude >= -75 && longitude <= -72) {
      points.set(row[0], { latitude, longitude });
    }
  }
  return listings.map((listing) => ({ ...listing, ...points.get(listing.id) }));
}
