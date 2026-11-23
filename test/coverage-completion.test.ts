/** Branches that no other test reached: validation, fallbacks and error paths. */
import { expect, test } from 'bun:test';
import { alertChannels } from '../server/alerts.ts';
import { exactBuildingAddress } from '../server/building-records.ts';
import { routeCommutes } from '../server/commute.ts';
import { configuredFeeds } from '../server/listings.ts';
import { consoleSink } from '../server/log.ts';
import { offline } from '../server/search.ts';
import { brodskyListingUrl, parseBrodskyRentals } from '../server/brodsky.ts';
import { glenwoodListingUrl } from '../server/glenwood.ts';
import { stuyTownListingUrl } from '../server/stuytown.ts';
import { createBuildingReportCache } from '../src/building-report-cache.ts';
import { marketplaceLinks } from '../src/marketplaces.ts';
import { decodeSourceImport } from '../src/source-import.ts';
import { sourceCoverage, sourceRows } from '../src/source-status.ts';
import { sentJson } from './fixtures/json.ts';
import type { TravelTimeRequest } from '../server/commute.ts';

test('push notifications are configured only when all three VAPID settings are', () => {
  const vapid = { VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'https://example.test' };
  expect(alertChannels(vapid).vapid).toEqual({ publicKey: 'public', privateKey: 'private', subject: 'https://example.test' });
  expect(alertChannels({ ...vapid, VAPID_SUBJECT: undefined }).vapid).toBeNull();
});

test('building lookups take the borough from the ZIP code in every borough', () => {
  const borough = (zip: string) => exactBuildingAddress({ address: '100 Main Street', city: 'X', state: 'NY', zip })?.borough;
  expect([borough('10001'), borough('10451'), borough('11201'), borough('11354'), borough('11004'), borough('10301')]).toEqual([
    '1',
    '2',
    '3',
    '4',
    '4',
    '5',
  ]);
  expect(borough('07302')).toBeUndefined();
  // A New York ZIP outside the five boroughs gives no borough, so the address is not looked up.
  expect(exactBuildingAddress({ address: '100 Main Street', city: 'Albany', state: 'NY', zip: '12207' })).toBeNull();
  // Without a ZIP borough, the county alone decides.
  expect(exactBuildingAddress({ address: '100 Main Street', city: 'X', state: 'NY', zip: '12207', county: 'Kings' })?.borough).toBe('3');
});

test('commute times outside zero to three hours are not used', async () => {
  const workplace = { label: 'Work', latitude: 40.75, longitude: -73.98 };
  const listing = { id: 'a', latitude: 40.7, longitude: -73.95 };
  const fetcher = async (_url: string, options?: RequestInit) => {
    const origins = sentJson<TravelTimeRequest>(options?.body).locations.filter(({ id }) => id !== 'workplace');
    return Response.json({
      results: ['transit', 'driving'].map((search_id) => ({
        search_id,
        locations: origins.map(({ id }) => ({ id, properties: { travel_time: 99_999 } })),
      })),
    });
  };
  const [routed] = await routeCommutes([listing], workplace, { appId: 'app', apiKey: 'key' }, fetcher);
  expect(routed).toMatchObject({ transitSeconds: null, drivingSeconds: null });
});

test('a configured feed needs a name unless its ID is a known marketplace', () => {
  expect(() =>
    configuredFeeds({ FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'myfeed', url: 'https://example.com/feed.json' }]) }),
  ).toThrow('missing a unique ID, name, or HTTPS URL');
  expect(
    configuredFeeds({ FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'zillow', url: 'https://example.com/feed.json' }]) })[0]?.name,
  ).toBe('Zillow');
});

test('each level goes to its own console stream', () => {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  console.log = (line: string) => lines.push('log ' + line);
  console.warn = (line: string) => lines.push('warn ' + line);
  console.error = (line: string) => lines.push('error ' + line);
  try {
    consoleSink('info', 'a');
    consoleSink('warn', 'b');
    consoleSink('error', 'c');
  } finally {
    Object.assign(console, saved);
  }
  expect(lines).toEqual(['log a', 'warn b', 'error c']);
});

test('saved-inventory checks never reach the network', () => {
  expect(() => offline('https://example.com')).toThrow('read saved inventory only');
});

test('landlord links that are not URLs at all are refused', () => {
  for (const check of [brodskyListingUrl, glenwoodListingUrl, stuyTownListingUrl]) {
    expect(check('https://[broken')).toBeNull();
    expect(check(42)).toBeNull();
  }
  // A listing cut off mid-object is a page that ended early, not a short list.
  expect(() =>
    parseBrodskyRentals(`<script>self.__next_f.push(${JSON.stringify([1, '{"uid":"a","propertyUid":"b","x":"{'])})</script>`),
  ).toThrow('ended early');
});

test('the building report cache keeps the hundred most recent reports', async () => {
  const cache = createBuildingReportCache();
  const signal = new AbortController().signal;
  let requests = 0;
  const request = async () => {
    requests++;
    return { status: 'matched', checkedAt: '2026-11-23T00:00:00Z' };
  };
  const listing = (index: number) => ({ address: `${index} Main Street`, city: 'Manhattan', state: 'NY', zip: '10001' });
  for (let index = 0; index < 101; index++) await cache(listing(index), request, signal);
  await cache(listing(100), request, signal);
  expect(requests).toBe(101);
  // The oldest report was dropped to make room.
  await cache(listing(0), request, signal);
  expect(requests).toBe(102);
});

