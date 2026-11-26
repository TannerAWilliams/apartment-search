import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { required } from './test-values.ts';
import { expect, spyOn, test } from 'bun:test';
import { parseFirstMoverCsv } from '../server/sources/firstmover.ts';
import { housingDate } from '../server/sources/housing.ts';
import { refreshSources } from '../server/refresh.ts';
import { saveObservedSnapshot, storedDirectRentals, storedFeed, storedHousing } from '../server/refresh/snapshots.ts';
import { refreshStatus, sourceRecent } from '../server/refresh/status.ts';
import { storedMarket } from '../server/refresh/market.ts';
import { handleApi } from './fixtures/api.ts';
import { search } from '../server/search.ts';
import { APARTMENTS_LIVE } from '../server/sources/apartments-com.ts';
import { STREETEASY_LIVE } from '../server/sources/streeteasy.ts';
import { normalizeListing } from '../src/listings.ts';
import { ZUMPER_LIVE, ZUMPER_MARKETS, zumperPacing } from '../server/sources/zumper.ts';

// Real Zumper syncs space pages a second apart; these tests use local fakes.
zumperPacing.intervalMs = 0;
import { rentSeries } from '../src/rent-history.ts';
import { type GraphQlRequest, readJson, sentJson } from './fixtures/json.ts';
import type { RefreshInfo } from '../src/api-client.ts';
import type { SearchResult } from '../src/domain.ts';
import type { RentMarket } from '../src/rent-history.ts';
import { parseFilters } from '../src/search.ts';

const CSV = [
  'id,street,unit,state,zip_code,neighborhood,latitude,longitude,bedrooms,price,url,created_at_utc,building_type,ignored',
  'b,"28 Example Street",2,NY,11215,Park Slope,40.67,-73.99,1,2100,https://streeteasy.com/rental/222,2026-10-02,Rental,"with ""quotes"""',
  'a,"28 Example Street",2,NY,11215,Park Slope,40.67,-73.99,1,1900,https://streeteasy.com/rental/222,2026-10-01,Rental,"ignored"',
  'c,12 Grove Street,3,NJ,07302,Waterfront,40.71,-74.04,2,2400,https://streeteasy.com/rental/333,2026-10-03,Rental,"ignored"',
].join('\r\n');

class TestBucket {
  snapshots = createMemoryBucket().snapshots;
  records = new Map<string, { bytes: Uint8Array; meta: { etag: string; customMetadata: Record<string, string> } }>();
  version = 0;

  async head(key: string) {
    return this.records.get(key)?.meta ?? null;
  }

  async get(key: string) {
    const record = this.records.get(key);
    if (!record) return null;
    const bytes = record.bytes;
    return {
      ...record.meta,
      text: async () => new TextDecoder().decode(bytes),
      json: async <T>() => JSON.parse(new TextDecoder().decode(bytes)) as T,
      arrayBuffer: async () => bytes.slice().buffer,
    };
  }

  async put(
    key: string,
    value: string | Uint8Array,
    options: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string }; customMetadata?: Record<string, string> } = {},
  ) {
    const previous = this.records.get(key);
    if (options.onlyIf?.etagDoesNotMatch === '*' && previous) return null;
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== previous?.meta.etag) return null;
    const meta = { etag: String(++this.version), customMetadata: options.customMetadata ?? {} };
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.records.set(key, { bytes, meta });
    return meta;
  }
}

test('the API refreshes active rentals, scopes cards and pins, and removes a rented unit', async () => {
  const url = 'https://feed.example.test/fixtures';
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'zillow', url }]) };
  const apartment = {
    id: 'brooklyn',
    address: '50 Example Street',
    unit: '2A',
    city: 'Brooklyn',
    county: 'Kings',
    state: 'NY',
    zipCode: '11215',
    latitude: 40.67,
    longitude: -73.99,
    bedrooms: 1,
    rent: 2500,
    status: 'Active',
    listingUrl: 'https://www.zillow.com/homedetails/example/',
  };
  let rows = [
    apartment,
    { ...apartment, id: 'unlinked', unit: '2B', listingUrl: null },
    { ...apartment, id: 'queens', city: 'Queens', county: 'Queens', zipCode: '11375' },
  ];
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation((async (input) =>
    String(input) === url ? Response.json({ listings: rows }) : new Response(null, { status: 404 })) as typeof fetch);
  try {
    const waits: Promise<unknown>[] = [];
    const request = (path: string, body?: object) =>
      handleApi(
        new Request(
          'https://site.test/api/' + path,
          body
            ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
              }
            : {},
        ),
        env,
        {
          waitUntil: (promise: Promise<unknown>) => {
            waits.push(promise);
          },
        },
      );
    const filters = { region: 'manhattan-brooklyn', bedrooms: 1, maxRent: 5000, liveOnly: true, includeMap: true };
    const refresh = await request('refresh', { check: 'now' });
    expect(refresh.status).toBe(200);
    expect((await readJson<RefreshInfo>(refresh)).sources.find(({ id }) => id === 'zillow')?.status).toBe('updated');
    const result = await request('search', filters);
    expect(result.headers.get('cache-control')).toBe('no-store');
    const { total, matches, mapPoints } = await readJson<SearchResult>(result);
    expect(total).toBe(1);
    expect(matches[0].id).toBe('zillow:brooklyn');
    expect(required(mapPoints)[0].url).toBe(apartment.listingUrl);
    const market = await readJson<RentMarket>(request('market?region=manhattan-brooklyn&grouping=city'));
    expect(market.areas.slice(1).map(({ label }) => label)).toStrictEqual(['Brooklyn, NY', 'Manhattan, NY']);
    expect((await request('search', { ...filters, maxTransitMinutes: 30 })).status).toBe(503);

    rows = [{ ...apartment, status: 'Rented' }];
    expect((await request('refresh', { check: 'now' })).status).toBe(200);
    const after = await readJson<SearchResult>(request('search', filters));
    expect(after.matches).toStrictEqual([]);
    expect(after.mapPoints).toStrictEqual([]);
    await Promise.all(waits);
  } finally {
    fetchMock.mockRestore();
  }
});

