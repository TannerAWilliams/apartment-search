import { required } from './test-values.ts';
import { test, spyOn } from 'bun:test';
import assert from 'node:assert/strict';
import { parseFirstMoverCsv } from '../server/firstmover.ts';
import { housingDate } from '../server/housing.ts';
import { refreshSources, saveObservedSnapshot, refreshStatus, sourceRecent, storedDirectRentals, storedFeed, storedHousing, storedMarket } from '../server/refresh.ts';
import { handleApi, search } from '../server/api.ts';
import { APARTMENTS_LIVE } from '../server/apartments-com.ts';
import { parseStreetEasyPage, STREETEASY_LIVE } from '../server/streeteasy.ts';
import { ZUMPER_LIVE } from '../server/zumper.ts';
import { rentSeries } from '../src/rent-history.ts';

const CSV = [
  'id,street,unit,state,zip_code,neighborhood,latitude,longitude,bedrooms,price,url,created_at_utc,building_type,ignored',
  'b,"28 Example Street",2,NY,11215,Park Slope,40.67,-73.99,1,2100,https://streeteasy.com/rental/222,2026-10-02,Rental,"with ""quotes"""',
  'a,"28 Example Street",2,NY,11215,Park Slope,40.67,-73.99,1,1900,https://streeteasy.com/rental/222,2026-10-01,Rental,"ignored"',
  'c,12 Grove Street,3,NJ,07302,Waterfront,40.71,-74.04,2,2400,https://streeteasy.com/rental/333,2026-10-03,Rental,"ignored"',
].join('\r\n');

class TestBucket {
  records = new Map<string, { bytes: Uint8Array; meta: { etag: string; customMetadata: Record<string, string> } }>();
  version = 0;

  async head(key: string) { return this.records.get(key)?.meta ?? null; }

  async get(key: string) {
    const record = this.records.get(key);
    if (!record) return null;
    const bytes = record.bytes;
    return {
      ...record.meta,
      text: async () => new TextDecoder().decode(bytes),
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async put(key: string, value: string | Uint8Array, options: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }; customMetadata?: Record<string, string> } = {}) {
    const previous = this.records.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== previous?.meta.etag) return null;
    const meta = { etag: String(++this.version), customMetadata: options.customMetadata ?? {} };
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.records.set(key, { bytes, meta });
    return meta;
  }
}

let testWorker;
function loadWorker() {
  testWorker ??= Bun.build({
    entrypoints: [new URL('../server/worker.ts', import.meta.url).pathname],
    format: 'esm', target: 'browser',
    plugins: [{
      name: 'test-assets',
      setup(builder) {
        builder.onResolve({ filter: /^virtual:web-assets$/ }, () => ({ path: 'web', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          loader: 'js', contents: `export default ${JSON.stringify({
            '/index.html': { type: 'text/html; charset=utf-8', content: '<script src="/_expo/static/test.js"></script>' },
            '/_expo/static/test.js': { type: 'text/javascript; charset=utf-8', content: 'void 0;' },
          })}`,
        }));
      },
    }],
  }).then(async ({ success, outputs }) => {
    if (!success || outputs.length !== 1) throw new Error('Fixture bundle failed.');
    return (await import('data:text/javascript;base64,' + Buffer.from(await outputs[0].text()).toString('base64'))).default;
  });
  return testWorker;
}

test('worker integration serves the page and referenced asset with distinct cache policies', async () => {
  const worker = await loadWorker();
  const get = (path: string, method = 'GET') => worker.fetch(new Request('https://site.test' + path, { method }), {});
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const script = (await home.text()).match(/src="([^"]+)"/)[1];
  const asset = await get(script);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.equal(await (await get(script, 'HEAD')).text(), '');
  assert.equal((await get('/missing')).status, 404);
  assert.equal((await get('/', 'POST')).status, 405);
  assert.equal((await get('/api/unknown')).status, 404);
});

test('worker integration refreshes active rentals, scopes cards and pins, and removes a rented unit', async () => {
  const worker = await loadWorker();
  const url = 'https://feed.example.test/fixtures';
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'zillow', url }]) };
  const apartment = { id: 'brooklyn', address: '50 Example Street', unit: '2A', city: 'Brooklyn', county: 'Kings',
    state: 'NY', zipCode: '11215', latitude: 40.67, longitude: -73.99, bedrooms: 1, rent: 2500, status: 'Active',
    listingUrl: 'https://www.zillow.com/homedetails/example/' };
  let rows = [
    apartment,
    { ...apartment, id: 'unlinked', unit: '2B', listingUrl: null },
    { ...apartment, id: 'queens', city: 'Queens', county: 'Queens', zipCode: '11375' },
  ];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (input) =>
    String(input) === url ? Response.json({ listings: rows }) : new Response(null, { status: 404 })) as typeof fetch);
  try {
  const waits: Promise<unknown>[] = [];
  const request = (path: string, body?: object) => worker.fetch(new Request('https://site.test/api/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {}), env, { waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
  const filters = { region: 'manhattan-brooklyn', bedrooms: 1, maxRent: 5000, liveOnly: true, includeMap: true };
  const refresh = await request('refresh', { check: 'now' });
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).sources.find(({ id }: { id: string }) => id === 'zillow').status, 'updated');
  const result = await request('search', filters);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const { total, matches, mapPoints } = await result.json();
  assert.equal(total, 1);
  assert.equal(matches[0].id, 'zillow:brooklyn');
  assert.equal(mapPoints[0].url, apartment.listingUrl);
  const market = await (await request('market?region=manhattan-brooklyn&grouping=city')).json();
  assert.deepEqual(market.areas.slice(1).map(({ label }: { label: string }) => label), ['Brooklyn, NY', 'Manhattan, NY']);
  assert.equal((await request('search', { ...filters, maxTransitMinutes: 30 })).status, 503);

  rows = [{ ...apartment, status: 'Rented' }];
  assert.equal((await request('refresh', { check: 'now' })).status, 200);
  const after = await (await request('search', filters)).json();
  assert.deepEqual(after.matches, []);
  assert.deepEqual(after.mapPoints, []);
  await Promise.all(waits);
  } finally { fetchMock.mockRestore(); }
});

