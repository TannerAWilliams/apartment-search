import { expect, test } from 'bun:test';
import { syncStreetEasy } from '../scripts/sync-streeteasy.ts';
import { type GraphQlRequest, sentJson } from './fixtures/json.ts';
for (const state of ['missing', 'stale', 'current'])
  test('external runner handles ' + state + ' inventory with injected offline transport', async () => {
    let imported = false;
    const old = new Date(Date.now() - 25 * 60 * 60_000).toISOString();
    const fetcher = async (url: string) => {
      if (String(url) === 'https://api-v6.streeteasy.com/') {
        expect(state, 'Current data must not be fetched').not.toBe('current');
        return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
      }
      expect(String(url).startsWith('https://synthetic.example.invalid/api/'), 'Unknown endpoint must not escape fixture').toBeTruthy();
      if (String(url).endsWith('/api/refresh')) {
        imported = true;
        return Response.json({ state: 'complete' });
      }
      const now = new Date().toISOString();
      const sources = imported
        ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt: now }]
        : state === 'missing'
          ? []
          : [
              {
                id: 'streeteasy-live',
                status: 'updated',
                transport: 'v6-daily',
                total: 0,
                listingCount: 0,
                updatedAt: state === 'current' ? now : old,
              },
            ];
      return Response.json({ refresh: { sources } });
    };
    const result = await syncStreetEasy({
      token: 'synthetic-test-token',
      origin: 'https://synthetic.example.invalid',
      fetcher: fetcher as typeof fetch,
    });
    expect(result.state).toBe(state === 'current' ? 'already_current' : 'updated');
  });
test('offline test guard denies unmocked external requests before transport', () => {
  expect(() => fetch('https://must-not-be-contacted.example.invalid')).toThrow(/Offline test guard/);
});

test('external runner rejects missing, invalid and stale verification timestamps', async () => {
  for (const updatedAt of [undefined, 'not-a-date', '2000-01-01T00:00:00.000Z']) {
    let imported = false;
    const fetcher = async (url: string) => {
      if (url === 'https://api-v6.streeteasy.com/') return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
      expect(url.startsWith('https://synthetic.example.invalid/api/')).toBeTruthy();
      if (url.endsWith('/api/refresh')) {
        imported = true;
        return Response.json({ state: 'complete' });
      }
      return Response.json({
        refresh: {
          sources: imported
            ? [{ id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', total: 0, listingCount: 0, updatedAt }]
            : [],
        },
      });
    };
    await expect(syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher })).rejects.toThrow(
      /not verified/,
    );
    expect(imported).toBe(true);
  }
});

test('external runner authenticates to the Worker with a bearer token', async () => {
  const seen: (string | null)[] = [];
  const fetcher = async (url: string, options?: RequestInit) => {
    if (url === 'https://api-v6.streeteasy.com/') return Response.json({ data: { searchRentals: { totalCount: 0, edges: [] } } });
    seen.push(new Headers(options?.headers).get('Authorization'));
    return Response.json({
      refresh: {
        sources: [
          { id: 'streeteasy-live', status: 'updated', transport: 'v6-daily', listingCount: 0, updatedAt: new Date().toISOString() },
        ],
      },
    });
  };
  await syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher });
  expect(seen).toStrictEqual(['Bearer synthetic-test-token']);
});

test('import body is refused before upload when it exceeds the Worker limit', async () => {
  const { importBody, MAX_IMPORT_BYTES } = await import('../scripts/sync-streeteasy.ts');
  const listings = Array.from({ length: 500 }, (_, index) => ({ id: 'streeteasy:' + index, address: crypto.randomUUID() }));
  const { bytes } = importBody({ listings, total: listings.length });
  expect(bytes < MAX_IMPORT_BYTES).toBeTruthy();
  expect(() => importBody({ listings, total: listings.length }, false, bytes - 1)).toThrow(/upload limit/);
  expect(() => importBody({ listings, total: listings.length }, false, bytes)).not.toThrow();
});

test('runner origin must be an HTTPS Worker URL', async () => {
  const { appOrigin } = await import('../scripts/sync-streeteasy.ts');
  expect(() => appOrigin(undefined)).toThrow(/APARTMENT_SEARCH_ORIGIN/);
  expect(() => appOrigin('http://apartment-search.example.workers.dev')).toThrow(/HTTPS/);
  expect(appOrigin('https://apartment-search.example.workers.dev/')).toBe('https://apartment-search.example.workers.dev');
});

test('the command line reads the token from stdin, honors --origin and --manual, and prints a summary', async () => {
  const { main } = await import('../scripts/sync-streeteasy.ts');
  const calls: { token: string; origin: string; manual?: boolean }[] = [];
  const printed: string[] = [];
  await main({
    argv: ['bun', 'sync', '--origin=https://worker.example.test/', '--manual'],
    env: {},
    input: new Blob(['secret-token\n']).stream(),
    sync: (async (options: { token: string; origin: string; manual?: boolean }) => {
      calls.push(options);
      return { state: 'updated' };
    }) as never,
    log: (line) => printed.push(line),
  });
  expect(calls).toStrictEqual([{ token: 'secret-token', origin: 'https://worker.example.test', manual: true }]);
  expect(sentJson<{ state: string }>(printed[0]).state).toBe('updated');
  await expect(
    main({
      argv: ['bun', 'sync'],
      env: { APARTMENT_SEARCH_ORIGIN: 'https://worker.example.test' },
      input: new Blob([]).stream(),
      sync: (async () => ({})) as never,
      log: () => {},
    }),
  ).rejects.toThrow(/token on stdin/);
});

test('a sync retries once when StreetEasy inventory moves mid-download', async () => {
  let rootRequests = 0;
  const rows = Array.from({ length: 600 }, (_, id) => ({
    id: String(id),
    price: 2000 + id,
    street: '1 Test Street',
    unit: String(id),
    zipCode: '10001',
    status: 'ACTIVE',
    bedroomCount: 1,
    urlPath: '/rental/' + (1000000 + id),
    areaName: 'Chelsea',
    buildingType: 'RENTAL',
    geoPoint: { latitude: 40.75, longitude: -73.99 },
  }));
  let imported = false;
  const fetcher = async (url: string, options?: RequestInit) => {
    if (url === 'https://api-v6.streeteasy.com/') {
      const page = Number(sentJson<GraphQlRequest>(options?.body).query.match(/page: (\d+)/)?.[1]);
      if (page === 1) rootRequests++;
      // During the first attempt, the second page reports one more rental than the first.
      const totalCount = page === 2 && rootRequests === 1 ? rows.length + 1 : rows.length;
      return Response.json({
        data: { searchRentals: { totalCount, edges: rows.slice((page - 1) * 500, page * 500).map((node) => ({ node })) } },
      });
    }
    if (url.endsWith('/api/refresh')) {
      imported = true;
      return Response.json({ state: 'complete' });
    }
    return Response.json({
      refresh: {
        sources: imported
          ? [
              {
                id: 'streeteasy-live',
                status: 'updated',
                transport: 'v6-daily',
                total: 600,
                listingCount: 600,
                updatedAt: new Date(Date.now() + 1000).toISOString(),
              },
            ]
          : [],
      },
    });
  };
  const result = await syncStreetEasy({ token: 'synthetic-test-token', origin: 'https://synthetic.example.invalid', fetcher });
  expect(result.state).toBe('updated');
  expect(rootRequests).toBe(2);
});