const at = new Date('2026-11-10T00:25:00Z');
const next = new Date('2026-11-10T01:00:00Z');
const active = {
  lottery_id: '7612',
  lottery_name: 'Example Rental Lottery',
  latitude: '40.848952',
  longitude: '-73.922559',
  applied_income_ami_low: '6',
  lottery_status: 'Active',
  development_type: 'Rental',
  lottery_start_date: '2026-10-15T00:00:00.000',
  lottery_end_date: '2026-11-09T00:00:00.000',
  borough: 'BK',
  unit_distribution_1bed: '7',
};
const feed = { id: 'zillow', url: 'https://feed.example.test/current' };
const listing = {
  id: 'one',
  address: '12 Grove Street',
  unit: '3',
  city: 'Jersey City',
  state: 'NJ',
  zipCode: '07302',
  county: 'Hudson',
  status: 'Active',
  bedrooms: 2,
  price: 2400,
};

function sources({ failure = false, conditional = false } = {}) {
  return async (url: string, options: RequestInit = {}) => {
    const path = new URL(url).pathname;
    if (failure) return new Response(null, { status: 503 });
    if (path.endsWith('/contents/public/data')) {
      if (conditional) {
        expect(new Headers(options.headers).get('If-None-Match')).toBe('"october"');
        return new Response(null, { status: 304 });
      }
      return Response.json([{ name: '2026-10.csv', sha: 'a'.repeat(40), type: 'file', size: CSV.length }], {
        headers: { ETag: '"october"' },
      });
    }
    if (path.endsWith('/2026-10.csv') && !conditional) return new Response(CSV);
    if (path === '/api/views/vy5i-a666') return Response.json({ rowsUpdatedAt: 1794153621 });
    if (path === '/resource/vy5i-a666.json') {
      expect(required(new URL(url).searchParams.get('$where'))).toMatch(/2026-11-09/);
      return Response.json([active, { ...active, lottery_id: '1', lottery_status: 'Tenant Selection' }]);
    }
    if (path === '/resource/nibs-na6y.json')
      return Response.json([
        { lottery_id: '7612', house_number: '28', street_name: 'Example St', borough: 'BK', address_zipcode: '11215' },
      ]);
    if (url === feed.url) return Response.json([listing]);
    expect.unreachable('Unexpected network request: ' + url);
  };
}

test('the FirstMover import handles CSV quotes, orders prices by first posting, and deduplicates original links', () => {
  const rows = parseFirstMoverCsv(CSV, '2026-10');
  expect(rows.length).toBe(2);
  expect(rows[0][11]).toBe(1900);
  expect(rows[1][3]).toBe('Jersey City');
  expect(() => parseFirstMoverCsv(CSV, '2026-09')).toThrow(/different month/);
  // A row without a StreetEasy link is dropped rather than saved half-described.
  expect(parseFirstMoverCsv(CSV.replace('https://streeteasy.com/rental/333', 'https://example.com/333'), '2026-10').length).toBe(1);
});

test('an hourly refresh persists each source, makes charts use the imported records, and skips the duplicate hour', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const first = await refreshSources(env, { fetcher: sources(), now: at });
  expect(first.state).toBe('complete');
  expect(first.sources.filter(({ status }) => status !== 'feed_required').map(({ id, status }) => [id, status])).toStrictEqual([
    ['firstmover', 'updated'],
    ['housingconnect', 'updated'],
    ['zillow', 'updated'],
  ]);
  expect((await storedFeed(env.BUCKET, feed)).listings[0].rent).toBe(2400);
  expect((await storedHousing(env.BUCKET, at)).opportunities[0].addresses[0]).toBe('28 Example St, Brooklyn 11215');

  const api = await handleApi(new Request('https://private.test/api/market?region=nyc'), env);
  const chart = await readJson<RentMarket>(api);
  expect(chart.month).toBe('2026-10');
  expect(chart.areas[0].sizes[1].median).toBe(1900);

  const duplicate = await refreshSources(env, { fetcher: () => expect.unreachable('The hour was already checked'), now: at });
  expect(duplicate.state).toBe('already_checked');
  const updated = await refreshSources(env, { fetcher: sources({ conditional: true }), now: next });
  expect(updated.state).toBe('complete');
  expect(updated.sources[0].status).toBe('current');
  expect(updated.sources[1].status).toBe('current');
  expect(updated.sources[0].updatedAt).toBe(at.toISOString());
  expect(updated.lastCheckedAt).toBe(next.toISOString());
});

test('failed sources preserve the last data and expired lotteries are removed at the Eastern date boundary', async () => {
  const env = { BUCKET: new TestBucket() };
  await refreshSources(env, { fetcher: sources(), now: at });
  const failure = await refreshSources(env, { fetcher: sources({ failure: true }), now: next });
  expect(failure.state).toBe('partial');
  expect(
    failure.sources
      .filter(({ status }) => status !== 'feed_required')
      .every(({ status, updatedAt }) => status === 'failed' && updatedAt === at.toISOString()),
  ).toBeTruthy();
  expect((await storedMarket(env.BUCKET)).listings[0].rent).toBe(1900);
  expect((await storedHousing(env.BUCKET, at)).opportunities.length).toBe(1);
  expect(housingDate(new Date('2026-11-10T05:00:00Z'))).toBe('2026-11-10');
  expect((await storedHousing(env.BUCKET, new Date('2026-11-10T05:00:00Z'))).opportunities.length).toBe(0);
  expect(await refreshStatus(env.BUCKET)).toStrictEqual({ lastCheckedAt: next.toISOString(), sources: failure.sources });
});

