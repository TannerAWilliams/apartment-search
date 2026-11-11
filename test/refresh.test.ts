import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseFirstMoverCsv } from '../server/firstmover.ts';
import { housingDate } from '../server/housing.ts';
import { refreshSources, refreshStatus, sourceRecent, storedDirectRentals, storedFeed, storedHousing, storedMarket } from '../server/refresh.ts';
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
  records = new Map();
  version = 0;

  async head(key) { return this.records.get(key)?.meta ?? null; }

  async get(key) {
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

  async put(key, value, options: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }; customMetadata?: Record<string, string> } = {}) {
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
  testWorker ??= build({
    entryPoints: [new URL('../server/worker.ts', import.meta.url).pathname],
    bundle: true, format: 'esm', platform: 'browser', write: false,
    plugins: [{
      name: 'test-assets',
      setup(builder) {
        builder.onResolve({ filter: /^virtual:web-assets$/ }, () => ({ path: 'web', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: `export default ${JSON.stringify({
            '/index.html': { type: 'text/html; charset=utf-8', content: '<script src="/_expo/static/test.js"></script>' },
            '/_expo/static/test.js': { type: 'text/javascript; charset=utf-8', content: 'void 0;' },
          })}`,
        }));
      },
    }],
  }).then(async ({ outputFiles }) => (await import('data:text/javascript;base64,' +
    Buffer.from(outputFiles[0].text).toString('base64'))).default);
  return testWorker;
}

test('worker integration serves the page and referenced asset with distinct cache policies', async () => {
  const worker = await loadWorker();
  const get = (path, method = 'GET') => worker.fetch(new Request('https://site.test' + path, { method }), {});
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

test('worker integration refreshes active rentals, scopes cards and pins, and removes a rented unit', async (t) => {
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
  t.mock.method(globalThis, 'fetch', async (input) =>
    String(input) === url ? Response.json({ listings: rows }) : new Response(null, { status: 404 }));
  const waits = [];
  const request = (path: string, body?: object) => worker.fetch(new Request('https://site.test/api/' + path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {}), env, { waitUntil: (promise) => waits.push(promise) });
  const filters = { region: 'manhattan-brooklyn', bedrooms: 1, maxRent: 5000, liveOnly: true, includeMap: true };
  const refresh = await request('refresh', { check: 'now' });
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).sources.find(({ id }) => id === 'zillow').status, 'updated');
  const result = await request('search', filters);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  const { total, matches, mapPoints } = await result.json();
  assert.equal(total, 1);
  assert.equal(matches[0].id, 'zillow:brooklyn');
  assert.equal(mapPoints[0].url, apartment.listingUrl);
  const market = await (await request('market?region=manhattan-brooklyn&grouping=city')).json();
  assert.deepEqual(market.areas.slice(1).map(({ label }) => label), ['Brooklyn, NY', 'Manhattan, NY']);
  assert.equal((await request('search', { ...filters, maxTransitMinutes: 30 })).status, 503);

  rows = [{ ...apartment, status: 'Rented' }];
  assert.equal((await request('refresh', { check: 'now' })).status, 200);
  const after = await (await request('search', filters)).json();
  assert.deepEqual(after.matches, []);
  assert.deepEqual(after.mapPoints, []);
  await Promise.all(waits);
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
      assert.match(new URL(url).searchParams.get('$where'), /2026-11-09/);
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

test('the Openigloo connector uses its published limit and preserves only exact source links', async () => {
  const { loadOpenigloo } = await import('../server/openigloo.ts');
  const areas = [];
  const checked = await loadOpenigloo(async (url, options) => {
    if (url.includes('addressbatch')) return new Response('"openigloo:sample",address,Match,Exact,normalized,"-73.99,40.67"\n');
    const message = JSON.parse(options.body);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'initialize') return Response.json({ id: message.id, result: { protocolVersion: '2025-11-25' } });
    assert.equal(message.params.arguments.limit, 10);
    assert.equal(Object.hasOwn(message.params.arguments, 'max_rent'), false);
    areas.push(message.params.arguments.area + ':' + message.params.arguments.bedrooms.join(','));
    return Response.json({ id: message.id, result: { structuredContent: { total_matches: 30, apartments: [
      { id: 'sample', address: '28 Example Street #2, Brooklyn, NY 11215', borough: 'Brooklyn',
        status: 'for_rent', bedrooms: 1, rent_per_month: 6100,
        url: 'https://www.openigloo.com/unit/nyc/sample' },
      { id: 'bad', address: '28 Example Street #3, Brooklyn, NY 11215', borough: 'Brooklyn',
        status: 'for_rent', bedrooms: 1, rent_per_month: 2000, url: 'https://unrelated.test/ads' },
    ] } } });
  }, at);
  assert.equal(checked.listings.length, 1);
  assert.deepEqual(areas.sort(), ['Brooklyn:1', 'Brooklyn:2', 'Manhattan:1', 'Manhattan:2']);
  assert.equal(checked.sampleLimit, 40);
  assert.equal(checked.listings[0].rent, 6100);
  assert.equal(checked.listings[0].unit, '2');
  assert.equal(checked.listings[0].latitude, 40.67);
  assert.equal(checked.listings[0].sources[0].id, 'openigloo');
});

test('Trulia collects unpriced one- and two-bedroom searches across both boroughs and pages', async () => {
  const { TRULIA_LIVE } = await import('../server/trulia.ts');
  const urls = [];
  const result = await TRULIA_LIVE.load(async (url) => {
    urls.push(url);
    const [city, beds] = new URL(url).pathname.match(/(Manhattan|Brooklyn),NY\/(\d)_beds\//).slice(1);
    const id = urls.length;
    const zipCode = city === 'Manhattan' ? '10019' : '11215';
    const row = {
      url: `/home/example-unit-${id}`,
      metadata: { unifiedListingType: 'RENTAL_SINGLE_UNIT' },
      activeListing: { __typename: 'HOME_ForRentListing' },
      location: { city: 'New York', stateCode: 'NY', zipCode, streetAddress: `${id} Example St #2`,
        coordinates: { latitude: 40.7, longitude: -73.99 } },
      bedrooms: { value: Number(beds) }, price: { price: 7250 },
    };
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { searchData: { homes: [row] } } }) + '</script>',
      { headers: { 'Content-Type': 'text/html' } });
  }, at);
  assert.equal(urls.length, 8);
  assert.equal(urls.filter((url) => url.endsWith('/2_p/')).length, 4);
  assert.ok(urls.every((url) => !url.includes('_price')));
  assert.equal(result.listings.length, 8);
  assert.ok(result.listings.every(({ rent }) => rent === 7250));
  assert.deepEqual([...new Set(result.listings.map(({ city, bedrooms }) => city + ':' + bedrooms))].sort(),
    ['Brooklyn:1', 'Brooklyn:2', 'Manhattan:1', 'Manhattan:2']);
});