const at = new Date('2026-11-10T00:25:00Z');
const next = new Date('2026-11-10T01:00:00Z');
const active = {
  lottery_id: '7612', lottery_name: 'Example Rental Lottery', lottery_status: 'Active', development_type: 'Rental',
  lottery_start_date: '2026-10-15T00:00:00.000', lottery_end_date: '2026-11-09T00:00:00.000',
  borough: 'BK', unit_distribution_1bed: '7',
};
const feed = { id: 'zillow', url: 'https://feed.example.test/current' };
const listing = { id: 'one', address: '12 Grove Street', unit: '3', city: 'Jersey City', state: 'NJ',
  zipCode: '07302', county: 'Hudson', status: 'Active', bedrooms: 2, price: 2400 };

function sources({ failure = false, conditional = false } = {}) {
  return async (url: string, options: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (failure) return new Response(null, { status: 503 });
    if (path.endsWith('/contents/public/data')) {
      if (conditional) {
        assert.equal(new Headers(options.headers).get('If-None-Match'), '"october"');
        return new Response(null, { status: 304 });
      }
      return Response.json([{ name: '2026-10.csv', sha: 'a'.repeat(40), type: 'file', size: CSV.length }],
        { headers: { ETag: '"october"' } });
    }
    if (path.endsWith('/2026-10.csv') && !conditional) return new Response(CSV);
    if (path === '/api/views/vy5i-a666') return Response.json({ rowsUpdatedAt: 1793635221 });
    if (path === '/resource/vy5i-a666.json') {
      assert.match(required(new URL(url).searchParams.get('$where')), /2026-11-09/);
      return Response.json([active, { ...active, lottery_id: '1', lottery_status: 'Tenant Selection' }]);
    }
    if (path === '/resource/nibs-na6y.json') return Response.json([
      { lottery_id: '7612', house_number: '28', street_name: 'Example St', borough: 'BK', address_zipcode: '11215' },
    ]);
    if (url === feed.url) return Response.json([listing]);
    assert.fail('Unexpected network request: ' + url);
  };
}

test('the FirstMover import handles CSV quotes, orders prices by first posting, and deduplicates original links', () => {
  const rows = parseFirstMoverCsv(CSV, '2026-10');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][11], 1900);
  assert.equal(rows[1][3], 'Jersey City');
  assert.throws(() => parseFirstMoverCsv(CSV, '2026-09'), /different month/);
});

test('an hourly refresh persists each source, makes charts use the imported records, and skips the duplicate hour', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const first = await refreshSources(env, { fetcher: sources(), now: at });
  assert.equal(first.state, 'complete');
  assert.deepEqual(first.sources.filter(({ status }) => status !== 'feed_required').map(({ id, status }) => [id, status]), [
    ['firstmover', 'updated'], ['housingconnect', 'updated'], ['zillow', 'updated'],
  ]);
  assert.equal((await storedFeed(env.BUCKET, feed)).listings[0].rent, 2400);
  assert.equal((await storedHousing(env.BUCKET, at)).opportunities[0].addresses[0], '28 Example St, Brooklyn 11215');

  const api = await handleApi(new Request('https://private.test/api/market?region=nyc'), env);
  const chart = await api.json();
  assert.equal(chart.month, '2026-10');
  assert.equal(chart.areas[0].sizes[1].median, 1900);

  const duplicate = await refreshSources(env, { fetcher: () => assert.fail('The hour was already checked'), now: at });
  assert.equal(duplicate.state, 'already_checked');
  const updated = await refreshSources(env, { fetcher: sources({ conditional: true }), now: next });
  assert.equal(updated.state, 'complete');
  assert.equal(updated.sources[0].status, 'current');
  assert.equal(updated.sources[1].status, 'current');
  assert.equal(updated.sources[0].updatedAt, at.toISOString());
  assert.equal(updated.lastCheckedAt, next.toISOString());
});

test('failed sources preserve the last data and expired lotteries are removed at the Eastern date boundary', async () => {
  const env = { BUCKET: new TestBucket() };
  await refreshSources(env, { fetcher: sources(), now: at });
  const failure = await refreshSources(env, { fetcher: sources({ failure: true }), now: next });
  assert.equal(failure.state, 'partial');
  assert.ok(failure.sources.filter(({ status }) => status !== 'feed_required')
    .every(({ status, updatedAt }) => status === 'failed' && updatedAt === at.toISOString()));
  assert.equal((await storedMarket(env.BUCKET)).listings[0].rent, 1900);
  assert.equal((await storedHousing(env.BUCKET, at)).opportunities.length, 1);
  assert.equal(housingDate(new Date('2026-11-10T05:00:00Z')), '2026-11-10');
  assert.equal((await storedHousing(env.BUCKET, new Date('2026-11-10T05:00:00Z'))).opportunities.length, 0);
  assert.deepEqual(await refreshStatus(env.BUCKET), { lastCheckedAt: next.toISOString(), sources: failure.sources });
});

test('only one overlapping refresh can claim the hourly write', async () => {
  const env = { BUCKET: new TestBucket() };
  let calls = 0;
  const fetcher = async (url: string, options?: RequestInit) => { calls++; return sources()(url, options); };
  const results = await Promise.all([refreshSources(env, { fetcher, now: at }), refreshSources(env, { fetcher, now: at })]);
  assert.deepEqual(results.map(({ state }) => state).sort(), ['complete', 'running']);
  assert.equal(calls, 5);
});