test('only one overlapping refresh can claim the hourly write', async () => {
  const env = { BUCKET: new TestBucket() };
  let calls = 0;
  const fetcher = async (url: string, options?: RequestInit) => {
    calls++;
    return sources()(url, options);
  };
  const results = await Promise.all([refreshSources(env, { fetcher, now: at }), refreshSources(env, { fetcher, now: at })]);
  expect(results.map(({ state }) => state).sort()).toStrictEqual(['complete', 'running']);
  expect(calls).toBe(5);
});

test('the private writer imports a completed public check without publisher access', async () => {
  const { pullPublicSources } = await import('../src/pull-sources.ts');
  const { encodeSourceImport } = await import('../src/source-import.ts');
  const inputs = await pullPublicSources({ market: null }, sources(), at);
  const env = { BUCKET: new TestBucket(), APP_ACCESS_TOKEN: 'test-owner' };
  const request = new Request('https://private.test/api/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-owner' },
    body: JSON.stringify(encodeSourceImport(inputs)),
  });
  const response = await handleApi(request, env);
  expect(response.status).toBe(200);
  expect((await readJson<RefreshInfo>(response)).state).toBe('complete');
  expect((await storedHousing(env.BUCKET, at)).opportunities.length).toBe(1);
  expect((await storedMarket(env.BUCKET)).listings.length).toBe(2);
});

