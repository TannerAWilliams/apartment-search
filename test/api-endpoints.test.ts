import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { gzipSync, strToU8 } from 'fflate';
import { handleApi } from '../server/api.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { buildingKey, normalizeListing } from '../src/listings.ts';
import type { Bucket } from '../server/contracts.ts';

const url = (path: string) => 'https://app.test' + path;
const get = (path: string) => new Request(url(path));
const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url(path), { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
const failingBucket: Bucket = { get: async () => { throw new Error('storage down'); }, head: async () => { throw new Error('storage down'); }, put: async () => null };
const noNetwork = async () => { throw new Error('No external requests in this test.'); };

test('affordable housing: GET only, saved lotteries and re-rentals, and an honest storage failure', async () => {
  const bucket = createMemoryBucket();
  assert.equal((await handleApi(postJson('/api/housing', {}), { BUCKET: bucket })).status, 405);
  await bucket.put('rentals/housing-connect.json', JSON.stringify({ publishedAt: null, opportunities: [{ id: '1', name: 'Lottery', closes: '2999-01-01', addresses: [], buildingKeys: [], sizes: [], borough: 'Bronx', url: 'https://housingconnect.nyc.gov/1' }] }), { customMetadata: { updatedAt: '2026-11-20T00:00:00Z' } });
  const saved = await (await handleApi(get('/api/housing'), { BUCKET: bucket })).json();
  assert.equal(saved.opportunities.length, 1);
  assert.equal(saved.rerentals, null);
  const failed = await handleApi(get('/api/housing'), { BUCKET: failingBucket });
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /Housing Connect data could not be read/);
});

test('rent charts reject unknown regions and groupings, and report unreadable data', async () => {
  assert.equal((await handleApi(get('/api/market?region=mars'), { BUCKET: createMemoryBucket() })).status, 422);
  assert.equal((await handleApi(get('/api/market?region=nyc&grouping=planet'), { BUCKET: createMemoryBucket() })).status, 422);
  const failed = await handleApi(get('/api/market?region=nyc'), { BUCKET: failingBucket });
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /rent data could not be read/);
});

test('malformed requests are refused before any work', async () => {
  const bucket = createMemoryBucket();
  assert.equal((await handleApi(postJson('/api/refresh', { check: 'now' }), {})).status, 400, 'refresh needs storage');
  assert.equal((await handleApi(new Request(url('/api/refresh'), { method: 'POST', body: '{}' }), { BUCKET: bucket })).status, 400, 'refresh needs JSON');
  const declared = new Request(url('/api/search'), { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', 'Content-Length': '99999999' } });
  assert.equal((await handleApi(declared, { BUCKET: bucket })).status, 413);
  assert.equal((await handleApi(postJson('/api/search', 'not json'), { BUCKET: bucket })).status, 400);
  const commute = new Request(url('/api/search'), { method: 'POST', body: JSON.stringify({ includeCommute: true }), headers: { 'Content-Type': 'text/plain' } });
  assert.equal((await handleApi(commute, { BUCKET: bucket })).status, 400);
});

test('a full refresh also starts the sync Workflow, and a failed start is reported after the refresh settles', async () => {
  let started = 0;
  const ok = await handleApi(postJson('/api/refresh', { check: 'now' }), { BUCKET: createMemoryBucket() },
    { fetcher: noNetwork, cityRealtyJob: { start: async () => { started++; }, pending: async () => null } });
  assert.ok(ok.status < 500 || ok.status === 502);
  assert.equal(started, 1);
  const failed = await handleApi(postJson('/api/refresh', { check: 'now' }), { BUCKET: createMemoryBucket() },
    { fetcher: noNetwork, cityRealtyJob: { start: async () => { throw new Error('Workflows unavailable'); }, pending: async () => null } });
  assert.equal(failed.status, 502);
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
  const result = await (await handleApi(postJson('/api/search', { region: 'brooklyn', liveOnly: true }), { BUCKET: bucket }, { fetcher: noNetwork })).json();
  assert.deepEqual(result.matches[0].buildingLinks, [{ name: 'Example Lottery', url: 'https://housingconnect.nyc.gov/1' }]);
  // Unreadable lottery data leaves the search intact rather than failing it.
  await bucket.put('rentals/housing-connect.json', 'not json');
  const without = await (await handleApi(postJson('/api/search', { region: 'brooklyn', liveOnly: true }), { BUCKET: bucket }, { fetcher: noNetwork })).json();
  assert.equal(without.matches.length, 1);
  assert.equal(without.matches[0].buildingLinks, undefined);
});

test('a feed configuration error is reported as one, separately from storage failures', async () => {
  const response = await handleApi(get('/api/config'), { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: '{not json' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /free feed settings/);
});