const publicRental = {
  '@type': 'Apartment', url: 'https://streeteasy.com/rental/222', name: '28 Example Street #2', numberOfBedrooms: 1,
  address: { streetAddress: '28 Example Street', addressLocality: 'Park Slope', addressRegion: 'NY', postalCode: '11215' },
  geo: { latitude: 40.67, longitude: -73.99 },
  additionalProperty: [{ name: 'Monthly Rent', value: '$2,500/mo' }],
};
const streetEasyHtml = (rows) => '<script type="application/ld+json">' + JSON.stringify({ '@graph': rows }) + '</script>';
const csvUrl = 'https://raw.githubusercontent.com/benfwalla/firstmover-open-data-project/main/public/data/2026-10.csv';

function publishedCatalog(url, options) {
  if (url === 'https://www.firstmovernyc.com/open-data') return new Response(`<a href="${csvUrl}">Download</a>`);
  if (url === csvUrl) return new Headers(options.headers).get('If-None-Match') === '"csv"' ?
    new Response(null, { status: 304 }) : new Response(CSV, { headers: { ETag: '"csv"' } });
  return sources({ conditional: true })(url, options);
}

function zumperPage(rent) {
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
  const requests = [];
  const fetcher = async (url, options) => {
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
    assert.equal(check.sources.find(({ id }) => id === ZUMPER_LIVE.id).checkedAt, now.toISOString());
    assert.equal(check.sources.find(({ id }) => id === 'firstmover').status, minute === 26 ? 'updated' : 'current');
    const listings = (await storedDirectRentals(env.BUCKET, ZUMPER_LIVE)).listings;
    assert.deepEqual(listings.map(({ rent, city }) => [rent, city]), [[price, 'Brooklyn']]);
    assert.equal(listings[0].sources.length, 2);
    price -= 100;
  }
  const zumper = requests.filter((url) => new URL(url).hostname === 'www.zumper.com');
  assert.equal(zumper.length, 12);
  assert.equal(zumper.filter((url) => new URL(url).searchParams.get('page') === '2').length, 4);
  assert.deepEqual([...new Set(zumper.map((url) => new URL(url).pathname))].sort(),
    ['/apartments-for-rent/brooklyn-ny', '/apartments-for-rent/brooklyn-ny/cheap',
      '/apartments-for-rent/manhattan-ny', '/apartments-for-rent/manhattan-ny/cheap']);
  assert.ok(!requests.some((url) => /(^|\.)(zillow|compass|renthop|realtor)\.com$/.test(new URL(url).hostname)));
});