test('Trulia collects bounded one- and two-bedroom searches across NYC, NJ, Long Island, Westchester and CT', async () => {
  const { TRULIA_LIVE, TRULIA_MARKETS } = await import('../server/sources/trulia.ts');
  const zips: Record<string, string> = { Manhattan: '10019', Brooklyn: '11215', Queens: '11101', Bronx: '10451', 'Staten Island': '10301' };
  const urls: string[] = [];
  const result = await TRULIA_LIVE.load(async (url: string) => {
    urls.push(url);
    const [rawCity, state, beds] = required(new URL(url).pathname.match(/for_rent\/([A-Za-z_]+),(NY|NJ|CT)\/(\d)_beds\//)).slice(1);
    const city = rawCity.replaceAll('_', ' ');
    const id = urls.length;
    const zipCode = zips[city] ?? { NJ: '07302', CT: '06901', NY: '10701' }[state];
    const row = {
      url: `/home/example-unit-${id}`,
      metadata: { unifiedListingType: 'RENTAL_SINGLE_UNIT' },
      activeListing: { __typename: 'HOME_ForRentListing' },
      location: {
        city,
        stateCode: state,
        zipCode,
        streetAddress: `${id} Example St #2`,
        coordinates: { latitude: 40.7, longitude: -73.99 },
      },
      bedrooms: { value: Number(beds) },
      price: { price: 7250 },
    };
    return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { searchData: { homes: [row] } } }) + '</script>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }, at);
  expect(urls.length).toBe(TRULIA_MARKETS.length * 4);
  expect(urls.filter((url) => url.endsWith('/2_p/')).length).toBe(TRULIA_MARKETS.length * 2);
  expect(urls.every((url) => !url.includes('_price'))).toBeTruthy();
  expect(result.listings.length).toBe(TRULIA_MARKETS.length * 4);
  expect(result.listings.every(({ rent }) => rent === 7250)).toBeTruthy();
  expect([...new Set(result.listings.map(({ city, bedrooms }) => city + ':' + bedrooms))].sort()).toStrictEqual(
    TRULIA_MARKETS.flatMap(({ city }) => [1, 2].map((beds) => (city === 'Bronx' ? 'The Bronx' : city) + ':' + beds)).sort(),
  );
});

/** A StreetEasy listing as the sync saves it. */
const streetEasyListing = (checkedAt: string) =>
  required(
    normalizeListing(
      {
        id: '222',
        url: 'https://streeteasy.com/rental/222',
        address: '28 Example Street',
        unit: '2',
        city: 'Brooklyn',
        state: 'NY',
        zipCode: '11215',
        region: 'nyc',
        neighborhood: 'Park Slope',
        latitude: 40.67,
        longitude: -73.99,
        bedrooms: 1,
        rent: 2500,
        status: 'Active',
        updatedAt: checkedAt,
      },
      { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' },
    ),
  );
const csvUrl = 'https://raw.githubusercontent.com/benfwalla/firstmover-open-data-project/main/public/data/2026-10.csv';

function publishedCatalog(url: string, options: RequestInit = {}) {
  if (url === 'https://www.firstmovernyc.com/open-data') return new Response(`<a href="${csvUrl}">Download</a>`);
  if (url === csvUrl)
    return new Headers(options.headers).get('If-None-Match') === '"csv"'
      ? new Response(null, { status: 304 })
      : new Response(CSV, { headers: { ETag: '"csv"' } });
  return sources({ conditional: true })(url, options);
}

function zumperPage(rent: number) {
  const rental = {
    url: 'https://www.zumper.com/listings/222p/28-example-street',
    listing_id: 222,
    listing_status: 1,
    listing_type: 1,
    property_type: 4,
    state: 'NY',
    city: 'Brooklyn',
    zipcode: '11215',
    address: '28 Example Street #2',
    lat: 40.67,
    lng: -73.99,
    min_price: rent,
    max_price: rent,
    min_bedrooms: 1,
    max_bedrooms: 1,
    min_bathrooms: 1,
    max_bathrooms: 1,
    min_square_feet: 650,
    max_square_feet: 650,
  };
  const listables = [
    rental,
    { ...rental, listing_id: 224, url: '/listings/224p/28-example-street' },
    { ...rental, listing_id: 223, url: '/listings/223p/1-bedroom-example', title: 'Private bedroom in a shared apartment' },
  ];
  const body = 'window.__PRELOADED_STATE__ = ' + JSON.stringify({ currentSearch: { listables: { listables } } }) + '; window.__GIT_SHA__';
  return new Response(body, { headers: { 'Content-Type': 'text/html' } });
}

// Zumper is a daily complete sync, so opening the app reuses it; a manual refresh fetches it again.
test('a manual refresh fetches new source data even within the same hour', async () => {
  const env = { BUCKET: new TestBucket() };
  await refreshSources(env, { fetcher: sources(), now: at });
  let price = 2500;
  const requests: string[] = [];
  const fetcher = async (url: string, options: RequestInit = {}) => {
    const host = new URL(url).hostname;
    requests.push(url);
    expect(new Headers(options.headers).get('Cache-Control')).toBe('no-cache');
    if (host === 'www.zumper.com') return zumperPage(price);
    if (['www.firstmovernyc.com', 'raw.githubusercontent.com', 'data.cityofnewyork.us'].includes(host))
      return publishedCatalog(url, options);
    return new Response(null, { status: 404 });
  };
  for (const minute of [26, 27]) {
    const now = new Date('2026-11-10T00:' + minute + ':00Z');
    const check = await refreshSources(env, { fetcher, now, onDemand: true });
    expect(required(check.sources.find(({ id }: { id: string }) => id === ZUMPER_LIVE.id)).checkedAt).toBe(now.toISOString());
    expect(required(check.sources.find(({ id }: { id: string }) => id === 'firstmover')).status).toBe(
      minute === 26 ? 'updated' : 'current',
    );
    const listings = required(await storedDirectRentals(env.BUCKET, ZUMPER_LIVE)).listings;
    expect(listings.map(({ rent, city }) => [rent, city])).toStrictEqual([[price, 'Brooklyn']]);
    expect(listings[0].sources.length).toBe(2);
    price -= 100;
  }
  const zumper = requests.filter((url) => new URL(url).hostname === 'www.zumper.com');
  // The fake repeats one page, so each market stops after its second page adds nothing new.
  expect(zumper.length).toBe(2 * ZUMPER_MARKETS.length * 2);
  expect(zumper.filter((url) => new URL(url).searchParams.get('page') === '2').length).toBe(2 * ZUMPER_MARKETS.length);
  expect([...new Set(zumper.map((url) => new URL(url).pathname))].sort()).toStrictEqual(
    ZUMPER_MARKETS.map(
      ({ city, state }) => '/apartments-for-rent/' + city.toLowerCase().replaceAll(' ', '-') + '-' + state.toLowerCase(),
    ).sort(),
  );
  // Sites that refuse automated requests are not asked at all.
  for (const domain of ['zillow', 'compass', 'renthop', 'realtor', 'redfin', 'apartments', 'hotpads']) {
    expect(requests.some((url) => new URL(url).hostname === `www.${domain}.com`)).toBe(false);
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
  expect(required(status).status).toBe('failed');
  expect(required(status).updatedAt).toBe(at.toISOString());
  const due = Date.parse(required(required(status).retryAt));
  expect(due >= now.getTime() + 600_000).toBeTruthy();
  const filters = parseFilters({ bedrooms: 2, zip: '07302' });
  expect((await search(filters, env)).matches[0].kind).toBe('cached');
  expect((await search(parseFilters({ ...filters, liveOnly: true }), env)).total).toBe(0);
  // Kept listings last checked over two days ago are not shown as available: they may well be rented.
  expect((await search(parseFilters({ ...filters, liveOnly: true, includeCached: true }), env)).total).toBe(0);

  const deferred = await refreshSources(env, { fetcher, now: new Date(due - 1), onDemand: true });
  expect(deferred.sources.find(({ id }: { id: string }) => id === feed.id)).toStrictEqual(status);
  expect(feedRequests).toBe(1);

  rateLimited = false;
  const retried = await refreshSources(env, { fetcher, now: new Date(due), onDemand: true });
  expect(required(retried.sources.find(({ id }: { id: string }) => id === feed.id)).status).toBe('updated');
  expect(feedRequests).toBe(2);
});

test('an approved marketplace feed syncs every page before replacing its saved inventory', async () => {
  const partner = { id: 'apartments', url: 'https://feed.example.test/rentals', token: 'fixture-token' };
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([partner]) };
  const home = {
    ...listing,
    address: '28 Example Street',
    city: 'Brooklyn',
    zipCode: '11215',
    state: 'NY',
    county: 'Kings',
    bedrooms: 1,
    price: 6200,
    listingUrl: 'https://www.apartments.com/example-brooklyn-ny/fixture/',
  };
  const initialRows = Array.from({ length: 5000 }, (_, index) => ({ ...home, id: String(index), unit: String(index) }));
  let first: { listings: typeof initialRows; next: string | null; total: number } = { listings: initialRows, next: '?page=2', total: 5002 };
  const fetcher = async (url: string, options: RequestInit = {}) => {
    if (new URL(url).hostname !== 'feed.example.test') return sources()(url, options);
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer fixture-token');
    expect(options.redirect).toBe('manual');
    if (url === partner.url) return Response.json(first);
    expect(url).toBe(partner.url + '?page=2');
    return Response.json({
      listings: [
        { ...home, id: 'late', unit: 'PH', price: 7100 },
        { ...home, id: 'rented', unit: 'R', status: 'Rented' },
      ],
      next: null,
      total: 5002,
    });
  };
  const now = new Date();
  const result = await refreshSources(env, { now, fetcher });
  const status = result.sources.find(({ id }: { id: string }) => id === partner.id);
  expect(required(status).status).toBe('updated');
  expect(required(status).pages).toBe(2);
  expect(required(status).listingCount).toBe(5001);
  expect((await search(parseFilters({ bedrooms: 1, region: 'brooklyn', maxRent: null, liveOnly: true }), env)).total).toBe(5001);
  expect((await search(parseFilters({ bedrooms: 1, region: 'brooklyn', maxRent: 5000, liveOnly: true }), env)).total).toBe(0);
  const base = { listings: [home], total: 2 };
  for (const [index, next] of ['https://different.example/rentals', '/rentals', null].entries()) {
    first = { ...base, next };
    const fail = await refreshSources(env, { now: new Date(now.getTime() + (index + 1) * 3_600_000), fetcher });
    const check = fail.sources.find(({ id }: { id: string }) => id === partner.id);
    expect(required(check).status).toBe('failed');
    expect(required(required(check).error)).toMatch(/incomplete inventory/);
    expect(required(check).updatedAt).toBe(now.toISOString());
    expect(required(required(await storedFeed(env.BUCKET, partner)).listings.at(-1)).id).toBe('apartments:late');
  }
});

test('a browser export retry updates only the failed public source it recovered', async () => {
  const env = { BUCKET: new TestBucket() };
  const initial = await refreshSources(env, {
    now: at,
    imports: {
      firstmover: null,
      housingconnect: null,
      [STREETEASY_LIVE.id]: null,
    },
  });
  const retry = await refreshSources(env, {
    now: new Date(at.getTime() + 1000),
    fallback: true,
    imports: {
      housingconnect: { publishedAt: null, opportunities: [] },
    },
  });
  expect(required(retry.sources.find(({ id }: { id: string }) => id === 'housingconnect')).status).toBe('updated');
  for (const id of ['firstmover', STREETEASY_LIVE.id]) {
    expect(retry.sources.find((source) => source.id === id)).toStrictEqual(initial.sources.find((source) => source.id === id));
  }
});

test('a failed StreetEasy refresh retains its previous listing as cached', async () => {
  const env = { BUCKET: new TestBucket() };
  const now = new Date();
  const newer = new Date(now.getTime() + 60 * 60_000);
  const listing = streetEasyListing(now.toISOString());
  const firstmover = {
    changed: true,
    rows: parseFirstMoverCsv(CSV, '2026-10'),
    month: '2026-10',
    revision: 'a'.repeat(40),
    catalogEtag: '"october"',
  };
  const housingconnect = { opportunities: [] };
  const saved = await refreshSources(env, {
    now,
    imports: {
      firstmover,
      housingconnect,
      [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 },
    },
  });
  expect(sourceRecent(saved, STREETEASY_LIVE.id, now)).toBeTruthy();
  expect((await search(parseFilters({ bedrooms: 1, zip: '11215', liveOnly: true }), env)).total).toBe(1);
  const failed = await refreshSources(env, {
    now: newer,
    imports: {
      firstmover: { ...firstmover, changed: false },
      housingconnect,
      [STREETEASY_LIVE.id]: null,
    },
  });
  const matches = (await search(parseFilters({ bedrooms: 1, zip: '11215' }), env)).matches;
  expect(matches.length).toBe(1);
  expect(matches[0].rent).toBe(2500);
  expect(matches[0].sources[0].kind).toBe('cached');
  expect((await search(parseFilters({ bedrooms: 1, zip: '11215', liveOnly: true }), env)).total).toBe(0);

  const status = failed.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id);
  expect(required(status).status).toBe('failed');
  expect(required(status).updatedAt).toBe(now.toISOString());
  expect(required(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).listings[0].rent).toBe(2500);
  expect(!sourceRecent(failed, STREETEASY_LIVE.id, new Date(now.getTime() + 3 * 60 * 60_000))).toBeTruthy();
});

test('a resync reads StreetEasy v6 each time and checks Apartments.com in both boroughs', async () => {
  const env = { BUCKET: new TestBucket() };
  const requested: string[] = [];
  const fetcher = (url: string, options: RequestInit = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'api-v6.streeteasy.com') {
      requested.push(url);
      expect(options.method).toBe('POST');
      const { query } = sentJson<GraphQlRequest>(options.body);
      expect(query).toMatch(/rentalStatus: ACTIVE/);
      expect(query).not.toMatch(/areas:/);
      expect(query).not.toMatch(/lowerBound/);
      const edges = ['10001', '11215'].flatMap((zipCode, borough) =>
        [1, 2].map((bedroomCount) => {
          const id = String(800 + borough * 10 + bedroomCount);
          return {
            node: {
              id,
              street: '28 Example Street',
              unit: id,
              zipCode,
              bedroomCount,
              status: 'ACTIVE',
              price: 6500,
              urlPath: '/rental/' + id,
            },
          };
        }),
      );
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
    const item = {
      url: 'https://www.apartments.com/example-unit-' + (unit + 100) + '/' + id + '/',
      name: street + ' Unit ' + (unit + 100),
      mainEntity: { address, geo: { latitude: 40.67, longitude: -73.99 } },
      potentialAction: { '@type': 'RentAction' },
      offers: { '@type': 'Offer', price: 6300, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    };
    const collection = {
      '@graph': [
        {
          '@type': 'CollectionPage',
          mainEntity: {
            itemListElement: [{ item }, { item: { ...item, name: street, offers: { ...item.offers, '@type': 'AggregateOffer' } } }],
          },
        },
      ],
    };
    const lines = JSON.stringify([item.url, '', street, '', '', bedrooms + ' bd']);
    return new Response(
      '<script type="application/ld+json">' +
        JSON.stringify(collection) +
        '</script><button data-listing-key="' +
        id +
        '" data-listing-share-lines=\'' +
        lines +
        "'></button>",
      { headers },
    );
  };
  const result = await refreshSources(env, { onDemand: true, fetcher });
  const status = required(result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id));
  expect(status.status).toBe('updated');
  expect(status.pages).toBe(2);
  expect(status.listingCount).toBe(501);
  // Apartments.com refuses automated requests, so a resync leaves it out; its reader still works on its pages,
  // and the result can be saved for it, as an authorized upload would be.
  expect(requested.some((url) => url.includes('apartments.com'))).toBe(false);
  const apartments = await APARTMENTS_LIVE.load(fetcher, new Date());
  expect(apartments.pages).toBe(8);
  expect(apartments.listings).toHaveLength(8);
  expect(new Set(requested).size).toBe(9);
  await refreshSources(env, { sourceId: APARTMENTS_LIVE.id, imports: { [APARTMENTS_LIVE.id]: apartments } });
  expect(required(result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id)).total).toBe(501);
  const v6Requests = () => requested.filter((url) => url === 'https://api-v6.streeteasy.com/').length;
  expect(v6Requests()).toBe(2);
  await refreshSources(env, { onDemand: true, fetcher });
  expect(v6Requests(), 'a resync is never skipped because saved data is recent').toBe(4);
  const filters = parseFilters({ region: 'brooklyn', bedrooms: 2, maxRent: null, liveOnly: true, source: 'apartments' });
  expect((await search(filters, env)).total).toBe(2);
  expect((await search(parseFilters({ ...filters, maxRent: 5000 }), env)).total).toBe(0);
});

test('a previous live sample remains searchable under All results after it ages out', async () => {
  const env = { BUCKET: new TestBucket() };
  const old = new Date(Date.now() - 3 * 60 * 60_000);
  const listing = streetEasyListing(old.toISOString());
  await refreshSources(env, {
    now: old,
    imports: {
      firstmover: { changed: true, rows: parseFirstMoverCsv(CSV, '2026-10'), month: '2026-10', revision: 'a'.repeat(40) },
      housingconnect: { opportunities: [] },
      [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 },
    },
  });
  const filters = parseFilters({ bedrooms: 1, zip: '11215' });
  const all = await search(filters, env);
  expect(all.matches.map(({ kind, rent }) => [kind, rent])).toStrictEqual([['cached', 2500]]);
  expect((await search(parseFilters({ ...filters, liveOnly: true }), env)).total).toBe(0);
});

test('a new FirstMover month keeps the previous published medians in the six-month chart', async () => {
  const env = { BUCKET: new TestBucket() };
  const firstmover = {
    changed: true,
    rows: parseFirstMoverCsv(CSV, '2026-10'),
    month: '2026-10',
    revision: 'a'.repeat(40),
    catalogEtag: '"october"',
  };
  const housingconnect = { opportunities: [] };
  await refreshSources(env, { now: at, imports: { firstmover, housingconnect } });
  await refreshSources(env, {
    now: next,
    imports: {
      housingconnect,
      firstmover: {
        ...firstmover,
        month: '2026-11',
        revision: 'b'.repeat(40),
        rows: parseFirstMoverCsv(CSV.replaceAll('2026-10', '2026-11').replace('1900', '2200'), '2026-11'),
      },
    },
  });
  const chart = await readJson<RentMarket>(handleApi(new Request('https://private.test/api/market?region=nyc'), env));
  const trend = rentSeries(chart.areas[0], 1, chart.month, chart.history);
  expect(trend.length).toBe(6);
  expect(trend.slice(-2)).toStrictEqual([
    { month: '2026-10', median: 1900, count: 1 },
    { month: '2026-11', median: 2200, count: 1 },
  ]);
});

test('external StreetEasy recovery updates only failed inventory and keeps it daily-fresh', async () => {
  const env = { BUCKET: new TestBucket() };
  const initial = await refreshSources(env, {
    now: at,
    imports: {
      firstmover: null,
      housingconnect: null,
      [STREETEASY_LIVE.id]: null,
    },
  });
  const listing = streetEasyListing(at.toISOString());
  const recovered = { listings: [listing], pages: 41, total: 1, rawCount: 1, checkedAt: at.toISOString(), transport: 'v6-daily' };
  const retryAt = new Date(at.getTime() + 1000);
  const result = await refreshSources(env, { now: retryAt, fallback: true, imports: { [STREETEASY_LIVE.id]: recovered } });
  const status = result.sources.find(({ id }) => id === STREETEASY_LIVE.id);
  expect(required(status).status).toBe('updated');
  expect(required(status).pages).toBe(41);
  expect(required(status).transport).toBe('v6-daily');
  for (const id of ['firstmover', 'housingconnect'])
    expect(result.sources.find((s) => s.id === id)).toStrictEqual(initial.sources.find((s) => s.id === id));
  expect(sourceRecent(result, STREETEASY_LIVE.id, new Date(at.getTime() + 3 * 60 * 60_000))).toBe(true);
});
test('external StreetEasy recovery rejects stale or incomplete receipt without overwriting stored inventory', async () => {
  const env = { BUCKET: new TestBucket() };
  await refreshSources(env, { now: at, imports: { [STREETEASY_LIVE.id]: null } });
  const listing = streetEasyListing(at.toISOString());
  for (const changes of [{ rawCount: 0 }, { checkedAt: new Date(at.getTime() - 11 * 60_000).toISOString() }]) {
    const result = await refreshSources(env, {
      now: at,
      fallback: true,
      imports: {
        [STREETEASY_LIVE.id]: {
          listings: [listing],
          pages: 1,
          total: 1,
          rawCount: 1,
          checkedAt: at.toISOString(),
          transport: 'v6-daily',
          ...changes,
        },
      },
    });
    expect(required(result.sources.find((s) => s.id === STREETEASY_LIVE.id)).status).toBe('failed');
    expect(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).toBeNull();
  }
});
test('external daily StreetEasy sync continues without anyone opening the app', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = streetEasyListing(at.toISOString());
  const receipt = (now: Date) => ({
    listings: [listing],
    pages: 1,
    total: 1,
    rawCount: 1,
    checkedAt: now.toISOString(),
    transport: 'v6-daily',
  });
  const first = await refreshSources(env, { now: at, fallback: true, imports: { [STREETEASY_LIVE.id]: receipt(at) } });
  expect(required(first.sources.find((s) => s.id === STREETEASY_LIVE.id)).status).toBe('updated');
  const later = new Date(at.getTime() + 24 * 60 * 60_000 + 1);
  const second = await refreshSources(env, { now: later, fallback: true, imports: { [STREETEASY_LIVE.id]: receipt(later) } });
  expect(required(second.sources.find((s) => s.id === STREETEASY_LIVE.id)).updatedAt).toBe(later.toISOString());
});

