import { expect, test } from 'bun:test';
import { handleApi } from '../server/api.ts';
import { CITYREALTY_ID } from '../server/cityrealty.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { refreshSources, storedDirectRentals, WORKFLOW_SOURCE_IDS } from '../server/refresh.ts';
import { createRefreshWorkflow } from '../server/refresh-workflow.ts';
import { isPublicRefresh } from '../server/public-access.ts';

function mockCityRealty({ duplicate = false }: { duplicate?: boolean } = {}): FetchTransport {
  return (input) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://www.cityrealty.com');
    if (url.pathname === '/rpc/search/get-rental-listings') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const ids = page === 1 ? Array.from({ length: 52 }, (_, index) => index + 1) : [duplicate ? 1 : 53];
      const items = ids.map(id => ({
        active: true, rented: false, out_of_market: false, isPublic: true, sale_or_rent: 2, listing_id: id,
        mask_id: 'mask' + id, building_address: '10 Example Street', unit: String(id),
        url_listing: '/nyc/example/10-example/1/' + id + '/mask' + id,
        lat: 40.75, lng: -73.99, hood: id === 53 ? 'Jersey City' : 'Chelsea',
      }));
      return Response.json({ items, tableTools: { pagination: { total: 53, rowsPerPage: 52, currentPage: page } } });
    }
    const mask = url.pathname.split('/').at(-1);
    const listing = { utype: 'anonymous', ptype: 'listing', lid: mask, ltype: 'rent', lstatus: 'active',
      laddress: 'Example Building, 10  example street', lbeds: 1, lprice: 2500, lbaths: 1,
      lzip: mask === 'mask53' ? 7310 : 10001, lzone: mask === 'mask53' ? 'new jersey' : 'manhattan' };
    return new Response('<script>window.dataLayer.push(' + JSON.stringify(listing) + ');</script>', {
      headers: { 'content-type': 'text/html' },
    });
  };
}

test('CityRealty publishes every verified page and retains it if a subsequent run repeats a listing ID', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  const options = { sourceId: CITYREALTY_ID, onDemand: true };
  const catalog = { id: CITYREALTY_ID };
  const provider = mockCityRealty();
  let retried = false;
  const refreshed = await refreshSources(env, { ...options, fetcher: (url, options) => {
    if (url.endsWith('/mask53') && !retried) {
      retried = true;
      throw new DOMException('Example network timeout', 'TimeoutError');
    }
    return provider(url, options);
  } });
  expect(refreshed.state).toBe('complete');
  expect(retried).toBe(true);
  expect(refreshed.sources.find(source => source.id === CITYREALTY_ID)).toMatchObject({ pages: 2, total: 53, listingCount: 53 });
  const snapshot = await storedDirectRentals(bucket, catalog);
  expect(snapshot?.listings[52]).toMatchObject({ id: 'cityrealty:53', zip: '07310', state: 'NJ' });
  const incomplete = await refreshSources(env, { ...options, fetcher: mockCityRealty({ duplicate: true }) });
  expect(incomplete.sources.find(source => source.id === CITYREALTY_ID)).toMatchObject({ status: 'failed', listingCount: 53 });
  expect(await storedDirectRentals(bucket, catalog)).toEqual(snapshot);
});

test('Cloudflare queues manual CityRealty refresh and reports a pending job while it starts', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const url = 'https://app.test/api/refresh';
  let started = 0;
  let workflowId = '';
  let status = 'queued';
  const context = () => ({
    refreshWorkflow: createRefreshWorkflow(env.BUCKET, {
      async create({ id, params }) {
        started++;
        workflowId = id;
        expect(params.sources).toEqual([CITYREALTY_ID]);
      },
      async get(id) {
        expect(id).toBe(workflowId);
        return { status: async () => ({ status }) };
      },
    }, WORKFLOW_SOURCE_IDS),
    fetcher: () => { throw Error('Cannot fetch a full inventory inside an API request.'); },
  });
  const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: CITYREALTY_ID, check: 'now' }) });
  const result = await handleApi(request, env, context());
  expect(result.status).toBe(202);
  const expected = { checking: true, activeSource: CITYREALTY_ID, workflow: {
    id: workflowId, status: 'queued', sources: [CITYREALTY_ID],
  } };
  expect(await result.json()).toMatchObject(expected);
  expect(started).toBe(1);
  expect(await (await handleApi(new Request(url), env, context())).json()).toMatchObject(expected);
  const config = await handleApi(new Request('https://app.test/api/config'), env, context());
  expect(await config.json()).toMatchObject({ refresh: expected });
  status = 'errored';
  expect(await (await handleApi(new Request(url), env, context())).json())
    .toMatchObject({ lastCheckedAt: null, sources: [], workflow: { id: workflowId, status: 'errored' } });
  expect(started).toBe(1);
});

test('only an explicit matching-ID resume can recover an unconfirmed Openigloo start', async () => {
  const env = { BUCKET: createMemoryBucket() };
  let now = Date.now();
  let accepted = false;
  const attempted: string[] = [];
  const context = {
    refreshWorkflow: createRefreshWorkflow(env.BUCKET, {
      async create({ id, params }) {
        attempted.push(id);
        expect(params.sources).toEqual(['openigloo']);
        if (!accepted) throw Error('Create not acknowledged.');
      },
      async get() { return { status: async () => ({ status: accepted ? 'queued' : 'unknown' }) }; },
    }, WORKFLOW_SOURCE_IDS, () => now),
    fetcher: () => { throw Error('Do not fetch provider inventory for status/recovery.'); },
  };
  const url = 'https://app.test/api/refresh';
  const post = (body: unknown) => handleApi(new Request(url, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, context);
  const first = await post({ check: 'now', source: 'openigloo' });
  expect(first.status).toBe(202);
  const { workflow } = await first.json();
  expect(workflow).toMatchObject({ id: attempted[0], status: 'unknown', sources: ['openigloo'] });
  now += 31_000;
  const status = await handleApi(new Request(url), env, context);
  expect(await status.json()).toMatchObject({ checking: true, activeSource: 'openigloo',
    workflow: { id: workflow.id, status: 'unknown', canRetryStart: true } });
  expect(attempted).toHaveLength(1);
  expect((await post({ check: 'resume', workflowId: 'rental-refresh-' + crypto.randomUUID() })).status).toBe(409);
  expect((await post({ check: 'resume', workflowId: 'wrong-type' })).status).toBe(422);
  expect(attempted).toHaveLength(1);
  const recovery = { check: 'resume', workflowId: workflow.id };
  expect(isPublicRefresh(recovery)).toBe(true);
  expect(isPublicRefresh({ ...recovery, imports: {} })).toBe(false);
  accepted = true;
  // A retry also accepts a now-observable exact ID instead of calling create twice.
  expect(await (await post(recovery)).json()).toMatchObject({ workflow: { id: workflow.id, status: 'queued' } });
  expect(attempted).toEqual([workflow.id]);
});
