import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { handleApi } from './fixtures/api.ts';
import { search } from '../server/search.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { refreshSources, storedDirectRentals } from '../server/refresh.ts';
import { COMPASS_LIVE, parseCompassPage } from '../server/sources/compass.ts';
import { assignedJson, loadPublicPages, deduplicatePublicRentals } from '../server/sources/public-rentals.ts';
import { parseApartmentListPage } from '../server/sources/apartmentlist.ts';
import { parseRedfinPage } from '../server/sources/redfin.ts';
import { normalizeListing } from '../src/listings.ts';
import { readJson } from './fixtures/json.ts';
import type { ApiConfig, ConfigSource, RefreshInfo } from '../src/api-client.ts';
import { parseFilters } from '../src/search.ts';

const at = new Date(Date.now() - 10_000);
const source = { id: 'compass', name: 'Compass', kind: 'feed' };
const row = (id: number, unit: string, rent = 2500) =>
  normalizeListing(
    {
      id: String(id),
      address: '10 Example Street',
      unit,
      city: 'Manhattan',
      state: 'NY',
      zip: '10001',
      bedrooms: 1,
      rent,
      status: 'Active',
      updatedAt: at.toISOString(),
      latitude: 40.75,
      longitude: -73.99,
      url: `https://www.compass.com/homedetails/example-NY-10001/${id}_lid/`,
    },
    source,
  )!;

test('every implemented rental provider is visible and resyncable before its first fetch', async () => {
  const result = await readJson<ApiConfig>(handleApi(new Request('https://app.test/api/config'), { BUCKET: createMemoryBucket() }));
  for (const id of ['zillow', 'compass', 'renthop', 'realtor', 'redfin', 'apartmentlist', 'cityrealty']) {
    expect(result.sources.some((source) => source.id === id)).toBeTruthy();
    expect(result.sourceCatalog?.find((source) => source.id === id + '-live')?.resyncable).toBe(true);
  }
});

test('new sources show that they need a feed and a paused StreetEasy cannot be refreshed', async () => {
  const env = { BUCKET: createMemoryBucket(), STREETEASY_SYNC_ENABLED: 'false' };
  const config = await readJson<ApiConfig>(handleApi(new Request('https://app.test/api/config'), env));
  for (const id of ['bhs', 'citysnap', 'craigslist', 'rebny-rls']) {
    const source = config.sourceCatalog?.find((entry) => entry.id === id);
    expect(source?.resyncable).toBe(false);
    expect(source?.coverage ?? '').toMatch(/feed.*required/i);
  }
  expect(config.sourceCatalog?.find((entry) => entry.id === 'streeteasy-live')?.paused).toBe(true);
  const response = await handleApi(
    new Request('https://app.test/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'now', source: 'streeteasy-live' }),
    }),
    env,
    {
      fetcher: () => {
        throw new Error('A paused source must not be fetched.');
      },
    },
  );
  expect(response.status).toBe(422);
});

