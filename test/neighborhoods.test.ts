import { expect, test } from 'bun:test';
import { neighborhoodReport, summarizeNeighborhood, zipComplaints } from '../server/neighborhoods.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { testListing } from './fixtures/listing.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const now = new Date('2026-11-24T12:00:00Z');
const facts = { openViolations: 0, complaints: 0, bedbugs: false, flood: false, checkedAt: now.toISOString() };
/** NYC Open Data's 311 requests, grouped by type. */
const city = (
  rows: unknown[] = [
    { complaint_type: 'Noise - Residential', count: '40' },
    { complaint_type: 'Noise - Street/Sidewalk', count: '10' },
    { complaint_type: 'HEAT/HOT WATER', count: '12' },
    { complaint_type: 'Rodent', count: '3' },
    { complaint_type: 'PLUMBING', count: '2' },
    { complaint_type: 'Illegal Parking', count: '99' },
    { count: 'x' },
  ],
) => {
  const requests: URL[] = [];
  const fetcher = async (url: string) => {
    requests.push(new URL(url));
    return Response.json(rows);
  };
  return { fetcher, requests };
};

test('a neighborhood’s listings are summarized by size, ZIP code and building', () => {
  const summary = summarizeNeighborhood([
    testListing({ id: '1', bedrooms: 1, rent: 3000, zip: '10014', city: 'Manhattan', building: { ...facts, stabilized: true } }),
    testListing({
      id: '2',
      bedrooms: 1,
      rent: 3400,
      zip: '10014',
      address: '2 Bank Street',
      building: { ...facts, stabilized: false, openViolations: 30, complaints: 20 },
    }),
    testListing({ id: '3', bedrooms: 6, rent: 9000, zip: '10011' }),
    testListing({ id: '4', bedrooms: 1, rent: 3200, zip: '' }),
    testListing({
      id: '5',
      address: '5 Bank Street',
      bedrooms: 2,
      rent: 4000,
      zip: '10014',
      building: { ...facts, stabilized: null, openViolations: null, complaints: null, bedbugs: null, flood: null },
    }),
  ]);
  expect(summary).toEqual({
    listings: 5,
    borough: 'Manhattan',
    zips: ['10014', '10011'],
    sizes: [
      { bedrooms: 0, count: 0, median: null },
      { bedrooms: 1, count: 3, median: 3200 },
      { bedrooms: 2, count: 1, median: 4000 },
      { bedrooms: 3, count: 0, median: null },
      { bedrooms: 4, count: 1, median: 9000 },
    ],
    buildings: { known: 3, stabilized: 1, grades: { A: 1, B: 0, C: 0, D: 1 } },
  });
  expect(summarizeNeighborhood([testListing({ bedrooms: 1, rent: 1 }), testListing({ bedrooms: 1, rent: 3 })]).sizes[1].median).toBe(2);
  expect(summarizeNeighborhood([]).borough).toBeNull();
});

test('a ZIP code’s 311 complaints are grouped and kept for a week', async () => {
  const bucket = createMemoryBucket();
  const { fetcher, requests } = city();
  const first = await zipComplaints(bucket, '10014', fetcher, now);
  expect(first.counts).toEqual({ Noise: 50, 'Heat and hot water': 12, Rodents: 3, 'Building conditions': 2 });
  expect(requests[0]?.searchParams.get('$where')).toBe("incident_zip='10014' AND created_date >= '2025-11-24T00:00:00'");
  await zipComplaints(bucket, '10014', fetcher, new Date(now.getTime() + 86_400_000));
  expect(requests.length, 'read from storage within a week').toBe(1);
  await zipComplaints(bucket, '10014', fetcher, new Date(now.getTime() + 8 * 86_400_000));
  expect(requests.length).toBe(2);
  expect((await zipComplaints(undefined, '10014', fetcher, now)).zip).toBe('10014');
});

test('the neighborhood API reports listings and complaints, and still answers when 311 cannot be read', async () => {
  const { fetcher } = city();
  const report = await readJson<{ name: string; listings: number; complaints: unknown }>(
    handleApi(new Request('https://app.test/api/neighborhood?name=Nowhere'), {}, { fetcher }),
  );
  expect(report).toMatchObject({ name: 'Nowhere', listings: 0, complaints: null });
  expect((await handleApi(new Request('https://app.test/api/neighborhood?name=x'), {})).status).toBe(422);
  // The bundled sample inventory has New York City neighborhoods.
  const { search, offline } = await import('../server/search.ts');
  const { parseFilters } = await import('../src/search.ts');
  const sample = (await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: null }), {}, offline, true)).matches.find(
    ({ neighborhood }) => neighborhood,
  )!;
  const found = await neighborhoodReport({}, sample.neighborhood!, fetcher);
  expect(found.listings).toBeGreaterThan(0);
  expect(found.complaints?.counts.Noise).toBe(50);
  const down = await neighborhoodReport({}, sample.neighborhood!, async () => new Response('busy', { status: 503 }));
  expect(down.complaints).toBeNull();
});