test('manual StreetEasy refresh bypasses daily cache, preserves other sources and respects retry cooldown', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = streetEasyListing(at.toISOString());
  const receipt = { listings: [listing], pages: 1, total: 1, rawCount: 1, checkedAt: at.toISOString(), transport: 'v6-daily' };
  const initial = await refreshSources(env, { now: at, imports: { firstmover: null, 'streeteasy-live': receipt } });
  const later = new Date(at.getTime() + 1000);
  const refreshed = await refreshSources(env, {
    now: later,
    onlyStreetEasy: true,
    imports: { 'streeteasy-live': { ...receipt, checkedAt: later.toISOString() } },
  });
  expect(required(refreshed.sources.find((s) => s.id === 'streeteasy-live')).updatedAt).toBe(later.toISOString());
  expect(refreshed.sources.find((s) => s.id === 'firstmover')).toStrictEqual(initial.sources.find((s) => s.id === 'firstmover'));
  const failed = await refreshSources(env, {
    now: new Date(at.getTime() + 2000),
    onDemand: true,
    onlyStreetEasy: true,
    fetcher: async (url) => {
      expect(url).toBe('https://api-v6.streeteasy.com/');
      return new Response(null, { status: 403 });
    },
  });
  expect(required(failed.sources.find((s) => s.id === 'streeteasy-live')).status).toBe('failed');
  expect(required(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).listings.length).toBe(1);
  const skipped = await refreshSources(env, {
    now: new Date(at.getTime() + 3000),
    onDemand: true,
    onlyStreetEasy: true,
    fetcher: async () => {
      throw new Error('must not fetch during cooldown');
    },
  });
  expect(skipped.state).toBe('already_checked');
  expect(failed.sources.find((s) => s.id === 'firstmover')).toStrictEqual(initial.sources.find((s) => s.id === 'firstmover'));
});