test('a rate-limited feed retains cached data and waits until its Retry-After time', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const now = new Date();
  await refreshSources(env, { fetcher: sources(), now: at });
  let rateLimited = true;
  let feedRequests = 0;
  const fetcher = (url, options) => {
    if (url !== feed.url) {
      if (url === csvUrl || url === 'https://www.firstmovernyc.com/open-data') return publishedCatalog(url, options);
      return new Response(null, { status: 404 });
    }
    feedRequests++;
    return rateLimited ? new Response(null, { status: 429, headers: { 'Retry-After': '600' } }) : Response.json([listing]);
  };
  const throttled = await refreshSources(env, { fetcher, now: new Date(now.getTime() + 1000), onDemand: true });
  const status = throttled.sources.find(({ id }) => id === feed.id);
  assert.equal(status.status, 'failed');
  assert.equal(status.updatedAt, at.toISOString());
  const due = Date.parse(status.retryAt);
  assert.ok(due >= now.getTime() + 600_000);
  const filters = { bedrooms: 2, zip: '07302' };
  assert.equal((await search(filters, env)).matches[0].kind, 'cached');
  assert.equal((await search({ ...filters, liveOnly: true }, env)).total, 0);

  const deferred = await refreshSources(env, { fetcher, now: new Date(due - 1), onDemand: true });
  assert.deepEqual(deferred.sources.find(({ id }) => id === feed.id), status);
  assert.equal(feedRequests, 1);

  rateLimited = false;
  const retried = await refreshSources(env, { fetcher, now: new Date(due), onDemand: true });
  assert.equal(retried.sources.find(({ id }) => id === feed.id).status, 'updated');
  assert.equal(feedRequests, 2);
});

test('an approved marketplace feed syncs every page before replacing its saved inventory', async () => {
  const partner = { id: 'apartments', url: 'https://feed.example.test/rentals', token: 'fixture-token' };
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([partner]) };
  const home = { ...listing, address: '28 Example Street', city: 'Brooklyn', zipCode: '11215',
    state: 'NY', county: 'Kings', bedrooms: 1, price: 6200,
    listingUrl: 'https://www.apartments.com/example-brooklyn-ny/fixture/' };
  const initialRows = Array.from({ length: 5000 }, (_, index) => ({ ...home, id: String(index), unit: String(index) }));
  let first = { listings: initialRows, next: '?page=2', total: 5002 };
  const fetcher = async (url, options) => {
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
  const status = result.sources.find(({ id }) => id === partner.id);
  assert.equal(status.status, 'updated');
  assert.equal(status.pages, 2);
  assert.equal(status.listingCount, 5001);
  assert.equal((await search({ bedrooms: 1, region: 'brooklyn', maxRent: null, liveOnly: true }, env)).total, 5001);
  assert.equal((await search({ bedrooms: 1, region: 'brooklyn', maxRent: 5000, liveOnly: true }, env)).total, 0);
  const base = { listings: [home], total: 2 };
  for (const [index, next] of ['https://different.example/rentals', '/rentals', null].entries()) {
    first = { ...base, next };
    const fail = await refreshSources(env, { now: new Date(now.getTime() + (index + 1) * 3_600_000), fetcher });
    const check = fail.sources.find(({ id }) => id === partner.id);
    assert.equal(check.status, 'failed');
    assert.match(check.error, /incomplete inventory/);
    assert.equal(check.updatedAt, now.toISOString());
    assert.equal((await storedFeed(env.BUCKET, partner)).listings.at(-1).id, 'apartments:late');
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
  assert.equal(retry.sources.find(({ id }) => id === 'housingconnect').status, 'updated');
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
  assert.equal(listing.rent, 2500);
  assert.equal(listing.city, 'Brooklyn');
  assert.equal(listing.unit, '2');
  assert.equal(listing.sources[0].url, 'https://streeteasy.com/rental/222');
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

  const status = failed.sources.find(({ id }) => id === STREETEASY_LIVE.id);
  assert.equal(status.status, 'failed');
  assert.equal(status.updatedAt, now.toISOString());
  assert.equal((await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).listings[0].rent, 2500);
  assert.ok(!sourceRecent(failed, STREETEASY_LIVE.id, new Date(now.getTime() + 3 * 60 * 60_000)));
});

test('refresh ingests public StreetEasy and Apartments.com rentals for both boroughs and both bedroom sizes', async () => {
  const env = { BUCKET: new TestBucket() };
  const requested = [];
  const fetcher = (url, options) => {
    const parsed = new URL(url);
    if (!['streeteasy.com', 'www.apartments.com'].includes(parsed.hostname)) {
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
    if (parsed.hostname === 'streeteasy.com') {
      const row = { ...publicRental, address, url: 'https://streeteasy.com/rental/' + unit,
        numberOfBedrooms: bedrooms, name: street + ' #' + unit };
      return new Response(streetEasyHtml([row, { ...row, url: row.url + '9',
        name: row.name + '9', offers: { availability: 'Rented' } }]), { headers });
    }
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
    const status = result.sources.find(({ id }) => id === source.id);
    assert.equal(status.status, 'updated', source.name);
    assert.equal(status.pages, 8);
    assert.equal(status.listingCount, 8);
  }
  assert.equal(new Set(requested).size, 16);
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