test('the private writer imports a completed public check without publisher access', async () => {
  const { encodeSourceImport, pullPublicSources } = await import('../src/pull-sources.ts');
  const inputs = await pullPublicSources({ market: null }, sources(), at);
  const env = { BUCKET: new TestBucket(), APP_ACCESS_TOKEN: 'test-owner' };
  const request = new Request('https://private.test/api/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-owner' },
    body: JSON.stringify(encodeSourceImport(inputs)),
  });
  const response = await handleApi(request, env, { requireToken: true });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'complete');
  assert.equal((await storedHousing(env.BUCKET, at)).opportunities.length, 1);
  assert.equal((await storedMarket(env.BUCKET)).listings.length, 2);
});

test('Trulia collects bounded one- and two-bedroom searches across NY, NJ and CT', async () => {
  const { TRULIA_LIVE } = await import('../server/trulia.ts');
  const urls: string[] = [];
  const result = await TRULIA_LIVE.load(async (url: string) => {
    urls.push(url);
    const [rawCity, state, beds] = required(new URL(url).pathname.match(/(Manhattan|Brooklyn|Jersey_City|Stamford),(NY|NJ|CT)\/(\d)_beds\//)).slice(1);
    const city = rawCity.replaceAll('_', ' ');
    const id = urls.length;
    const zipCode = { Manhattan: '10019', Brooklyn: '11215', 'Jersey City': '07302', Stamford: '06901' }[city];
    const row = {
      url: `/home/example-unit-${id}`,
      metadata: { unifiedListingType: 'RENTAL_SINGLE_UNIT' },
      activeListing: { __typename: 'HOME_ForRentListing' },
      location: { city, stateCode: state, zipCode, streetAddress: `${id} Example St #2`,
        coordinates: { latitude: 40.7, longitude: -73.99 } },
      bedrooms: { value: Number(beds) }, price: { price: 7250 },
    };
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { searchData: { homes: [row] } } }) + '</script>',
      { headers: { 'Content-Type': 'text/html' } });
  }, at);
  assert.equal(urls.length, 16);
  assert.equal(urls.filter((url) => url.endsWith('/2_p/')).length, 8);
  assert.ok(urls.every((url) => !url.includes('_price')));
  assert.equal(result.listings.length, 16);
  assert.ok(result.listings.every(({ rent }) => rent === 7250));
  assert.deepEqual([...new Set(result.listings.map(({ city, bedrooms }) => city + ':' + bedrooms))].sort(),
    ['Brooklyn:1', 'Brooklyn:2', 'Jersey City:1', 'Jersey City:2', 'Manhattan:1', 'Manhattan:2', 'Stamford:1', 'Stamford:2']);
});

const publicRental = {
  '@type': 'Apartment', url: 'https://streeteasy.com/rental/222', name: '28 Example Street #2', numberOfBedrooms: 1,
  address: { streetAddress: '28 Example Street', addressLocality: 'Park Slope', addressRegion: 'NY', postalCode: '11215' },
  geo: { latitude: 40.67, longitude: -73.99 },
  additionalProperty: [{ name: 'Monthly Rent', value: '$2,500/mo' }],
};
const streetEasyHtml = (rows: unknown[]) => '<script type="application/ld+json">' + JSON.stringify({ '@graph': rows }) + '</script>';
const csvUrl = 'https://raw.githubusercontent.com/benfwalla/firstmover-open-data-project/main/public/data/2026-10.csv';

function publishedCatalog(url: string, options: RequestInit = {}) {
  if (url === 'https://www.firstmovernyc.com/open-data') return new Response(`<a href="${csvUrl}">Download</a>`);
  if (url === csvUrl) return new Headers(options.headers).get('If-None-Match') === '"csv"' ?
    new Response(null, { status: 304 }) : new Response(CSV, { headers: { ETag: '"csv"' } });
  return sources({ conditional: true })(url, options);
}

function zumperPage(rent: number) {
  const rental = { url: 'https://www.zumper.com/listings/222p/28-example-street', listing_id: 222,
    listing_status: 1, listing_type: 1, property_type: 4, state: 'NY', city: 'Brooklyn', zipcode: '11215',
    address: '28 Example Street #2', lat: 40.67, lng: -73.99, min_price: rent, max_price: rent, min_bedrooms: 1, max_bedrooms: 1 };
  const listables = [rental, { ...rental, listing_id: 224, url: '/listings/224p/28-example-street' },
    { ...rental, listing_id: 223, url: '/listings/223p/1-bedroom-example',
    title: 'Private bedroom in a shared apartment' }];
  const body = 'window.__PRELOADED_STATE__ = ' + JSON.stringify({ currentSearch: { listables: { listables } } }) + '; window.__GIT_SHA__';
  return new Response(body, { headers: { 'Content-Type': 'text/html' } });
}