test('an approved RESO feed imports paginated active rentals and skips rows with display restrictions', async () => {
  const host = 'https://licensed-listings.example.test';
  const url = host + '/odata/Property?$count=true';
  const env = {
    BUCKET: createMemoryBucket(),
    FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'rebny-rls', url, format: 'reso-web-api', token: 'test-feed-token' }]),
  };
  const listing = {
    ListingKey: 'lease-1',
    StandardStatus: 'Active',
    PropertyType: 'Residential Lease',
    StreetNumber: '10',
    StreetName: 'Example',
    StreetSuffix: 'Street',
    UnitNumber: '2A',
    StateOrProvince: 'NY',
    City: 'Brooklyn',
    PostalCode: '11201',
    ListPrice: 2650,
    BedroomsTotal: 1,
    ListingURL: host + '/listings/lease-1',
  };
  const requests: string[] = [];
  const result = await refreshSources(env, {
    sourceId: 'rebny-rls',
    onDemand: true,
    fetcher: (input, options) => {
      requests.push(input);
      expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-feed-token');
      expect(options?.redirect).toBe('manual');
      if (input === url)
        return Response.json({
          '@odata.count': 3,
          '@odata.nextLink': '?$skiptoken=next',
          value: [listing, { ...listing, ListingKey: 'hidden', InternetAddressDisplayYN: false }],
        });
      expect(input).toBe(host + '/odata/Property?$skiptoken=next');
      return Response.json({ value: [{ ...listing, ListingKey: 'closed', StandardStatus: 'Closed' }] });
    },
  });
  const saved = result.sources.find((source) => source.id === 'rebny-rls');
  expect(saved?.status).toBe('updated');
  expect(saved?.listingCount).toBe(1);
  expect(saved?.total).toBe(3);
  expect(requests.length).toBe(2);
  const searched = await search(parseFilters({ source: 'rebny-rls', region: 'nyc', liveOnly: true }), env);
  expect(searched.total).toBe(1);
  expect(searched.matches[0]?.rent).toBe(2650);
  expect(searched.matches[0]?.sources[0]?.url).toBe(listing.ListingURL);
  // The App Store app's official-only search keeps authorized feeds.
  expect((await search(parseFilters({ source: 'rebny-rls', region: 'nyc', liveOnly: true, officialOnly: true }), env)).total).toBe(1);
});

test('an official-only search leaves out listings read from listing sites and says so', async () => {
  const env = { BUCKET: createMemoryBucket() };
  await refreshSources(env, {
    sourceId: COMPASS_LIVE.id,
    now: at,
    imports: { [COMPASS_LIVE.id]: { listings: [row(1, 'A'), row(2, 'B'), row(3, 'C')], pages: 3 } },
  });
  expect((await search(parseFilters({ liveOnly: true, includeCached: true }), env)).total).toBe(3);
  const official = await search(parseFilters({ liveOnly: true, includeCached: true, officialOnly: true }), env);
  expect(official.total).toBe(0);
  expect(official.notices).toContain('This app shows official feeds and open data. Browse listing websites from their links.');
});

test('Compass accepts script wrapper whitespace and parses JSON strings containing closing braces safely', () => {
  const state = {
    sharedReactAppProps: {
      initialResults: {
        lolResults: {
          data: [
            {
              listing: {
                pageLink: '/homedetails/example-NY-10001/1_lid/',
                subtitles: ['10 Example Street, Unit 1', 'Chelsea'],
                status: 0,
                title: '$2,500',
                location: { latitude: 40.75, longitude: -73.99 },
                subStats: [{ titleLabel: 'Bedrooms', subtitle: '1' }],
              },
            },
            {
              listing: {
                pageLink: '/homedetails/example-NY-10001/2_lid/',
                subtitles: ['12 Example Street, Unit 2', 'Chelsea'],
                status: 0,
                title: '$3,100',
                location: { latitude: 40.75, longitude: -73.99 },
                subStats: [{ titleLabel: 'Bedrooms', subtitle: '2' }],
                badges: { cornerBadges: [{ displayText: 'Listed By Compass' }] },
                footer: [{ data: { text: { content: 'Listing Courtesy of Elsewhere Realty' } } }],
              },
            },
            {
              listing: {
                pageLink: '/homedetails/example-NY-10001/3_lid/',
                subtitles: ['14 Example Street, Unit 3', 'Chelsea'],
                status: 1,
                title: '$2,900',
                location: { latitude: 40.75, longitude: -73.99 },
              },
            },
          ],
        },
      },
    },
    harmless: 'text with } and " quotes',
  };
  const html = '<script> (function(global) {\n global.uc = ' + JSON.stringify(state) + '; })(this); </script>';
  expect(assignedJson(html, /global\.uc\s*=\s*(?=\{)/)).toStrictEqual(state);
  const compass = parseCompassPage(html, { city: 'New York', state: 'NY', region: 'nyc' }, at.toISOString());
  // The off-market listing is left out; the one Compass lists itself is credited to Compass.
  expect(compass.map(({ company }) => company)).toEqual(['', 'Compass']);
  expect(assignedJson('<script>global.uc = {', /global\.uc\s*=\s*(?=\{)/)).toBeNull();
});

test('one failed public page keeps successful pages and identifies the missing portion', async () => {
  const result = await loadPublicPages(
    source,
    [1, 2, 3].map((page) => ({ url: `https://provider.test/${page}` })),
    (_html, page) => [row(Number(page.url.slice(-1)), page.url.slice(-1))],
    async (url) =>
      url.endsWith('/2') ? new Response('', { status: 429 }) : new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }),
  );
  expect(result.pages).toBe(2);
  expect(result.listings.length).toBe(2);
  expect(result.partial).toBe(true);
  expect(result.requestedPages).toBe(3);
  expect(result.failedPages).toBe(1);
});

