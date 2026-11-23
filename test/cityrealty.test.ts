import { expect, test } from 'bun:test';
import { handleApi } from './fixtures/api.ts';
import { CITYREALTY_ID } from '../server/sources/cityrealty.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { refreshSources } from '../server/refresh.ts';
import { storedDirectRentals } from '../server/refresh/snapshots.ts';
import { readJson } from './fixtures/json.ts';
import type { RefreshInfo } from '../src/api-client.ts';

function mockCityRealty({ duplicate = false, rentedId = 0 }: { duplicate?: boolean; rentedId?: number } = {}): FetchTransport {
  return (input) => {
    const url = new URL(input);
    expect(url.origin).toBe('https://www.cityrealty.com');
    if (url.pathname === '/rpc/search/get-rental-listings') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const ids = page === 1 ? Array.from({ length: 52 }, (_, index) => index + 1) : [duplicate ? 1 : 53];
      const items = ids.map((id) => ({
        active: true,
        rented: id === rentedId,
        out_of_market: false,
        isPublic: true,
        sale_or_rent: 2,
        listing_id: id,
        mask_id: 'mask' + id,
        building_address: '10 Example Street',
        unit: String(id),
        url_listing: '/nyc/example/10-example/1/' + id + '/mask' + id,
        lat: 40.75,
        lng: -73.99,
        hood: id === 53 ? 'Jersey City' : 'Chelsea',
      }));
      return Response.json({ items, tableTools: { pagination: { total: 53, rowsPerPage: 52, currentPage: page } } });
    }
    const mask = url.pathname.split('/').at(-1);
    const listing = {
      utype: 'anonymous',
      ptype: 'listing',
      lid: mask,
      ltype: 'rent',
      lstatus: 'active',
      laddress: 'Example Building, 10  example street',
      lbeds: 1,
      lprice: 2500,
      lbaths: 1,
      lzip: mask === 'mask53' ? 7310 : 10001,
      lzone: mask === 'mask53' ? 'new jersey' : 'manhattan',
    };
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
  const refreshed = await refreshSources(env, {
    ...options,
    fetcher: (url, options) => {
      if (url.endsWith('/mask53') && !retried) {
        retried = true;
        throw new DOMException('Example network timeout', 'TimeoutError');
      }
      return provider(url, options);
    },
  });
  expect(refreshed.state).toBe('complete');
  expect(retried).toBe(true);
  expect(refreshed.sources.find((source) => source.id === CITYREALTY_ID)).toMatchObject({ pages: 2, total: 53, listingCount: 53 });
  const snapshot = await storedDirectRentals(bucket, catalog);
  expect(snapshot?.listings[52]).toMatchObject({ id: 'cityrealty:53', zip: '07310', state: 'NJ' });
  const incomplete = await refreshSources(env, { ...options, fetcher: mockCityRealty({ duplicate: true }) });
  expect(incomplete.sources.find((source) => source.id === CITYREALTY_ID)).toMatchObject({ status: 'failed', listingCount: 53 });
  expect(await storedDirectRentals(bucket, catalog)).toEqual(snapshot);
});

test('Cloudflare queues manual CityRealty refresh and reports a pending job while it starts', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const url = 'https://app.test/api/refresh';
  const job = {
    start: async () => {
      started++;
    },
    pending: async () => started > 0,
  };
  let started = 0;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: CITYREALTY_ID, check: 'now' }),
  });
  const result = await handleApi(request, env, {
    syncJob: job,
    fetcher: () => {
      throw Error('Cannot fetch a full inventory inside an API request.');
    },
  });
  expect(result.status).toBe(202);
  expect(started).toBe(1);
  expect(await (await handleApi(new Request(url), env, { syncJob: job })).json()).toMatchObject({
    checking: true,
    activeSource: CITYREALTY_ID,
  });
});

test('a running sync job reports the source it is on, not always CityRealty', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const status = async (job: { start: () => Promise<void>; pending: () => Promise<string | boolean | null> }) =>
    readJson<RefreshInfo>(handleApi(new Request('https://app.test/api/refresh'), env, { syncJob: job }));
  expect(await status({ start: async () => {}, pending: async () => 'openigloo' })).toMatchObject({
    checking: true,
    activeSource: 'openigloo',
  });
  expect((await status({ start: async () => {}, pending: async () => null })).checking).toBeFalsy();
});

test('CityRealty search pages and listings that cannot be verified stop the sync', async () => {
  const { CITYREALTY_LIVE } = await import('../server/sources/cityrealty.ts');
  const load = (fetcher: FetchTransport) => CITYREALTY_LIVE.load(fetcher, new Date('2026-11-20T00:00:00Z'));
  const good = mockCityRealty();
  await expect(load(async () => new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow(
    /recognizable rental search results/,
  );
  await expect(
    load(async () => Response.json({ items: [], tableTools: { pagination: { total: 5, rowsPerPage: 52, currentPage: 1 } } })),
  ).rejects.toThrow(/unexpected page or result count/);
  // A search row marked active whose link does not match its own listing ID.
  await expect(
    load(async (input, init) => {
      const response = await good(input, init);
      if (!String(input).includes('get-rental-listings')) return response;
      const body = await readJson<{ items: { mask_id: string }[] }>(response);
      body.items[0].mask_id = 'another-mask';
      return Response.json(body);
    }),
  ).rejects.toThrow(/without verifiable listing details/);
  // A listing page that describes a different apartment than the search row.
  await expect(
    load(async (input, init) =>
      String(input).includes('get-rental-listings')
        ? good(input, init)
        : new Response('<script>window.dataLayer.push({"utype":"anonymous","ptype":"listing","lid":"elsewhere"});</script>', {
            headers: { 'content-type': 'text/html' },
          }),
    ),
  ).rejects.toThrow(/could not verify active listing/);
});

test('CityRealty counts a rented listing toward its total but does not list it', async () => {
  const { CITYREALTY_LIVE } = await import('../server/sources/cityrealty.ts');
  const result = await CITYREALTY_LIVE.load(mockCityRealty({ rentedId: 52 }), new Date());
  expect(result.total).toBe(53);
  expect(result.listings.some(({ unit }) => unit === '52')).toBe(false);
});