test('opening or reloading the app fetches new source data even within the same hour', async () => {
  const env = { BUCKET: new TestBucket() };
  await refreshSources(env, { fetcher: sources(), now: at });
  let price = 2500;
  const requests: string[] = [];
  const fetcher = async (url: string, options: RequestInit = {}) => {
    const host = new URL(url).hostname;
    requests.push(url);
    assert.equal(new Headers(options.headers).get('Cache-Control'), 'no-cache');
    if (host === 'www.zumper.com') return zumperPage(price);
    if (['www.firstmovernyc.com', 'raw.githubusercontent.com', 'data.cityofnewyork.us'].includes(host)) return publishedCatalog(url, options);
    return new Response(null, { status: 404 });
  };
  for (const minute of [26, 27]) {
    const now = new Date('2026-11-10T00:' + minute + ':00Z');
    const check = await refreshSources(env, { fetcher, now, onDemand: true });
    assert.equal(required(check.sources.find(({ id }: { id: string }) => id === ZUMPER_LIVE.id)).checkedAt, now.toISOString());
    assert.equal(required(check.sources.find(({ id }: { id: string }) => id === 'firstmover')).status, minute === 26 ? 'updated' : 'current');
    const listings = required((await storedDirectRentals(env.BUCKET, ZUMPER_LIVE))).listings;
    assert.deepEqual(listings.map(({ rent, city }) => [rent, city]), [[price, 'Brooklyn']]);
    assert.equal(listings[0].sources.length, 2);
    price -= 100;
  }
  const zumper = requests.filter((url) => new URL(url).hostname === 'www.zumper.com');
  assert.equal(zumper.length, 24);
  assert.equal(zumper.filter((url) => new URL(url).searchParams.get('page') === '2').length, 8);
  assert.deepEqual([...new Set(zumper.map((url) => new URL(url).pathname))].sort(),
    ['/apartments-for-rent/brooklyn-ny', '/apartments-for-rent/brooklyn-ny/cheap',
      '/apartments-for-rent/jersey-city-nj', '/apartments-for-rent/jersey-city-nj/cheap',
      '/apartments-for-rent/manhattan-ny', '/apartments-for-rent/manhattan-ny/cheap',
      '/apartments-for-rent/stamford-ct', '/apartments-for-rent/stamford-ct/cheap']);
  for (const domain of ['zillow', 'compass', 'renthop', 'realtor']) {
    assert.ok(requests.some((url) => new URL(url).hostname === `www.${domain}.com`));
  }
});

test('a rate-limited feed retains cached data and waits until its Retry-After time', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const now = new Date();
  await refreshSources(env, { fetcher: sources(), now: at });
  let rateLimited = true;
  let feedRequests = 0;
  const fetcher = (url: string, options: RequestInit = {}) => {
    if (url !== feed.url) {
      if (url === csvUrl || url === 'https://www.firstmovernyc.com/open-data') return publishedCatalog(url, options);
      return new Response(null, { status: 404 });
    }
    feedRequests++;
    return rateLimited ? new Response(null, { status: 429, headers: { 'Retry-After': '600' } }) : Response.json([listing]);
  };
  const throttled = await refreshSources(env, { fetcher, now: new Date(now.getTime() + 1000), onDemand: true });
  const status = throttled.sources.find(({ id }: { id: string }) => id === feed.id);
  assert.equal(required(status).status, 'failed');
  assert.equal(required(status).updatedAt, at.toISOString());
  const due = Date.parse(required(required(status).retryAt));
  assert.ok(due >= now.getTime() + 600_000);
  const filters = { bedrooms: 2, zip: '07302' };
  assert.equal((await search(filters, env)).matches[0].kind, 'cached');
  assert.equal((await search({ ...filters, liveOnly: true }, env)).total, 0);

  const deferred = await refreshSources(env, { fetcher, now: new Date(due - 1), onDemand: true });
  assert.deepEqual(deferred.sources.find(({ id }: { id: string }) => id === feed.id), status);
  assert.equal(feedRequests, 1);

  rateLimited = false;
  const retried = await refreshSources(env, { fetcher, now: new Date(due), onDemand: true });
  assert.equal(required(retried.sources.find(({ id }: { id: string }) => id === feed.id)).status, 'updated');
  assert.equal(feedRequests, 2);
});

test('an approved marketplace feed syncs every page before replacing its saved inventory', async () => {
  const partner = { id: 'apartments', url: 'https://feed.example.test/rentals', token: 'fixture-token' };
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([partner]) };
  const home = { ...listing, address: '28 Example Street', city: 'Brooklyn', zipCode: '11215',
    state: 'NY', county: 'Kings', bedrooms: 1, price: 6200,
    listingUrl: 'https://www.apartments.com/example-brooklyn-ny/fixture/' };
  const initialRows = Array.from({ length: 5000 }, (_, index) => ({ ...home, id: String(index), unit: String(index) }));
  let first: { listings: typeof initialRows; next: string | null; total: number } = { listings: initialRows, next: '?page=2', total: 5002 };
  const fetcher = async (url: string, options: RequestInit = {}) => {
    if (new URL(url).hostname !== 'feed.example.test') return sources()(url, options);
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer fixture-token');
    assert.equal(options.redirect, 'error');
    if (url === partner.url) return Response.json(first);
    assert.equal(url, partner.url + '?page=2');
    return Response.json({ listings: [
      { ...home, id: 'late', unit: 'PH', price: 7100 },
      { ...home, id: 'rented', unit: 'R', status: 'Rented' },
    ], next: null, total: 5002 });
  };
  const now = new Date();
  const result = await refreshSources(env, { now, fetcher });
  const status = result.sources.find(({ id }: { id: string }) => id === partner.id);
  assert.equal(required(status).status, 'updated');
  assert.equal(required(status).pages, 2);
  assert.equal(required(status).listingCount, 5001);
  assert.equal((await search({ bedrooms: 1, region: 'brooklyn', maxRent: null, liveOnly: true }, env)).total, 5001);
  assert.equal((await search({ bedrooms: 1, region: 'brooklyn', maxRent: 5000, liveOnly: true }, env)).total, 0);
  const base = { listings: [home], total: 2 };
  for (const [index, next] of ['https://different.example/rentals', '/rentals', null].entries()) {
    first = { ...base, next };
    const fail = await refreshSources(env, { now: new Date(now.getTime() + (index + 1) * 3_600_000), fetcher });
    const check = fail.sources.find(({ id }: { id: string }) => id === partner.id);
    assert.equal(required(check).status, 'failed');
    assert.match(required(required(check).error), /incomplete inventory/);
    assert.equal(required(check).updatedAt, now.toISOString());
    assert.equal(required(required(await storedFeed(env.BUCKET, partner)).listings.at(-1)).id, 'apartments:late');
  }
});

