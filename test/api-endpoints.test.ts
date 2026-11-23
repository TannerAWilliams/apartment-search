import { expect, test } from 'bun:test';
import { gzipSync, strToU8 } from 'fflate';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { buildingKey, normalizeListing } from '../src/listings.ts';
import type { Bucket, HousingResponse } from '../server/contracts.ts';
import type { RefreshInfo } from '../src/api-client.ts';
import type { SearchResult } from '../src/domain.ts';
import { readJson, type ErrorBody } from './fixtures/json.ts';

const url = (path: string) => 'https://app.test' + path;
const get = (path: string) => new Request(url(path));
const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(path), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
const failingBucket: Bucket = { get: async () => { throw new Error('storage down'); }, head: async () => { throw new Error('storage down'); }, put: async () => null };
const noNetwork = async () => { throw new Error('No external requests in this test.'); };

test('affordable housing: GET only, saved lotteries and re-rentals, and an honest storage failure', async () => {
  const bucket = createMemoryBucket();
  expect((await handleApi(postJson('/api/housing', {}), { BUCKET: bucket })).status).toBe(405);
  await bucket.put('rentals/housing-connect.json', JSON.stringify({ publishedAt: null, opportunities: [{ id: '1', name: 'Lottery', closes: '2999-01-01', addresses: [], buildingKeys: [], sizes: [], borough: 'Bronx', url: 'https://housingconnect.nyc.gov/1' }] }), { customMetadata: { updatedAt: '2026-11-20T00:00:00Z' } });
  const saved = await readJson<HousingResponse>(handleApi(get('/api/housing'), { BUCKET: bucket }));
  expect(saved.opportunities.length).toBe(1);
  expect(saved.rerentals).toBeNull();
  const failed = await handleApi(get('/api/housing'), { BUCKET: failingBucket });
  expect(failed.status).toBe(503);
  expect((await readJson<ErrorBody>(failed)).error).toMatch(/Housing Connect data could not be read/);
});

test('rent charts reject unknown regions and groupings, and report unreadable data', async () => {
  expect((await handleApi(get('/api/market?region=mars'), { BUCKET: createMemoryBucket() })).status).toBe(422);
  expect((await handleApi(get('/api/market?region=nyc&grouping=planet'), { BUCKET: createMemoryBucket() })).status).toBe(422);
  const failed = await handleApi(get('/api/market?region=nyc'), { BUCKET: failingBucket });
  expect(failed.status).toBe(503);
  expect((await readJson<ErrorBody>(failed)).error).toMatch(/rent data could not be read/);
});

test('malformed requests are refused before any work', async () => {
  const bucket = createMemoryBucket();
  expect((await handleApi(postJson('/api/refresh', { check: 'now' }), {})).status, 'refresh needs storage').toBe(400);
  expect((await handleApi(new Request(url('/api/refresh'), { method: 'POST', body: '{}' }), { BUCKET: bucket })).status, 'refresh needs JSON').toBe(400);
  const declared = new Request(url('/api/search'), { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'Content-Length': '99999999' } });
  expect((await handleApi(declared, { BUCKET: bucket })).status).toBe(413);
  expect((await handleApi(postJson('/api/search', 'not json'), { BUCKET: bucket })).status).toBe(400);
  expect((await handleApi(postJson('/api/refresh', { payload: 'AAAA' }), { BUCKET: bucket }, { fetcher: noNetwork })).status, 'an import that does not decode').toBe(422);
  const commute = new Request(url('/api/search'), { method: 'POST', body: JSON.stringify({ includeCommute: true }), headers: { 'Content-Type': 'text/plain' } });
  expect((await handleApi(commute, { BUCKET: bucket })).status).toBe(400);
});

test('a full refresh also starts the sync Workflow, and a failed start is reported after the refresh settles', async () => {
  let started = 0;
  const ok = await handleApi(postJson('/api/refresh', { check: 'now' }), { BUCKET: createMemoryBucket() },
    { fetcher: noNetwork, syncJob: { start: async () => { started++; }, pending: async () => null } });
  expect(ok.status < 500 || ok.status === 502).toBeTruthy();
  expect(started).toBe(1);
  const failed = await handleApi(postJson('/api/refresh', { check: 'now' }), { BUCKET: createMemoryBucket() },
    { fetcher: noNetwork, syncJob: { start: async () => { throw new Error('Workflows unavailable'); }, pending: async () => null } });
  expect(failed.status).toBe(502);
});

test('search results link NYC apartments to open affordable-housing lotteries in the same building', async () => {
  const bucket = createMemoryBucket();
  const now = new Date().toISOString();
  const listing = normalizeListing({ id: '1', url: 'https://www.zumper.com/listings/1p/x', address: '10 Example Street', unit: '2', city: 'Brooklyn', state: 'NY',
    zipCode: '11215', region: 'nyc', bedrooms: 1, rent: 2500, latitude: 40.67, longitude: -73.99, status: 'Active', updatedAt: now },
  { id: 'zumper', name: 'Zumper', kind: 'feed' })!;
  await bucket.put('rentals/zumper-live.json.gz', gzipSync(strToU8(JSON.stringify({ listings: [listing] }))));
  await bucket.put('rentals/refresh.json', JSON.stringify({ sources: [{ id: 'zumper-live', name: 'Zumper', status: 'updated', checkedAt: now, updatedAt: now }] }));
  await bucket.put('rentals/housing-connect.json', JSON.stringify({ publishedAt: null, opportunities: [
    { id: '1', name: 'Example Lottery', closes: '2999-01-01', addresses: [], buildingKeys: [buildingKey(listing)], sizes: [1], borough: 'Brooklyn', url: 'https://housingconnect.nyc.gov/1' },
  ] }), { customMetadata: { updatedAt: now } });
  const result = await readJson<SearchResult>(handleApi(postJson('/api/search', { region: 'brooklyn', liveOnly: true }), { BUCKET: bucket }, { fetcher: noNetwork }));
  expect(result.matches[0].buildingLinks).toStrictEqual([{ name: 'Example Lottery', url: 'https://housingconnect.nyc.gov/1' }]);
  // Unreadable lottery data leaves the search intact rather than failing it.
  await bucket.put('rentals/housing-connect.json', 'not json');
  const without = await readJson<SearchResult>(handleApi(postJson('/api/search', { region: 'brooklyn', liveOnly: true }), { BUCKET: bucket }, { fetcher: noNetwork }));
  expect(without.matches.length).toBe(1);
  expect(without.matches[0].buildingLinks).toBeUndefined();
});

test('a feed configuration error is reported as one, separately from storage failures', async () => {
  const response = await handleApi(get('/api/config'), { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: '{not json' });
  expect(response.status).toBe(503);
  expect((await readJson<ErrorBody>(response)).error).toMatch(/free feed settings/);
});

test('opening the app fetches nothing, even from a page that still asks for a check on open', async () => {
  const bucket = createMemoryBucket();
  let started = 0;
  const response = await handleApi(postJson('/api/refresh', { check: 'now', sessionStart: true }), { BUCKET: bucket },
    { fetcher: noNetwork, syncJob: { start: async () => { started++; }, pending: async () => null } });
  expect(response.status).toBe(200);
  expect((await readJson<RefreshInfo>(response)).state).toBe('already_checked');
  expect(started, 'no sync Workflow starts').toBe(0);
  expect(await bucket.get('rentals/refresh.json'), 'no refresh was recorded').toBeNull();
});
