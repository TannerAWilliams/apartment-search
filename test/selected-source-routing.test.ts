import { test, expect, setSystemTime } from 'bun:test';
import { search } from '../server/search.ts';
import type { SourceFetch } from '../server/refresh.ts';
import { parseFilters } from '../src/search.ts';

const base = { city: 'Jersey City', state: 'NJ', zipCode: '07302', bedrooms: 1, price: 2000, status: 'Active', longitude: -74.04 };
const selectedRows = [
  { ...base, id: 'selected-1', addressLine1: '12 Grove Street', latitude: 40.72, url: 'https://www.zillow.com/homedetails/test-1/' },
  { ...base, id: 'selected-2', addressLine1: '14 Grove Street', latitude: 40.73, url: 'https://www.zillow.com/homedetails/test-2/' },
];
const otherRows = [{ ...base, id: 'other-1', addressLine1: '16 Grove Street', latitude: 40.74, url: 'https://www.realtor.com/realestateandhomes-detail/test-3' }];
const env = { TRAVELTIME_APP_ID: 'synthetic-app', TRAVELTIME_API_KEY: 'synthetic-key', FREE_PARTNER_FEEDS_JSON: JSON.stringify([
  { id: 'zillow', url: 'https://synthetic.example.test/zillow' },
  { id: 'realtor', url: 'https://synthetic.example.test/realtor' },
]) };
function mock() {
  const routedLatitudes: number[][] = [];
  const fetcher: SourceFetch = async (url, options) => {
    if (url === 'https://synthetic.example.test/zillow') return Response.json(selectedRows);
    if (url === 'https://synthetic.example.test/realtor') return Response.json(otherRows);
    expect(url).toBe('https://api.traveltimeapp.com/v4/time-filter/fast');
    const body = JSON.parse(String(options?.body)) as { locations: { id: string; coords: { lat: number } }[] };
    const origins = body.locations.filter(location => location.id !== 'workplace');
    routedLatitudes.push(origins.map(origin => origin.coords.lat));
    return Response.json({ results: ['transit', 'driving'].map(search_id => ({ search_id, locations: origins.map((origin, index) => ({ id: origin.id, properties: { travel_time: index === 0 ? 600 : 2400 } })) })) });
  };
  return { fetcher, routedLatitudes };
}

test('selected website routes only its origins while retaining all-source counts without commute limits', async () => {
  const fixture = mock();
  const result = await search(parseFilters({ source: 'zillow', liveOnly: true, includeCommute: true }), env, fixture.fetcher);
  expect(fixture.routedLatitudes).toEqual([[40.72, 40.73]]);
  expect(result.total).toBe(2);
  expect(result.eligibleTotal).toBe(3);
  expect(result.sourceCounts.map(source => [source.id, source.count]).sort()).toEqual([['realtor', 1], ['zillow', 2]]);
  expect(result.matches.every(listing => listing.commuteEstimate?.destination.label === result.workplace.label)).toBe(true);
});

test('commute limits exclude unrequested unknown routes and disclose scoped eligible counts', async () => {
  const fixture = mock();
  const result = await search(parseFilters({ source: 'zillow', liveOnly: true, maxTransitMinutes: 30 }), env, fixture.fetcher);
  expect(fixture.routedLatitudes).toEqual([[40.72, 40.73]]);
  expect(result.total).toBe(1);
  expect(result.eligibleTotal).toBe(1);
  expect(result.matches[0].transitSeconds).toBe(600);
  expect(result.sourceCounts.map(source => source.id)).toEqual(['zillow']);
  expect(result.notices.some(notice => notice.includes('Other websites were not routed'))).toBe(true);
});

test('an empty selected website sends no routing request, preserving inventory counts', async () => {
  const fixture = mock();
  const result = await search(parseFilters({ source: 'no-matching-site', liveOnly: true, includeCommute: true }), env, fixture.fetcher);
  expect(fixture.routedLatitudes).toEqual([]);
  expect(result.total).toBe(0);
  expect(result.eligibleTotal).toBe(3);
});

test('all-websites selection still routes all matching origins', async () => {
  const fixture = mock();
  const result = await search(parseFilters({ liveOnly: true, includeCommute: true }), env, fixture.fetcher);
  expect(fixture.routedLatitudes[0].sort()).toEqual([40.72, 40.73, 40.74]);
  expect(result.total).toBe(3);
});

test('live search reports earliest contributing saved-source expiry without refreshing or routing', async () => {
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const { gzipSync, strToU8 } = await import('fflate');
  const { normalizeListing } = await import('../src/listings.ts');
  const bucket = createMemoryBucket();
  const now = new Date();
  const older = new Date(now.getTime() - 30 * 60_000).toISOString();
  const fresh = now.toISOString();
  const listing = normalizeListing(selectedRows[0], { id: 'openigloo', name: 'Openigloo', kind: 'feed' });
  expect(listing).not.toBeNull();
  await bucket.put('rentals/openigloo.json.gz', gzipSync(strToU8(JSON.stringify({ listings: [listing] }))));
  await bucket.put('rentals/streeteasy-live.json.gz', gzipSync(strToU8(JSON.stringify({ listings: [] }))));
  await bucket.put('rentals/refresh.json', JSON.stringify({ sources: [
    { id: 'openigloo', name: 'Openigloo', status: 'updated', checkedAt: older, updatedAt: older },
    { id: 'streeteasy-live', name: 'StreetEasy', status: 'updated', transport: 'v6-daily', checkedAt: fresh, updatedAt: fresh },
  ] }));
  const result = await search(parseFilters({ liveOnly: true }), { BUCKET: bucket }, () => { throw new Error('No external requests permitted'); });
  expect(result.inventoryExpiresAt).toBe(new Date(Date.parse(older) + 24 * 60 * 60_000).toISOString());
  expect(result.total).toBe(1);
});

