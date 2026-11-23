import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { crawlOpenigloo, loadOpenigloo, openiglooListing, OPENIGLOO_TRANSPORT } from '../server/openigloo.ts';
import { readJson, type RpcRequest, sentJson } from './fixtures/json.ts';

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const ZIPS: Record<string, string> = { Manhattan: '10025', Brooklyn: '11215', Queens: '11101', Bronx: '10451', 'Staten Island': '10301' };
type Unit = { id: string; borough: string; neighborhood: string; bedrooms: number; filterPrice: number; shownRent: number };

/** Inventory with dense exact prices, high rents and filter prices that differ from displayed rents. */
function inventory() {
  const units: Unit[] = [];
  let n = 0;
  for (const borough of BOROUGHS) for (let bedrooms = 0; bedrooms <= 5; bedrooms++) {
    for (let i = 0; i < 37; i++) {
      const filterPrice = 1500 + ((i * 377) % 6000) + bedrooms * 400;
      units.push({ id: 'u' + n++, borough, neighborhood: borough + ' ' + (i % 4), bedrooms, filterPrice, shownRent: filterPrice + (i % 3) * 150 });
    }
    // Fourteen listings at one exact price, spread over neighborhoods.
    for (let i = 0; i < 14; i++) units.push({ id: 'u' + n++, borough, neighborhood: borough + ' ' + (i % 4), bedrooms, filterPrice: 4995, shownRent: 4995 });
  }
  units.push({ id: 'u' + n++, borough: 'Manhattan', neighborhood: 'Manhattan 0', bedrooms: 2, filterPrice: 62_000, shownRent: 62_000 });
  return units;
}

function fakeOpenigloo(units: Unit[], { rateLimitOnce = false } = {}) {
  let calls = 0;
  let limited = !rateLimitOnce;
  const fetcher = async (_url: string, options: RequestInit = {}) => {
    const message = sentJson<RpcRequest>(options.body);
    if (message.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (!limited) { limited = true; return new Response('slow down', { status: 429 }); }
    calls++;
    const args = message.params.arguments;
    assert.ok(args.limit <= 10);
    if (args.max_rent !== undefined && args.max_rent >= 50_000) {
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { isError: true, content: [{ type: 'text', text: 'Openigloo’s listings did not answer just now. Try again in a minute.' }] } });
    }
    const wanted = (unit: Unit) => (BOROUGHS.includes(args.area) ? unit.borough === args.area : unit.neighborhood === args.area) &&
      args.bedrooms.some((b) => b === 4 ? unit.bedrooms >= 4 : unit.bedrooms === b) &&
      unit.filterPrice >= (args.min_rent ?? 0) && unit.filterPrice <= (args.max_rent ?? Infinity);
    const matches = units.filter(wanted);
    const shown = (matches.length ? matches : units.slice(0, 6)).slice(0, args.limit);
    return Response.json({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { total_matches: matches.length, apartments: shown.map((unit) => ({
      id: unit.id, address: `${unit.id.slice(1)} Example Street #${unit.bedrooms}A, ${unit.borough}, NY ${ZIPS[unit.borough]}`,
      borough: unit.borough === 'Bronx' ? 'The Bronx' : unit.borough, neighborhood: unit.neighborhood, status: 'for_rent', bedrooms: unit.bedrooms, bathrooms: 1,
      rent_per_month: unit.shownRent, url: `https://www.openigloo.com/unit/nyc/${unit.id}/example?utm_source=ai_assistant`,
    })) } } });
  };
  return { fetcher, calls: () => calls };
}

const noWait = async () => {};

test('Openigloo crawl recovers every listing despite the ten-result cap, exact-price ties and fuzzy prices', async () => {
  const { openiglooSearch } = await import('../server/openigloo.ts');
  const units = inventory();
  const fake = fakeOpenigloo(units);
  const crawl = await crawlOpenigloo(await openiglooSearch(fake.fetcher, noWait));
  assert.equal(crawl.total, units.length);
  assert.deepEqual(new Set(crawl.rows.map((row) => row.id)), new Set(units.map((unit) => unit.id)));
  assert.equal(crawl.unresolved, 0);
  assert.equal(crawl.calls, fake.calls());
});

test('Openigloo sync waits out a rate limit and saves normalized complete inventory', async () => {
  const units = inventory();
  const fake = fakeOpenigloo(units, { rateLimitOnce: true });
  const waits: number[] = [];
  const result = await loadOpenigloo(async (url, options) => url.includes('addressbatch') ?
    new Response('') : fake.fetcher(url, options), new Date('2026-11-20T12:00:00Z'), async (ms) => { waits.push(ms); });
  assert.ok(waits.includes(60_000), 'a 429 waits a minute before retrying');
  assert.equal(result.transport, OPENIGLOO_TRANSPORT);
  assert.equal(result.total, units.length);
  assert.equal(result.listings.length, units.length);
  const listing = result.listings.find((item) => item.id === 'openigloo:u0')!;
  assert.equal(listing.address, '0 Example Street');
  assert.equal(listing.unit, '0A');
  assert.equal(listing.city, 'Manhattan');
  assert.equal(listing.sources[0].url, 'https://www.openigloo.com/unit/nyc/u0/example');
  assert.ok(result.listings.every((item) => item.bedrooms <= 4));
  assert.ok(result.listings.some((item) => item.city === 'The Bronx'), 'Openigloo labels the borough "The Bronx"');
});