test('a browser export retry updates only the failed public source it recovered', async () => {
  const env = { BUCKET: new TestBucket() };
  const initial = await refreshSources(env, { now: at, imports: {
    firstmover: null, housingconnect: null, [STREETEASY_LIVE.id]: null,
  } });
  const retry = await refreshSources(env, { now: new Date(at.getTime() + 1000), fallback: true, imports: {
    housingconnect: { publishedAt: null, opportunities: [] },
  } });
  assert.equal(required(retry.sources.find(({ id }: { id: string }) => id === 'housingconnect')).status, 'updated');
  for (const id of ['firstmover', STREETEASY_LIVE.id]) {
    assert.deepEqual(retry.sources.find((source) => source.id === id), initial.sources.find((source) => source.id === id));
  }
});

test('StreetEasy parses public apartment metadata and skips other sizes, houses, and foreign links', () => {
  const html = streetEasyHtml([
    publicRental,
    { ...publicRental, numberOfBedrooms: 2 },
    { ...publicRental, '@type': 'SingleFamilyResidence' },
    { ...publicRental, url: 'https://example.test/rental/222' },
  ]);
  const [listing, ...others] = parseStreetEasyPage(html, 'NY', 1, at.toISOString());
  assert.deepEqual(others, []);
  assert.equal(required(listing).rent, 2500);
  assert.equal(required(listing).city, 'Brooklyn');
  assert.equal(required(listing).unit, '2');
  assert.equal(required(listing).sources[0].url, 'https://streeteasy.com/rental/222');
  assert.throws(() => parseStreetEasyPage('<h1>Sign in</h1>', 'NY', 1, at.toISOString()), /recognized rental page/);
});

test('a failed StreetEasy refresh retains its previous listing as cached', async () => {
  const env = { BUCKET: new TestBucket() };
  const now = new Date();
  const newer = new Date(now.getTime() + 60 * 60_000);
  const [listing] = parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, now.toISOString());
  const firstmover = { changed: true, rows: parseFirstMoverCsv(CSV, '2026-10'),
    month: '2026-10', revision: 'a'.repeat(40), catalogEtag: '"october"' };
  const housingconnect = { opportunities: [] };
  const saved = await refreshSources(env, { now, imports: {
    firstmover, housingconnect, [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 },
  } });
  assert.ok(sourceRecent(saved, STREETEASY_LIVE.id, now));
  assert.equal((await search({ bedrooms: 1, zip: '11215', liveOnly: true }, env)).total, 1);
  const failed = await refreshSources(env, { now: newer, imports: {
    firstmover: { ...firstmover, changed: false }, housingconnect, [STREETEASY_LIVE.id]: null,
  } });
  const matches = (await search({ bedrooms: 1, zip: '11215' }, env)).matches;
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rent, 2500);
  assert.equal(matches[0].sources[0].kind, 'cached');
  assert.equal((await search({ bedrooms: 1, zip: '11215', liveOnly: true }, env)).total, 0);

  const status = failed.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id);
  assert.equal(required(status).status, 'failed');
  assert.equal(required(status).updatedAt, now.toISOString());
  assert.equal(required((await storedDirectRentals(env.BUCKET, STREETEASY_LIVE))).listings[0].rent, 2500);
  assert.ok(!sourceRecent(failed, STREETEASY_LIVE.id, new Date(now.getTime() + 3 * 60 * 60_000)));
});

