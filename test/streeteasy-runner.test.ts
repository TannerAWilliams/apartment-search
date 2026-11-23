import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { syncStreetEasy } from '../scripts/sync-streeteasy.ts';
import { type GraphQlRequest, sentJson } from './fixtures/json.ts';
for (const state of ['missing', 'stale', 'current']) test('external runner handles ' + state + ' inventory with injected offline transport', async () => {
  let imported = false;
  const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
  const fetcher = async (url: string, options?: RequestInit) => {
    if (String(url) === 'https://api-v6.streeteasy.com/') {
      assert.notEqual(state, 'current', 'Current data must not be fetched');
      return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
    }
    assert.ok(String(url).startsWith('https://synthetic.example.invalid/api/'), 'Unknown endpoint must not escape fixture');
    if (String(url).endsWith('/api/refresh')) { imported = true; return Response.json({ state: 'complete' }); }
    const now = new Date().toISOString();
    const sources = imported ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt: now }] :
      state === 'missing' ? [] : [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt: state === 'current' ? now : old }];
    return Response.json({ refresh: { sources } });
  };
  const result = await syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher: fetcher as typeof fetch });
  assert.equal(result.state, state === 'current' ? 'already_current' : 'updated');
});
test('offline test guard denies unmocked external requests before transport', () => {
  assert.throws(() => fetch('https://must-not-be-contacted.example.invalid'), /Offline test guard/);
});

test('external runner rejects missing, invalid and stale verification timestamps', async () => {
  for (const updatedAt of [undefined, 'not-a-date', '2000-01-01T00:00:00.000Z']) {
    let imported = false;
    const fetcher = async (url: string) => {
      if (url === 'https://api-v6.streeteasy.com/') return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
      assert.ok(url.startsWith('https://synthetic.example.invalid/api/'));
      if (url.endsWith('/api/refresh')) { imported = true; return Response.json({ state: 'complete' }); }
      return Response.json({ refresh: { sources: imported ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt }] : [] } });
    };
    await assert.rejects(syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher }), /not verified/);
    assert.equal(imported, true);
  }
});

test('external runner authenticates to the Worker with a bearer token', async () => {
  const seen: (string | null)[] = [];
  const fetcher = async (url: string, options?: RequestInit) => {
    if (url === 'https://api-v6.streeteasy.com/') return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
    seen.push(new Headers(options?.headers).get('Authorization'));
    return Response.json({ refresh: { sources: [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', listingCount: 0, updatedAt: new Date().toISOString() }] } });
  };
  await syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher });
  assert.deepEqual(seen, ['Bearer synthetic-test-token']);
});

test('import body is refused before upload when it exceeds the Worker limit', async () => {
  const { importBody, MAX_IMPORT_BYTES } = await import('../scripts/sync-streeteasy.ts');
  const listings = Array.from({ length: 500 }, (_, index) => ({ id: 'streeteasy:' + index, address: crypto.randomUUID() }));
  const { bytes } = importBody({ listings, total: listings.length });
  assert.ok(bytes < MAX_IMPORT_BYTES);
  assert.throws(() => importBody({ listings, total: listings.length }, false, bytes - 1), /upload limit/);
  assert.doesNotThrow(() => importBody({ listings, total: listings.length }, false, bytes));
});

test('runner origin must be an HTTPS Worker URL', async () => {
  const { appOrigin } = await import('../scripts/sync-streeteasy.ts');
  assert.throws(() => appOrigin(undefined), /APARTMENT_SEARCH_ORIGIN/);
  assert.throws(() => appOrigin('http://apartment-search.example.workers.dev'), /HTTPS/);
  assert.equal(appOrigin('https://apartment-search.example.workers.dev/'), 'https://apartment-search.example.workers.dev');
});

test('the command line reads the token from stdin, honors --origin and --manual, and prints a summary', async () => {
  const { main } = await import('../scripts/sync-streeteasy.ts');
  const { Readable } = await import('node:stream');
  const calls: { token: string; origin: string; manual?: boolean }[] = [];
  const printed: string[] = [];
  await main({ argv: ['bun', 'sync', '--origin=https://worker.example.test/', '--manual'], env: {}, input: Readable.from(['secret-token\n']),
    sync: (async (options: { token: string; origin: string; manual?: boolean }) => { calls.push(options); return { state: 'updated' }; }) as never, log: (line) => printed.push(line) });
  assert.deepEqual(calls, [{ token: 'secret-token', origin: 'https://worker.example.test', manual: true }]);
  assert.equal(sentJson<{ state: string }>(printed[0]).state, 'updated');
  await assert.rejects(main({ argv: ['bun', 'sync'], env: { APARTMENT_SEARCH_ORIGIN: 'https://worker.example.test' }, input: Readable.from([]), sync: (async () => ({})) as never, log: () => {} }),
    /token on stdin/);
});

test('a sync retries once when StreetEasy inventory moves mid-download', async () => {
  let rootRequests = 0;
  const rows = Array.from({ length: 600 }, (_, id) => ({ id: String(id), price: 2000 + id, street: '1 Test Street', unit: String(id), zipCode: '10001', status: 'ACTIVE',
    bedroomCount: 1, urlPath: '/rental/' + (1000000 + id), areaName: 'Chelsea', buildingType: 'RENTAL', geoPoint: { latitude: 40.75, longitude: -73.99 } }));
  let imported = false;
  const fetcher = async (url: string, options?: RequestInit) => {
    if (url === 'https://api-v6.streeteasy.com/') {
      const page = Number(sentJson<GraphQlRequest>(options?.body).query.match(/page: (\d+)/)?.[1]);
      if (page === 1) rootRequests++;
      // During the first attempt, the second page reports one more rental than the first.
      const totalCount = page === 2 && rootRequests === 1 ? rows.length + 1 : rows.length;
      return Response.json({ data: { searchRentals: { totalCount, edges: rows.slice((page - 1) * 500, page * 500).map((node) => ({ node })) } } });
    }
    if (url.endsWith('/api/refresh')) { imported = true; return Response.json({ state: 'complete' }); }
    return Response.json({ refresh: { sources: imported ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 600, listingCount: 600, updatedAt: new Date(Date.now() + 1000).toISOString() }] : [] } });
  };
  const result = await syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher });
  assert.equal(result.state, 'updated');
  assert.equal(rootRequests, 2);
});