test('partial refresh keeps older units dated and cached, and a complete refresh replaces them', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const initial = { listings: [row(1, 'A'), row(2, 'B'), row(3, 'C')], pages: 3 };
  await refreshSources(env, { sourceId: COMPASS_LIVE.id, now: at, imports: { [COMPASS_LIVE.id]: initial } });
  const later = new Date(at.getTime() + 1000);
  const result = await refreshSources(env, {
    sourceId: COMPASS_LIVE.id,
    now: later,
    imports: {
      [COMPASS_LIVE.id]: { listings: [row(1, 'A', 2400), row(2, 'B')], pages: 2, partial: true, requestedPages: 3, failedPages: 1 },
    },
  });
  expect(result.sources.find((item) => item.id === COMPASS_LIVE.id)?.partial).toBe(true);
  const saved = (await storedDirectRentals(env.BUCKET, COMPASS_LIVE))!;
  expect(saved.listings.length).toBe(3);
  const old = saved.listings.find((item) => item.unit === 'C')!;
  expect(old.kind).toBe('cached');
  expect(old.checkedAt).toBe(at.toISOString());
  expect((await search(parseFilters({ liveOnly: true }), env)).total).toBe(2);
  const visible = await search(parseFilters({ liveOnly: true, includeCached: true, includeMap: true }), env);
  expect(visible.total).toBe(3);
  expect(visible.inventoryExpiresAt).toBeUndefined();
  expect(visible.mapPoints?.length).toBe(3);
  await refreshSources(env, {
    sourceId: COMPASS_LIVE.id,
    now: new Date(at.getTime() + 2000),
    imports: { [COMPASS_LIVE.id]: { listings: [row(1, 'A')], pages: 3 } },
  });
  expect((await search(parseFilters({ liveOnly: true, includeCached: true }), env)).total).toBe(1);
});