test('session refresh ingests StreetEasy v6 at most daily and checks Apartments.com in both boroughs', async () => {
  const env = { BUCKET: new TestBucket() };
  const requested: string[] = [];
  const fetcher = (url: string, options: RequestInit = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'api-v6.streeteasy.com') {
      requested.push(url);
      assert.equal(options.method, 'POST');
      const { query } = JSON.parse(String(options.body));
      assert.match(query, /rentalStatus: ACTIVE/);
      assert.doesNotMatch(query, /areas:/);
      assert.doesNotMatch(query, /lowerBound/);
      const edges = ['10001', '11215'].flatMap((zipCode, borough) => [1, 2].map((bedroomCount) => {
        const id = String(800 + borough * 10 + bedroomCount);
        return { node: { id, street: '28 Example Street', unit: id, zipCode, bedroomCount,
          status: 'ACTIVE', price: 6500, urlPath: '/rental/' + id } };
      }));
      edges.push({ node: { ...edges[0].node, id: '999', unit: 'PENTHOUSE', urlPath: '/rental/999', bedroomCount: 5 } });
      for (let index = 0; index < 496; index += 1) {
        const id = String(2000 + index);
        edges.push({ node: { ...edges[0].node, id, unit: id, urlPath: '/rental/' + id } });
      }
      const offset = query.includes('page: 2') ? 500 : 0;
      return Response.json({ data: { searchRentals: { totalCount: edges.length, edges: edges.slice(offset, offset + 500) } } });
    }
    if (parsed.hostname !== 'www.apartments.com') {
      if (url === csvUrl || ['www.firstmovernyc.com', 'data.cityofnewyork.us'].includes(parsed.hostname)) {
        return publishedCatalog(url, options);
      }
      return new Response(null, { status: 404 });
    }
    requested.push(url);
    const bedrooms = url.includes('1-bedroom') ? 1 : 2;
    const brooklyn = url.includes('brooklyn');
    const zip = brooklyn ? '11215' : '10001';
    const page = parsed.searchParams.get('page') === '2' || url.endsWith('/2/') ? 2 : 1;
    const unit = (brooklyn ? 10 : 20) + bedrooms * 2 + page;
    const street = '28 Example Street';
    const address = { streetAddress: street, addressRegion: 'NY', postalCode: zip };
    const headers = { 'Content-Type': 'text/html' };
    const id = 'rentl' + unit;
    const item = { url: 'https://www.apartments.com/example-unit-' + (unit + 100) + '/' + id + '/',
      name: street + ' Unit ' + (unit + 100), mainEntity: { address, geo: publicRental.geo },
      potentialAction: { '@type': 'RentAction' },
      offers: { '@type': 'Offer', price: 6300, priceCurrency: 'USD', availability: 'https://schema.org/InStock' } };
    const collection = { '@graph': [{ '@type': 'CollectionPage', mainEntity: {
      itemListElement: [{ item }, { item: { ...item, name: street, offers: { ...item.offers, '@type': 'AggregateOffer' } } }],
    } }] };
    const lines = JSON.stringify([item.url, '', street, '', '', bedrooms + ' bd']);
    return new Response('<script type="application/ld+json">' + JSON.stringify(collection) +
      '</script><button data-listing-key="' + id + '" data-listing-share-lines=\'' + lines + '\'></button>', { headers });
  };
  const result = await refreshSources(env, { onDemand: true, fetcher });
  for (const source of [STREETEASY_LIVE, APARTMENTS_LIVE]) {
    const status = result.sources.find(({ id }: { id: string }) => id === source.id);
    assert.equal(required(status).status, 'updated', source.name);
    assert.equal(required(status).pages, source === STREETEASY_LIVE ? 2 : 8);
    assert.equal(required(status).listingCount, source === STREETEASY_LIVE ? 501 : 8);
  }
  assert.equal(new Set(requested).size, 9);
  assert.equal(required(result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id)).total, 501);
  const v6Requests = () => requested.filter((url) => url === 'https://api-v6.streeteasy.com/').length;
  assert.equal(v6Requests(), 2);
  await refreshSources(env, { onDemand: true, fetcher });
  assert.equal(v6Requests(), 2);
  const filters = { region: 'brooklyn', bedrooms: 2, maxRent: null, liveOnly: true, source: 'apartments' };
  assert.equal((await search(filters, env)).total, 2);
  assert.equal((await search({ ...filters, maxRent: 5000 }, env)).total, 0);
});

test('a previous live sample remains searchable under All results after it ages out', async () => {
  const env = { BUCKET: new TestBucket() };
  const old = new Date(Date.now() - 3 * 60 * 60_000);
  const [listing] = parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, old.toISOString());
  await refreshSources(env, { now: old, imports: {
    firstmover: { changed: true, rows: parseFirstMoverCsv(CSV, '2026-10'), month: '2026-10', revision: 'a'.repeat(40) },
    housingconnect: { opportunities: [] },
    [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 },
  } });
  const filters = { bedrooms: 1, zip: '11215' };
  const all = await search(filters, env);
  assert.deepEqual(all.matches.map(({ kind, rent }) => [kind, rent]), [['cached', 2500]]);
  assert.equal((await search({ ...filters, liveOnly: true }, env)).total, 0);
});

test('a new FirstMover month keeps the previous published medians in the six-month chart', async () => {
  const env = { BUCKET: new TestBucket() };
  const firstmover = { changed: true, rows: parseFirstMoverCsv(CSV, '2026-10'),
    month: '2026-10', revision: 'a'.repeat(40), catalogEtag: '"october"' };
  const housingconnect = { opportunities: [] };
  await refreshSources(env, { now: at, imports: { firstmover, housingconnect } });
  await refreshSources(env, { now: next, imports: { housingconnect, firstmover: {
    ...firstmover, month: '2026-11', revision: 'b'.repeat(40),
    rows: parseFirstMoverCsv(CSV.replaceAll('2026-10', '2026-11').replace('1900', '2200'), '2026-11'),
  } } });
  const chart = await (await handleApi(new Request('https://private.test/api/market?region=nyc'), env)).json();
  const trend = rentSeries(chart.areas[0], 1, chart.month, chart.history);
  assert.equal(trend.length, 6);
  assert.deepEqual(trend.slice(-2), [
    { month: '2026-10', median: 1900, count: 1 },
    { month: '2026-11', median: 2200, count: 1 },
  ]);
});