test('targeted provider resync only attempts selected provider and preserves other status', async () => {
  const bucket = new TestBucket();
  const prior = {
    id: 'streeteasy-live',
    name: 'StreetEasy',
    status: 'updated',
    updatedAt: '2026-11-10T00:00:00Z',
    checkedAt: '2026-11-10T00:00:00Z',
    listingCount: 8000,
  };
  await bucket.put('rentals/refresh.json', JSON.stringify({ sources: [prior] }));
  const requests: string[] = [];
  const result = await refreshSources(
    { BUCKET: bucket },
    {
      onDemand: true,
      sourceId: 'zumper-live',
      now: new Date('2026-11-12T00:00:00Z'),
      fetcher: async (url: string) => {
        requests.push(String(url));
        return new Response('', { status: 403 });
      },
    },
  );
  expect(requests.length > 0).toBeTruthy();
  expect(requests.every((url) => url.includes('zumper'))).toBeTruthy();
  expect(result.sources.find(({ id }: { id: string }) => id === 'streeteasy-live')).toStrictEqual(prior);
  expect(result.sources.find(({ id }: { id: string }) => id === 'zumper-live')?.status).toBe('failed');
});
test('unknown or disconnected targeted provider is rejected before acquiring refresh lease', async () => {
  const bucket = new TestBucket();
  for (const sourceId of ['unknown', 'craigslist']) {
    await expect(refreshSources({ BUCKET: bucket }, { sourceId, onDemand: true })).rejects.toThrow(/Unknown or disconnected/);
  }
  expect(bucket.records.size).toBe(0);
});

