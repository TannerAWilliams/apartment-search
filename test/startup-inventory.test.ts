import { test, expect } from 'bun:test';
import { initializeInventory } from '../server/startup-inventory.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { refreshStatus } from '../server/refresh.ts';
import { openiglooPacing } from '../server/openigloo.ts';

// Real syncs space Openigloo requests a second apart; these tests use a local fake.
openiglooPacing.intervalMs = 0;

test('startup respects disable and absence of storage without calling a provider', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error('unexpected'); };
  expect((await initializeInventory({}, { fetcher })).state).toBe('disabled');
  expect((await initializeInventory({ BUCKET:createMemoryBucket(), STARTUP_OPENIGLOO:'false' }, { fetcher })).state).toBe('disabled');
  expect(calls).toBe(0);
});
test('empty startup only attempts Openigloo and records failure honestly without fallback or retry loop', async () => {
  const bucket = createMemoryBucket(); const urls: string[] = [];
  await initializeInventory({ BUCKET:bucket }, { fetcher: async (url, options) => {
    urls.push(url); expect(options?.signal).toBeDefined(); throw new Error('Synthetic unavailable source');
  }});
  expect(urls).toEqual(['https://mcp.openigloo.com/mcp']);
  const status = await refreshStatus(bucket);
  expect(status.sources.find(source => source.id === 'openigloo')?.status).toBe('failed');
  expect(status.sources.some(source => source.updatedAt)).toBe(false);
});
test('saved inventory is preserved without resetting freshness or running a source check', async () => {
  let calls = 0;
  const bucket = createMemoryBucket();
  const status: typeof refreshStatus = async () => ({ checking:false, lastCheckedAt:'2026-11-16T00:00:00Z', sources:[{ id:'openigloo',name:'Openigloo',status:'updated',checkedAt:'2026-11-16T00:00:00Z',listingCount:40,updatedAt:'2026-11-16T00:00:00Z' }] });
  expect((await initializeInventory({ BUCKET:bucket }, { status, fetcher:async () => { calls++; throw new Error('unexpected'); } })).state).toBe('saved_inventory');
  expect(calls).toBe(0);
});
test('successful empty startup seeds genuine adapter observations once and preserves their checked time', async () => {
  const bucket = createMemoryBucket(); let calls = 0;
  await initializeInventory({ BUCKET:bucket }, { fetcher: async (url, options) => {
    calls++;
    if (url === 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch') return new Response('', {status:503});
    expect(url).toBe('https://mcp.openigloo.com/mcp');
    const payload = JSON.parse(String(options?.body));
    if (payload.method === 'initialize') return Response.json({id:payload.id,result:{protocolVersion:'2025-11-25'}});
    if (payload.method === 'notifications/initialized') return new Response(null,{status:204});
    const args = payload.params.arguments;
    const match = args.area === 'Manhattan' && args.bedrooms[0] === 1;
    return Response.json({id:payload.id,result:{structuredContent:{total_matches:match ? 1 : 0,apartments: match ? [{id:'test-only',address:'12 Test Street, Manhattan, NY 10001',borough:'Manhattan',status:'for_rent',bedrooms:1,rent_per_month:2000,url:'https://www.openigloo.com/unit/nyc/test-only'}] : []}}});
  }});
  const before = await refreshStatus(bucket);
  expect(before.sources.find(source => source.id === 'openigloo')?.listingCount).toBe(1);
  const count = calls;
  expect((await initializeInventory({BUCKET:bucket},{fetcher:async () => { calls++; throw new Error('unexpected'); }})).state).toBe('saved_inventory');
  expect(calls).toBe(count);
  expect(await refreshStatus(bucket)).toEqual(before);
});