test('external StreetEasy recovery updates only failed inventory and keeps it daily-fresh', async () => {
  const env = { BUCKET: new TestBucket() };
  const initial = await refreshSources(env, { now: at, imports: {
    firstmover: null, housingconnect: null, [STREETEASY_LIVE.id]: null,
  } });
  const listing = required(parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, at.toISOString())[0]);
  const recovered = { listings: [listing], pages: 41, total: 1, rawCount: 1, checkedAt: at.toISOString(), transport: 'v6-daily' };
  const retryAt = new Date(at.getTime() + 1000);
  const result = await refreshSources(env, { now: retryAt, fallback: true, imports: { [STREETEASY_LIVE.id]: recovered } });
  const status = result.sources.find(({id})=>id===STREETEASY_LIVE.id);
  assert.equal(required(status).status,'updated'); assert.equal(required(status).pages,41); assert.equal(required(status).transport,'v6-daily');
  for(const id of ['firstmover','housingconnect'])assert.deepEqual(result.sources.find(s=>s.id===id),initial.sources.find(s=>s.id===id));
  assert.equal(sourceRecent(result,STREETEASY_LIVE.id,new Date(at.getTime()+3*60*60_000)),true);
});
test('external StreetEasy recovery rejects stale or incomplete receipt without overwriting stored inventory', async()=>{
 const env={BUCKET:new TestBucket()};
 await refreshSources(env,{now:at,imports:{[STREETEASY_LIVE.id]:null}});
 const [listing]=parseStreetEasyPage(streetEasyHtml([publicRental]),'NY',1,at.toISOString());
 for(const changes of [{rawCount:0},{checkedAt:new Date(at.getTime()-11*60_000).toISOString()}]){
   const result=await refreshSources(env,{now:at,fallback:true,imports:{[STREETEASY_LIVE.id]:{
    listings:[listing],pages:1,total:1,rawCount:1,checkedAt:at.toISOString(),transport:'v6-daily',...changes,
   }}});
   assert.equal(required(result.sources.find(s=>s.id===STREETEASY_LIVE.id)).status,'failed');
   assert.equal(await storedDirectRentals(env.BUCKET,STREETEASY_LIVE),null);
 }
});
test('external daily StreetEasy sync continues without anyone opening the app',async()=>{
 const env={BUCKET:new TestBucket()};
 const [listing]=parseStreetEasyPage(streetEasyHtml([publicRental]),'NY',1,at.toISOString());
 const receipt=(now: Date)=>({listings:[listing],pages:1,total:1,rawCount:1,checkedAt:now.toISOString(),transport:'v6-daily'});
 const first=await refreshSources(env,{now:at,fallback:true,imports:{[STREETEASY_LIVE.id]:receipt(at)}});
 assert.equal(required(first.sources.find(s=>s.id===STREETEASY_LIVE.id)).status,'updated');
 const later=new Date(at.getTime()+24*60*60_000+1);
 const second=await refreshSources(env,{now:later,fallback:true,imports:{[STREETEASY_LIVE.id]:receipt(later)}});
 assert.equal(required(second.sources.find(s=>s.id===STREETEASY_LIVE.id)).updatedAt,later.toISOString());
});

test('manual StreetEasy refresh bypasses daily cache, preserves other sources and respects retry cooldown',async()=>{
 const env={BUCKET:new TestBucket()};
 const [listing]=parseStreetEasyPage(streetEasyHtml([publicRental]),'NY',1,at.toISOString());
 const receipt={listings:[listing],pages:1,total:1,rawCount:1,checkedAt:at.toISOString(),transport:'v6-daily'};
 const initial=await refreshSources(env,{now:at,imports:{firstmover:null,'streeteasy-live':receipt}});
 const later=new Date(at.getTime()+1000);
 const refreshed=await refreshSources(env,{now:later,onlyStreetEasy:true,imports:{'streeteasy-live':{...receipt,checkedAt:later.toISOString()}}});
 assert.equal(required(refreshed.sources.find(s=>s.id==='streeteasy-live')).updatedAt,later.toISOString());
 assert.deepEqual(refreshed.sources.find(s=>s.id==='firstmover'),initial.sources.find(s=>s.id==='firstmover'));
 const failed=await refreshSources(env,{now:new Date(at.getTime()+2000),onDemand:true,onlyStreetEasy:true,fetcher:async(url)=>{
  assert.equal(url,'https://api-v6.streeteasy.com/'); return new Response(null,{status:403});
 }});
 assert.equal(required(failed.sources.find(s=>s.id==='streeteasy-live')).status,'failed');
 assert.equal(required((await storedDirectRentals(env.BUCKET,STREETEASY_LIVE))).listings.length,1);
 const skipped=await refreshSources(env,{now:new Date(at.getTime()+3000),onDemand:true,onlyStreetEasy:true,fetcher:async()=>{throw new Error('must not fetch during cooldown');}});
 assert.equal(skipped.state,'already_checked');
 assert.deepEqual(failed.sources.find(s=>s.id==='firstmover'),initial.sources.find(s=>s.id==='firstmover'));
});

test('targeted provider resync only attempts selected provider and preserves other status', async () => {
  const bucket = new TestBucket();
  const prior = { id: 'streeteasy-live', name: 'StreetEasy', status: 'updated', updatedAt: '2026-11-10T00:00:00Z', checkedAt: '2026-11-10T00:00:00Z', listingCount: 8000 };
  await bucket.put('rentals/refresh.json', JSON.stringify({ sources: [prior] }));
  const requests: string[] = [];
  const result = await refreshSources({ BUCKET: bucket }, { onDemand: true, sourceId: 'zumper-live', now: new Date('2026-11-12T00:00:00Z'), fetcher: async (url: string) => {
    requests.push(String(url)); return new Response('', { status: 403 });
  } });
  assert.ok(requests.length > 0);
  assert.ok(requests.every((url) => url.includes('zumper')));
  assert.deepEqual(result.sources.find(({ id }: { id: string }) => id === 'streeteasy-live'), prior);
  assert.equal(result.sources.find(({ id }: { id: string }) => id === 'zumper-live')?.status, 'failed');
});
test('unknown or disconnected targeted provider is rejected before acquiring refresh lease', async () => {
  const bucket = new TestBucket();
  for (const sourceId of ['unknown', 'craigslist']) {
    await assert.rejects(refreshSources({ BUCKET: bucket }, { sourceId, onDemand: true }), /Unknown or disconnected/);
  }
  assert.equal(bucket.records.size, 0);
});