test('provider 403 without wrapper metadata saves failure, releases lock and preserves inventory', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = streetEasyListing(at.toISOString());
  await refreshSources(env, {
    now: at,
    sourceId: STREETEASY_LIVE.id,
    imports: { [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 } },
  });
  const before = await storedDirectRentals(env.BUCKET, STREETEASY_LIVE);
  expect(required(before).listings.length).toBe(1);
  const result = await refreshSources(env, {
    now: next,
    sourceId: STREETEASY_LIVE.id,
    onDemand: true,
    fetcher: async () => {
      throw Object.assign(new Error('Provider denied request'), { httpStatus: 403 });
    },
  });
  const status = result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id);
  expect(result.state).toBe('partial');
  expect(required(status).status).toBe('failed');
  expect(required(status).updatedAt).toBe(at.toISOString());
  expect(Date.parse(required(required(status).retryAt))).toBe(next.getTime() + 15 * 60_000);
  expect(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).toStrictEqual(before);
  expect((await required(await env.BUCKET.get('rentals/refresh.json')).json<{ running?: boolean }>()).running).toBe(false);
});

test('duplicate imported listing IDs fail without replacing the last valid source snapshot', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = streetEasyListing(at.toISOString());
  await refreshSources(env, {
    now: at,
    sourceId: STREETEASY_LIVE.id,
    imports: { [STREETEASY_LIVE.id]: { listings: [listing], pages: 10 } },
  });
  const before = await storedDirectRentals(env.BUCKET, STREETEASY_LIVE);
  for (const duplicate of [listing, { ...listing, rent: required(listing).rent + 100 }]) {
    const result = await refreshSources(env, {
      now: next,
      sourceId: STREETEASY_LIVE.id,
      imports: { [STREETEASY_LIVE.id]: { listings: [listing, duplicate], pages: 10 } },
    });
    const status = result.sources.find(({ id }: { id: string }) => id === STREETEASY_LIVE.id);
    expect(required(status).status).toBe('failed');
    expect(required(status).listingCount).toBe(1);
    expect(required(status).updatedAt).toBe(at.toISOString());
    expect(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).toStrictEqual(before);
  }
});