test('the stepped Workflow sync saves complete inventory only from one run\'s parts', async () => {
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const { crawlOpeniglooCell, finishOpeniglooRun, OPENIGLOO_CELL_COUNT } = await import('../server/openigloo-sync.ts');
  const { storedOpenigloo, refreshStatus } = await import('../server/refresh.ts');
  const units = inventory();
  const fake = fakeOpenigloo(units);
  const fetcher = async (url: string, options?: RequestInit) => url.includes('addressbatch') ? new Response('') : fake.fetcher(url, options);
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  for (let index = 0; index < OPENIGLOO_CELL_COUNT; index++) await crawlOpeniglooCell(bucket, 'run-1', index, fetcher, noWait);
  await crawlOpeniglooCell(bucket, 'run-2', 3, fetcher, noWait);
  await assert.rejects(finishOpeniglooRun(env, 'run-2', fetcher), /step from this sync is missing; the saved inventory was kept/);
  assert.equal(await storedOpenigloo(bucket), null);
  await crawlOpeniglooCell(bucket, 'run-1', 3, fetcher, noWait);
  const saved = await finishOpeniglooRun(env, 'run-1', fetcher, new Date('2026-11-20T12:00:00Z'));
  assert.equal(saved.listingCount, units.length);
  assert.equal((await storedOpenigloo(bucket))?.listings.length, units.length);
  const status = (await refreshStatus(bucket)).sources.find(({ id }) => id === 'openigloo');
  assert.equal(status?.status, 'updated');
  assert.equal(status?.listingCount, units.length);
  assert.equal(status?.total, units.length);
  assert.equal(status?.transport, OPENIGLOO_TRANSPORT);
});

test('Openigloo sync keeps saved data when too much inventory is missing', async () => {
  const units = inventory();
  const fake = fakeOpenigloo(units);
  const missing = new Set(units.slice(0, 200).map((unit) => unit.id));
  await assert.rejects(loadOpenigloo(async (url, options) => {
    if (url.includes('addressbatch')) return new Response('');
    const response = await fake.fetcher(url, options);
    if (!response.headers.get('Content-Type')?.includes('json')) return response;
    const body = await readJson<{ result?: { structuredContent?: { apartments?: { id: string }[] } } }>(response);
    const apartments = body.result?.structuredContent?.apartments;
    if (apartments && body.result?.structuredContent) body.result.structuredContent.apartments = apartments.filter((row) => !missing.has(row.id));
    return Response.json(body);
  }, new Date(), noWait), /usable listings of .* reported; the saved inventory was kept/);
});

test('Openigloo listings reject rows outside the searched borough or bedroom count', () => {
  const search = { borough: 'Brooklyn', area: 'Brooklyn', bedrooms: 1, min: 0, max: null };
  const row = { id: 'x', address: '1 Main St #2, Brooklyn, NY 11215', borough: 'Brooklyn', status: 'for_rent', bedrooms: 1,
    rent_per_month: 3000, url: 'https://www.openigloo.com/unit/nyc/x/main' };
  assert.ok(openiglooListing({ ...row, search }, '2026-11-20T00:00:00Z'));
  assert.equal(openiglooListing({ ...row, borough: 'Queens', search }, '2026-11-20T00:00:00Z'), null);
  assert.equal(openiglooListing({ ...row, bedrooms: 2, search }, '2026-11-20T00:00:00Z'), null);
  assert.equal(openiglooListing({ ...row, url: 'https://unrelated.test/x', search }, '2026-11-20T00:00:00Z'), null);
});

test('Openigloo search reads event-stream replies, waits out "try again" errors, and reports other tool errors', async () => {
  const { openiglooSearch } = await import('../server/openigloo.ts');
  const replies: ((id: number) => Response)[] = [
    (id) => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: { isError: true, content: [{ text: 'Openigloo’s listings did not answer just now. Try again in a minute.' }] } })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } }),
    (id) => new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent: { total_matches: 0, apartments: [] } } })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } }),
    (id) => Response.json({ jsonrpc: '2.0', id, result: { isError: true, content: [{ text: 'max_rent must be between 0 and 100,000' }] } }),
  ];
  const fetcher = async (_url: string, options?: RequestInit) => {
    const message = sentJson<RpcRequest>(options?.body);
    if (message.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return replies.shift()!(message.id);
  };
  const waits: number[] = [];
  const search = await openiglooSearch(fetcher, async (ms) => { waits.push(ms); });
  const cell = { borough: 'Queens', area: 'Queens', bedrooms: 1, min: 0, max: null };
  assert.deepEqual(await search(cell), { total: 0, rows: [] });
  assert.ok(waits.includes(15_000), 'a "try again" reply waits before retrying');
  await assert.rejects(search(cell), /did not return listing results: max_rent must be between/);
});