test('relay preparation is isolated to listing requests, not imports or unrelated sources', async () => {
  const env = { BUCKET: new TestBucket() };
  let prepared = 0;
  const prepareListingSources = async () => { prepared++; throw new Error('relay unavailable'); };
  const call = (body: unknown) => handleApi(new Request('https://private.test/api/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), env, { prepareListingSources, fetcher: async () => new Response('blocked', { status: 403 }) });
  await call({ source: 'streeteasy-live', imports: {} });
  assert.equal(prepared, 0);
  await call({ check: 'now', source: 'apartments-live' });
  assert.equal(prepared, 0);
  await call({ check: 'now', source: 'streeteasy-live' });
  assert.equal(prepared, 1);
  await call({ check: 'now', source: 'hotpads-live' });
  assert.equal(prepared, 2);
});

test('provider 403 without wrapper metadata saves failure, releases lock and preserves inventory', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = required(parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, at.toISOString())[0]);
  await refreshSources(env, { now: at, sourceId: STREETEASY_LIVE.id,
    imports: { [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 } } });
  const before = await storedDirectRentals(env.BUCKET, STREETEASY_LIVE);
  assert.equal(required(before).listings.length, 1);
  const result = await refreshSources(env, { now: next, sourceId: STREETEASY_LIVE.id, onDemand: true,
    fetcher: async () => { throw Object.assign(new Error('Provider denied request'), { httpStatus: 403 }); } });
  const status = result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id);
  assert.equal(result.state, 'partial');
  assert.equal(required(status).status, 'failed');
  assert.equal(required(status).updatedAt, at.toISOString());
  assert.equal(Date.parse(required(required(status).retryAt)), next.getTime() + 15 * 60_000);
  assert.deepEqual(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE), before);
  assert.equal((await required((await env.BUCKET.get('rentals/refresh.json'))).json()).running, false);
});

test('duplicate imported listing IDs fail without replacing the last valid source snapshot', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = required(parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, at.toISOString())[0]);
  await refreshSources(env, { now: at, sourceId: STREETEASY_LIVE.id,
    imports: { [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 } } });
  const before = await storedDirectRentals(env.BUCKET, STREETEASY_LIVE);
  for (const duplicate of [listing, { ...listing, rent: required(listing).rent + 100 }]) {
    const result = await refreshSources(env, { now: next, sourceId: STREETEASY_LIVE.id,
      imports: { [STREETEASY_LIVE.id]: { listings: [listing, duplicate], pages: 10 } } });
    const status = result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id);
    assert.equal(required(status).status, 'failed');
    assert.equal(required(status).listingCount, 1);
    assert.equal(required(status).updatedAt, at.toISOString());
    assert.deepEqual(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE), before);
  }
});

test('partner feed pagination duplicates cannot replace a complete cached snapshot', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  await refreshSources(env, { fetcher: sources(), now: at, sourceId: feed.id });
  const before = await storedFeed(env.BUCKET, feed);
  assert.equal(before.listings.length, 1);
  let calls = 0;
  const result = await refreshSources(env, { now: next, sourceId: feed.id, onDemand: true,
    fetcher: async (url: string) => {
      calls++;
      assert.ok(url === feed.url || url === feed.url + '?page=2');
      return Response.json({ listings: [{ ...listing, price: calls === 1 ? 3000 : 3100 }],
        total: 2, next: calls === 1 ? '?page=2' : null });
    } });
  assert.equal(calls, 2);
  const status = result.sources.find(({ id }: { id: string }) => id === feed.id);
  assert.equal(required(status).status, 'failed');
  assert.equal(required(status).updatedAt, at.toISOString());
  assert.deepEqual(await storedFeed(env.BUCKET, feed), before);
});


test('price observations persist atomically with successful source snapshots, not failed refreshes', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = required(parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, at.toISOString())[0]);
  const run = (date: Date, rent: number) => refreshSources(env, { now: date, sourceId: STREETEASY_LIVE.id,
    imports: { [STREETEASY_LIVE.id]: { listings: [{ ...listing, rent }], pages: 10 } } });
  await run(at, 2500);
  await run(next, 2400);
  const stored = await storedDirectRentals(env.BUCKET, STREETEASY_LIVE);
  assert.deepEqual(required(required(stored).listings[0].priceHistory).observations.map(o => o.rent), [2500, 2400]);
  assert.equal(required(required(stored).observationHistory).entries.length, 1);
  const originalPut = env.BUCKET.put.bind(env.BUCKET);
  env.BUCKET.put = async (key, value, options) => {
    if (key === 'rentals/streeteasy-live.json.gz') throw new Error('Synthetic storage full');
    return originalPut(key, value, options);
  };
  const later = new Date(next.getTime() + 86400000);
  const failed = await run(later, 2200);
  assert.equal(required(failed.sources.find(s => s.id === STREETEASY_LIVE.id)).status, 'failed');
  assert.deepEqual(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE), stored);
});

test('overlapping source snapshot writes reject stale history instead of overwriting the winner', async () => {
  const bucket = new TestBucket();
  const listing = required(parseStreetEasyPage(streetEasyHtml([publicRental]), 'NY', 1, at.toISOString())[0]);
  const key = 'rentals/streeteasy-live.json.gz';
  await saveObservedSnapshot(bucket, key, {}, [listing], STREETEASY_LIVE.id, at.toISOString());
  const get = bucket.get.bind(bucket);
  let release: () => void = () => { throw new Error('Fixture gate not initialized'); };
  let hasRead: () => void = () => { throw new Error('Fixture signal not initialized'); };
  const read = new Promise<void>(resolve => { hasRead = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let blocked = false;
  bucket.get = async name => {
    const result = await get(name);
    if (name === key && !blocked) { blocked = true; hasRead(); await gate; }
    return result;
  };
  const old = saveObservedSnapshot(bucket, key, {}, [{ ...listing, rent: 2400 }], STREETEASY_LIVE.id, next.toISOString());
  await read;
  await saveObservedSnapshot(bucket, key, {}, [{ ...listing, rent: 2300 }], STREETEASY_LIVE.id, new Date(next.getTime() + 1000).toISOString());
  release();
  await assert.rejects(old, /changed during refresh/);
  const winner = await storedDirectRentals(bucket, STREETEASY_LIVE);
  assert.equal(required(winner).listings[0].rent, 2300);
  assert.equal(required(required(winner).listings[0].priceHistory).observations.some(o => o.rent === 2400), false);
});