test('partner feed pagination duplicates cannot replace a complete cached snapshot', async () => {
  const env = { BUCKET: new TestBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  await refreshSources(env, { fetcher: sources(), now: at, sourceId: feed.id });
  const before = await storedFeed(env.BUCKET, feed);
  expect(before.listings.length).toBe(1);
  let calls = 0;
  const result = await refreshSources(env, {
    now: next,
    sourceId: feed.id,
    onDemand: true,
    fetcher: async (url: string) => {
      calls++;
      expect(url === feed.url || url === feed.url + '?page=2').toBeTruthy();
      return Response.json({
        listings: [{ ...listing, price: calls === 1 ? 3000 : 3100 }],
        total: 2,
        next: calls === 1 ? '?page=2' : null,
      });
    },
  });
  expect(calls).toBe(2);
  const status = result.sources.find(({ id }: { id: string }) => id === feed.id);
  expect(required(status).status).toBe('failed');
  expect(required(status).updatedAt).toBe(at.toISOString());
  expect(await storedFeed(env.BUCKET, feed)).toStrictEqual(before);
});

test('price observations persist atomically with successful source snapshots, not failed refreshes', async () => {
  const env = { BUCKET: new TestBucket() };
  const listing = streetEasyListing(at.toISOString());
  const run = (date: Date, rent: number) =>
    refreshSources(env, {
      now: date,
      sourceId: STREETEASY_LIVE.id,
      imports: { [STREETEASY_LIVE.id]: { listings: [{ ...listing, rent }], pages: 10 } },
    });
  await run(at, 2500);
  await run(next, 2400);
  const stored = await storedDirectRentals(env.BUCKET, STREETEASY_LIVE);
  expect(required(required(stored).listings[0].priceHistory).observations.map((o) => o.rent)).toStrictEqual([2500, 2400]);
  expect(required(await env.BUCKET.snapshots.read(STREETEASY_LIVE.id, { history: true })).history.length).toBe(1);
  const originalWrite = env.BUCKET.snapshots.write.bind(env.BUCKET.snapshots);
  env.BUCKET.snapshots.write = async (key, value, options) => {
    if (key === STREETEASY_LIVE.id) throw new Error('Synthetic storage full');
    return originalWrite(key, value, options);
  };
  const later = new Date(next.getTime() + 86400000);
  const failed = await run(later, 2200);
  expect(required(failed.sources.find((s) => s.id === STREETEASY_LIVE.id)).status).toBe('failed');
  expect(await storedDirectRentals(env.BUCKET, STREETEASY_LIVE)).toStrictEqual(stored);
});

test('overlapping source snapshot writes reject stale history instead of overwriting the winner', async () => {
  const bucket = new TestBucket();
  const listing = streetEasyListing(at.toISOString());
  const key = STREETEASY_LIVE.id;
  await saveObservedSnapshot(bucket, key, {}, [listing], STREETEASY_LIVE.id, at.toISOString());
  const read = bucket.snapshots.read.bind(bucket.snapshots);
  let release: () => void = () => {
    throw new Error('Fixture gate not initialized');
  };
  let hasRead: () => void = () => {
    throw new Error('Fixture signal not initialized');
  };
  const hasReadOnce = new Promise<void>((resolve) => {
    hasRead = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = false;
  bucket.snapshots.read = async (name, filter) => {
    const result = await read(name, filter);
    if (name === key && !blocked) {
      blocked = true;
      hasRead();
      await gate;
    }
    return result;
  };
  const old = saveObservedSnapshot(bucket, key, {}, [{ ...listing, rent: 2400 }], STREETEASY_LIVE.id, next.toISOString());
  await hasReadOnce;
  await saveObservedSnapshot(
    bucket,
    key,
    {},
    [{ ...listing, rent: 2300 }],
    STREETEASY_LIVE.id,
    new Date(next.getTime() + 1000).toISOString(),
  );
  release();
  await expect(old).rejects.toThrow(/changed during refresh/);
  const winner = await storedDirectRentals(bucket, STREETEASY_LIVE);
  expect(required(winner).listings[0].rent).toBe(2300);
  expect(required(required(winner).listings[0].priceHistory).observations.some((o) => o.rent === 2400)).toBe(false);
});