test('Apartment List imports identified available units without collapsing units sharing a property URL', () => {
  const payload = [
    'a:' + JSON.stringify({ rental_id: 'p1', slug: '/ny/new-york/example' }),
    // A flight line that is not JSON is skipped.
    'z:{not json',
    'b:' +
      JSON.stringify({
        status: 'success',
        data: {
          p1: [
            { unit_rental_id: 'p1-A', unitTitle: 'Unit A', unitType: '1 Bed', price: 2500, availableNow: true },
            { unit_rental_id: 'p1-B', unitTitle: 'Unit B', unitType: 'Studio', price: 2200, availableNow: true },
            { unit_rental_id: 'p1-C', unitTitle: 'Unit C', unitType: '1 Bed', price: 2400, availableNow: false },
          ],
        },
      }),
  ].join('\n');
  const html = `<a href="/ny/new-york/example">Example</a><address>10 Example Street, New York City, NY 10001</address><script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
  const listings = parseApartmentListPage(html, {}, at.toISOString());
  expect(listings.map((item) => item.unit)).toStrictEqual(['A', 'B']);
  expect(deduplicatePublicRentals([...listings, ...listings]).length).toBe(2);
});

test('Redfin excludes communities, rent ranges and inactive rentals', () => {
  const home = {
    homeData: {
      propertyType: 4,
      url: '/NY/New-York/Example/unit-2/home/1',
      addressInfo: {
        formattedStreetLine: '10 Example Street #2',
        unitNumber: '#2',
        zip: '10001',
        centroid: { centroid: { latitude: 40.75, longitude: -73.99 } },
      },
    },
    rentalExtension: {
      rentalId: 'one',
      status: 1,
      numAvailableUnits: 1,
      bedRange: { min: 1, max: 1 },
      rentPriceRange: { min: 2500, max: 2500 },
    },
  };
  const html = (homes: unknown[]) =>
    '<script>root.__reactServerState.InitialContext = ' +
    JSON.stringify({
      'ReactServerAgent.cache': {
        dataCache: {
          '/stingray/api/v1/search/rentals?includeKeyFacts=true': { res: { text: JSON.stringify({ homes }) } },
        },
      },
    }) +
    ';</script>';
  expect(parseRedfinPage(html([home]), {}, at.toISOString()).length).toBe(1);
  for (const changes of [{ status: 2 }, { numAvailableUnits: 20 }, { rentPriceRange: { min: 2000, max: 3000 } }]) {
    expect(
      parseRedfinPage(html([{ ...home, rentalExtension: { ...home.rentalExtension, ...changes } }]), {}, at.toISOString()).length,
    ).toBe(0);
  }
});

test('Compass reads rendered rental cards and skips coming-soon cards when embedded data is absent', () => {
  const card = (id: number, badge: string) => `
    <div data-testid="cx-react-listingCard">
      <span class="cx-react-listingBadge">${badge}</span>
      <p data-testid="cx-react-listingCard-title">$2,500</p>
      <dd><span class="cx-screenReaderOnly">1</span><span aria-hidden="true">1</span></dd><dt><span class="cx-screenReaderOnly">Bedrooms</span></dt>
      <a data-testid="cx-react-listingCard-subtitlesAnchor" href="/homedetails/example-NY-10001/${id}_lid/">
        <p>10 Example Street, Unit ${id}</p><p>Chelsea</p>
      </a>
    </div>`;
  const market = { city: 'New York', state: 'NY', region: 'nyc' };
  const html =
    '<link rel="canonical" href="https://www.compass.com/for-rent/new-york-ny/">' + card(1, 'Listed By Compass') + card(2, 'Coming Soon');
  const listings = parseCompassPage(html, market, at.toISOString());
  expect(listings.map(({ id, bedrooms, rent }) => ({ id, bedrooms, rent }))).toStrictEqual([{ id: 'compass:1', bedrooms: 1, rent: 2500 }]);
  expect(() => parseCompassPage(html.replace('/for-rent/', '/for-sale/'), market, at.toISOString())).toThrow(/recognized rental page/);
});

test('the existing StreetEasy resync checks the configured feed, preserves inventory after a bad count, and uses the StreetEasy filter', async () => {
  const feed = { id: 'streeteasy', url: 'https://partner.test/rentals', token: 'fixture-token' };
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket, FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const listing = {
    id: '1234',
    url: 'https://streeteasy.com/rental/1234',
    address: '10 Example Street',
    unit: '1',
    zip: '10001',
    city: 'Manhattan',
    state: 'NY',
    bedrooms: 1,
    rent: 2500,
    status: 'Active',
  };
  const run = async (total: number) =>
    handleApi(
      new Request('https://app.test/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ check: 'now', source: 'streeteasy-live' }),
      }),
      env,
      {
        fetcher: async (url, options) => {
          expect(url).toBe(feed.url);
          expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer ' + feed.token);
          return Response.json({ listings: [listing], total });
        },
      },
    );
  const updated = await readJson<RefreshInfo>(run(1));
  expect(updated.sources.find(({ id }) => id === 'streeteasy-live')?.transport).toBe('partner-feed');
  const results = await search(parseFilters({ source: 'streeteasy', liveOnly: true }), env);
  expect(results.matches[0]?.sources[0].url).toBe(listing.url);
  expect(results.sources.filter(({ id }) => id === 'streeteasy').length).toBe(1);
  const failed = await readJson<RefreshInfo>(run(2));
  expect(failed.sources.find(({ id }) => id === 'streeteasy-live')?.status).toBe('failed');
  const cached = await search(parseFilters({ source: 'streeteasy', liveOnly: true, includeCached: true }), env);
  expect(cached.matches[0]?.sources[0].url).toBe(listing.url);
  expect(cached.matches[0]?.kind).toBe('cached');
});

test('StreetEasy resync can read the public active search as a bounded sample', async () => {
  const url = 'https://streeteasy.com/for-rent/nyc';
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket, STREETEASY_PUBLIC_SEARCH: 'true' };
  const node = {
    id: '12',
    status: 'ACTIVE',
    urlPath: '/rental/12',
    zipCode: '10001',
    street: '10 Example Street',
    unit: '#12',
    bedroomCount: 1,
    price: 2500,
    geoPoint: { latitude: 40.75, longitude: -73.99 },
  };
  const data = {
    listingData: {
      search: { criteria: 'area:1|status:open' },
      totalCount: 15000,
      edges: [{ node }, { node: { ...node, id: '13', urlPath: '/rental/13', status: 'RENTED' } }],
    },
  };
  const payload = 'e:' + JSON.stringify(data);
  const middle = Math.floor(payload.length / 2);
  const html =
    '<!-- <script>self.__next_f.push(invalid)</script> -->' +
    '<script data-test="bootstrap">  self.__next_f.push(' +
    JSON.stringify([1, payload.slice(0, middle)]) +
    '); </script>' +
    '<script>self.__next_f.push(' +
    JSON.stringify([1, payload.slice(middle)]) +
    ')</script>';
  const response = await handleApi(
    new Request('https://app.test/api/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'now', source: 'streeteasy-live' }),
    }),
    env,
    {
      fetcher: (requested, options) => {
        expect(requested).toBe(url);
        expect(options?.method).toBeUndefined();
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      },
    },
  );
  const { sources } = await readJson<RefreshInfo>(response);
  const status = required(sources.find(({ id }) => id === 'streeteasy-live'));
  expect(status.transport).toBe('public-search');
  expect(status.total).toBe(15000);
  expect(status.listingCount).toBe(1);
  expect(status.pages).toBe(1);
  const results = await search(parseFilters({ source: 'streeteasy', liveOnly: true }), env);
  expect(results.total).toBe(1);
  expect(results.matches[0]?.sources[0].url).toBe('https://streeteasy.com/rental/12');
  expect(results.notices.some((notice) => notice.includes('first page of the public NYC and New Jersey rental search'))).toBeTruthy();
});

test('public StreetEasy denial names the failing route and honors the provider retry window', async () => {
  const env = { BUCKET: createMemoryBucket(), STREETEASY_PUBLIC_SEARCH: 'true' };
  let calls = 0;
  const refresh = () =>
    refreshSources(env, {
      sourceId: 'streeteasy-live',
      onDemand: true,
      fetcher: async (url) => {
        calls++;
        expect(url).toBe('https://streeteasy.com/for-rent/nyc');
        return new Response('<title>Access Denied</title>private upstream details', {
          status: 403,
          headers: { 'Retry-After': '1800' },
        });
      },
    });

  const startedAt = Date.now();
  const result = await refresh();
  const denied = result.sources.find(({ id }) => id === 'streeteasy-live');
  expect(denied?.status).toBe('failed');
  expect(denied?.error).toBe('StreetEasy public rentals page returned HTTP 403 (upstream access-denied page).');
  expect(Date.parse(required(required(denied).retryAt))).toBeGreaterThanOrEqual(startedAt + 30 * 60_000);
  expect(JSON.stringify(result)).not.toMatch(/private upstream details/);
  expect((await refresh()).state).toBe('already_checked');
  expect(calls).toBe(1);
});

test('a complete StreetEasy export syncs all rows in one request and preserves the previous export on invalid input', async () => {
  const url = 'https://feed.example.test/complete.json';
  const env = {
    BUCKET: createMemoryBucket(),
    FREE_PARTNER_FEEDS_JSON: JSON.stringify([
      { id: 'streeteasy', format: 'streeteasy-complete-export-v1', url, token: 'export-test-secret' },
    ]),
  };
  const source = { id: 'streeteasy-live' };
  const generatedAt = new Date(at.getTime() - 60_000).toISOString();
  const listings = Array.from({ length: 601 }, (_, i) => ({
    id: String(i + 1),
    status: 'Active',
    listingUrl: 'https://streeteasy.com/rental/' + (i + 1),
    address: '10 Example Street',
    unit: String(i + 1),
    city: 'Manhattan',
    state: 'NY',
    zip: '10001',
    bedrooms: 1,
    rent: 2500,
  }));
  const complete = {
    schema: 'streeteasy-complete-export-v1',
    scope: 'all-markets',
    complete: true,
    generatedAt,
    total: listings.length,
    listings,
  };
  let called = 0;
  const run = (overrides: Record<string, unknown> = {}, now = at) =>
    refreshSources(env, {
      sourceId: source.id,
      now,
      onDemand: true,
      fetcher: (requested, options) => {
        called++;
        expect(requested).toBe(url);
        expect(options?.redirect).toBe('manual');
        expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer export-test-secret');
        return Response.json({ ...complete, ...overrides });
      },
    });
  const first = await run();
  expect(called).toBe(1);
  expect(first.sources[0].status).toBe('updated');
  expect(first.sources[0].updatedAt).toBe(generatedAt);
  expect(first.sources[0].listingCount).toBe(601);
  expect<string | undefined>(first.sources[0].requestTransport).toBe(complete.schema);
  const result = await search(parseFilters({ liveOnly: true, source: 'streeteasy' }), env);
  expect(result.total).toBe(601);
  const config = await (await handleApi(new Request('https://app.test/api/config'), env)).text();
  const streetEasy = (JSON.parse(config) as { sources: (ConfigSource & { coverage?: string })[] }).sources.find(
    ({ id }) => id === 'streeteasy',
  );
  expect(streetEasy?.coverage).toBe('provider-supplied complete active StreetEasy export');
  expect(streetEasy?.sample).toBe(false);
  expect(!config.includes('export-test-secret')).toBeTruthy();
  expect(!config.includes(url)).toBeTruthy();
  for (const invalid of [
    { total: 602 },
    { next: '/page/2' },
    { scope: 'nyc-only' },
    { complete: false },
    { generatedAt: new Date(at.getTime() + 10_000).toISOString() },
    { generatedAt: new Date(at.getTime() - 13 * 60 * 60_000).toISOString() },
    { generatedAt: new Date(at.getTime() - 120_000).toISOString() },
    { listings: [listings[0], listings[0]], total: 2 },
    { listings: [{ ...listings[0], status: 'Rented' }], total: 1 },
  ]) {
    const failed = await run(invalid);
    expect(failed.sources[0].status).toBe('failed');
    expect(failed.sources[0].updatedAt).toBe(generatedAt);
    expect((await storedDirectRentals(env.BUCKET, source))?.listings.length).toBe(601);
  }
  const second = await run({ generatedAt: at.toISOString(), total: 1, listings: [listings[600]] });
  expect(second.sources[0].listingCount).toBe(1);
  expect((await storedDirectRentals(env.BUCKET, source))?.listings[0].unit).toBe('601');
});