test('StreetEasy browse links describe exactly the filters they carry', () => {
  const streetEasy = (bedrooms: number | null, maxRent: number | null) =>
    marketplaceLinks({ city: 'Brooklyn', state: 'NY', region: 'nyc', zip: '11201' }, { zip: '', bedrooms, maxRent }).find(
      ({ id }) => id === 'streeteasy',
    )?.detail;
  expect([streetEasy(2, 3000), streetEasy(2, null), streetEasy(null, 3000), streetEasy(null, null)]).toEqual([
    'Area + bedrooms + rent limit',
    'Area + bedroom count',
    'Area + rent limit',
    'Area search',
  ]);
});

test('a source import without a payload is refused', () => {
  for (const body of [null, {}, { payload: 3 }]) expect(() => decodeSourceImport(body)).toThrow('compressed source import is required');
});

test('the source list says when a source is paused, has saved data or was only partly checked', () => {
  const rows = sourceRows(
    [
      { id: 'a', name: 'A', resyncable: true, paused: true },
      { id: 'b', name: 'B', resyncable: true },
    ],
    [{ id: 'b', name: 'B', status: 'updated', updatedAt: '2026-11-01T00:00:00Z', checkedAt: '2026-11-01T00:00:00Z' }],
    {},
  );
  expect(rows.map(({ state }) => state)).toEqual(['Sync paused', 'Saved data available']);
  expect(
    sourceCoverage({ id: 'x', name: 'X', status: 'updated', checkedAt: null, updatedAt: null, partial: true, pages: 2, requestedPages: 3 }),
  ).toContain('Partial check: 2/3 pages succeeded');
});

test('an Openigloo search below borough level that cannot be split further is counted as unresolved', async () => {
  const { crawlOpenigloo } = await import('../server/openigloo.ts');
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: 'u' + index, rent_per_month: 2000 }));
  const crawl = await crawlOpenigloo(
    async () => ({ total: 15, rows }),
    [{ borough: 'Brooklyn', area: 'Park Slope', bedrooms: 1, min: 2000, max: 2000 }],
  );
  expect(crawl.unresolved).toBe(5);
});

test('Housing Connect with no open lotteries needs no building lookup', async () => {
  const { loadHousingConnect } = await import('../server/housing.ts');
  const requests: string[] = [];
  const result = await loadHousingConnect(async (url) => {
    requests.push(url);
    return url.includes('/api/views/') ? Response.json({ rowsUpdatedAt: 1_795_000_000 }) : Response.json([]);
  }, new Date('2026-11-23T12:00:00Z'));
  expect(result.opportunities).toEqual([]);
  expect(requests).toHaveLength(2);
});

test('a refresh with no options checks the public sources over the network', async () => {
  const { refreshSources } = await import('../server/refresh.ts');
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  // The test network refuses every request, so each source reports a failure rather than inventing data.
  const result = await refreshSources({ BUCKET: createMemoryBucket() });
  expect(result.sources.map(({ id, status }) => [id, status])).toEqual([
    ['firstmover', 'failed'],
    ['housingconnect', 'failed'],
  ]);
});

test('the address lookup returns the one matching point', async () => {
  const { handleApi } = await import('./fixtures/api.ts');
  const { readJson } = await import('./fixtures/json.ts');
  const fetcher = async () =>
    Response.json({
      result: { addressMatches: [{ matchedAddress: '30 ROCKEFELLER PLZ, NEW YORK, NY, 10112', coordinates: { x: -73.979, y: 40.759 } }] },
    });
  const response = await handleApi(
    new Request('https://app.test/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '30 Rockefeller Plaza, New York, NY' }),
    }),
    {},
    { fetcher },
  );
  expect(response.status).toBe(200);
  expect(await readJson(response)).toMatchObject({ latitude: 40.759, longitude: -73.979 });
});

test('a search keeps going when one saved source cannot be read', async () => {
  const { search } = await import('../server/search.ts');
  const { parseFilters } = await import('../src/search.ts');
  const { createMemoryBucket } = await import('./fixtures/memory-bucket.ts');
  const bucket = createMemoryBucket();
  const now = new Date().toISOString();
  await bucket.put(
    'rentals/refresh.json',
    JSON.stringify({ sources: [{ id: 'openigloo', name: 'Openigloo', status: 'updated', checkedAt: now, updatedAt: now }] }),
  );
  bucket.snapshots.read = async () => {
    throw new Error('storage down');
  };
  const result = await search(parseFilters({ liveOnly: true }), { BUCKET: bucket });
  expect(result.total).toBe(0);
});

test('a push with no options uses the network, which tests refuse', async () => {
  const { sendPush } = await import('../server/web-push.ts');
  const subscription = { endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'BAAA', auth: 'AAAA' } };
  await expect(sendPush(subscription, {}, { publicKey: 'BAAA', privateKey: 'AAAA', subject: 'https://example.test' })).rejects.toThrow();
});