test('verified unit links participate in source selection before routing', async () => {
  let origins = 0;
  const result = await search(parseFilters({ source: 'brodsky', liveOnly: true, includeCommute: true }), env, async (url, options) => {
    if (url === 'https://synthetic.example.test/zillow') return Response.json([{ ...selectedRows[0], url: 'https://streeteasy.com/building/one-columbus-place/s21d' }]);
    if (url === 'https://synthetic.example.test/realtor') return Response.json([]);
    expect(url).toBe('https://api.traveltimeapp.com/v4/time-filter/fast');
    const body = JSON.parse(String(options?.body)) as { locations: { id: string }[] };
    const selected = body.locations.filter(location => location.id !== 'workplace');
    origins = selected.length;
    return Response.json({ results: ['transit', 'driving'].map(search_id => ({ search_id, locations: selected.map(location => ({ id: location.id, properties: { travel_time: 600 } })) })) });
  });
  expect(origins).toBe(1);
  expect(result.total).toBe(1);
  expect(result.matches[0].sources.some(source => source.id === 'brodsky' && source.url)).toBe(true);
});


test('inventory deadline survives expiry while awaiting routing', async () => {
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const { gzipSync, strToU8 } = await import('fflate');
  const { normalizeListing } = await import('../src/listings.ts');
  const bucket = createMemoryBucket();
  const started = new Date('2026-11-17T12:00:00Z');
  const deadline = new Date(started.getTime() + 1_000);
  const updatedAt = new Date(deadline.getTime() - 24 * 60 * 60_000).toISOString();
  const listing = normalizeListing(selectedRows[0], { id: 'openigloo', name: 'Openigloo', kind: 'feed' });
  await bucket.put('rentals/openigloo.json.gz', gzipSync(strToU8(JSON.stringify({ listings: [listing] }))));
  await bucket.put('rentals/refresh.json', JSON.stringify({ sources: [
    { id: 'openigloo', name: 'Openigloo', status: 'updated', checkedAt: updatedAt, updatedAt },
  ] }));
  setSystemTime(started);
  try {
    const result = await search(parseFilters({ liveOnly: true, includeCommute: true }), {
      BUCKET: bucket, TRAVELTIME_APP_ID: 'synthetic-app', TRAVELTIME_API_KEY: 'synthetic-key',
    }, async (url, options) => {
      expect(url).toBe('https://api.traveltimeapp.com/v4/time-filter/fast');
      const body = JSON.parse(String(options?.body)) as { locations: { id: string }[] };
      setSystemTime(new Date(deadline.getTime() + 1_000));
      return Response.json({ results: ['transit', 'driving'].map(search_id => ({ search_id,
        locations: body.locations.filter(location => location.id !== 'workplace').map(location => ({
          id: location.id, properties: { travel_time: 600 },
        })),
      })) });
    });
    expect(result.total).toBe(1);
    expect(result.inventoryExpiresAt).toBe(deadline.toISOString());
    expect(Date.parse(result.inventoryExpiresAt!)).toBeLessThan(Date.now());
  } finally {
    setSystemTime();
  }
});


test('inventory refreshed during destination resolution retains its expiry', async () => {
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const { gzipSync, strToU8 } = await import('fflate');
  const { normalizeListing } = await import('../src/listings.ts');
  const bucket = createMemoryBucket();
  const started = new Date('2026-11-17T12:00:00Z');
  const refreshed = new Date(started.getTime() + 60_000);
  const listing = normalizeListing(selectedRows[0], { id: 'openigloo', name: 'Openigloo', kind: 'feed' });
  await bucket.put('rentals/openigloo.json.gz', gzipSync(strToU8(JSON.stringify({ listings: [listing] }))));
  setSystemTime(started);
  try {
    const result = await search(parseFilters({ liveOnly: true, workplace: 'custom', customWorkplace: '350 Fifth Avenue, New York, NY 10118' }), { BUCKET: bucket }, async url => {
      expect(new URL(url).hostname).toBe('geocoding.geo.census.gov');
      setSystemTime(refreshed);
      await bucket.put('rentals/refresh.json', JSON.stringify({ sources: [
        { id: 'openigloo', name: 'Openigloo', status: 'updated', checkedAt: refreshed.toISOString(), updatedAt: refreshed.toISOString() },
      ] }));
      return Response.json({ result: { addressMatches: [{ matchedAddress: '350 Fifth Avenue', coordinates: { x: -73.9857, y: 40.7484 } }] } });
    });
    expect(result.total).toBe(1);
    expect(result.inventoryExpiresAt).toBe(new Date(refreshed.getTime() + 24 * 60 * 60_000).toISOString());
  } finally {
    setSystemTime();
  }
});
