import { test, expect } from 'bun:test';
import { wholeSearchCheck } from '../server/whole-search-check.ts';
import { handleApi } from '../server/api.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { normalizeListing } from '../src/listings.ts';
import { recordListingHistory } from '../server/listing-history.ts';
import { gzipSync, strToU8 } from 'fflate';
const never = () => { throw new Error('Unexpected external call'); };
const at = new Date().toISOString();
const raw = { region: 'all', bedrooms: null, maxRent: null, liveOnly: true, includeCommute: true, offset: 100 };
async function fixture(count = 101) {
  const BUCKET = createMemoryBucket();
  const source = { id: 'partner', name: 'Partner', kind: 'feed' };
  const listings = Array.from({ length: count }, (_, i) => normalizeListing({ id: String(i), address: '12 Grove Street', unit: String(i), city: 'Jersey City', state: 'NJ', zip: '07302', rent: 2000, bedrooms: 1, status: 'Active', url: `https://example.com/${i}` }, source));
  await BUCKET.put('rentals/refresh.json', JSON.stringify({ running: false, sources: [{ id: 'partner', status: 'updated', updatedAt: at, checkedAt: at }] }));
  await BUCKET.put('rentals/feeds/partner.json.gz', gzipSync(strToU8(JSON.stringify(recordListingHistory(listings, undefined, 'partner', at)))));
  return { BUCKET, FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'partner', name: 'Partner', url: 'https://example.com/feed' }]), TRAVELTIME_APP_ID: 'configured', TRAVELTIME_API_KEY: 'not-used' };
}
const request = (body: unknown) => new Request('https://app.test/api/search-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('API checks all101 matches beyond page100 using only cached inventory, never routing or providers', async () => {
  const env = await fixture();
  const response = await handleApi(request(raw), env, { fetcher: never });
  expect(response.status).toBe(200);
  const result = await response.json(); expect(result.total).toBe(101); expect(result.eligible).toBe(101); expect(result.observations.length).toBe(101); expect(result.scope).toBe('all-cached-search-matches');
  const custom = await handleApi(request({ ...raw, workplace: 'custom', customWorkplace: '40.75, -73.98' }), env, { fetcher: never }); expect(custom.status).toBe(200);
  const limited = await handleApi(request({ ...raw, maxRent: 1000 }), env, { fetcher: never }); expect((await limited.json()).total).toBe(0);
  const source = await handleApi(request({ ...raw, source: 'different' }), env, { fetcher: never }); expect((await source.json()).total).toBe(0);
  expect((await handleApi(new Request('https://app.test/api/search-check'), env, { fetcher: never })).status).toBe(405);
});
test('missing bucket, commute requirements, unresolved custom address and overbound search reject without fetch', async () => {
  expect((await handleApi(request(raw), { FREE_PARTNER_FEEDS_JSON: JSON.stringify([{id:'partner', url:'https://example.com/feed'}]) }, { fetcher: never })).status).toBe(422);
  const env = await fixture();
  for (const extra of [{ maxTransitMinutes: 30 }, { sort: 'driving' }, { workplace: 'custom', customWorkplace: '123 Main Street, New York' }]) expect((await handleApi(request({ ...raw, ...extra }), env, { fetcher: never })).status).toBe(422);
  await expect(wholeSearchCheck(raw, env, async () => ({ matches: Array(2001).fill({}) }))).rejects.toThrow('Narrow');
});
test('running refresh and source snapshot changes fail closed without a partial baseline', async () => {
  const env = await fixture();
  await env.BUCKET.put('rentals/refresh.json', JSON.stringify({ running: true }));
  await expect(wholeSearchCheck(raw, env, never)).rejects.toThrow('running');
  await env.BUCKET.put('rentals/refresh.json', JSON.stringify({ running: false }));
  await expect(wholeSearchCheck(raw, env, async () => { await env.BUCKET.put('rentals/refresh.json', '{}'); return { matches: [] }; })).rejects.toThrow('changed');
  const empty = await wholeSearchCheck(raw, { BUCKET: createMemoryBucket() }, async filters => { expect(filters.includeCommute).toBe(false); expect(filters.offset).toBe(0); return { matches: [] }; });
  expect(empty.total).toBe(0); expect(empty.notices).toEqual([]);
});
test('unreadable source data rejects instead of treating it as a successful empty search', async () => {
  const env = await fixture(); await env.BUCKET.put('rentals/feeds/partner.json.gz', 'corrupt');
  expect((await handleApi(request(raw), env, { fetcher: never })).status).toBe(502);
});
