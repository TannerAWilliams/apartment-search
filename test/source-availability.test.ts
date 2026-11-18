import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { handleApi, search } from '../server/api.ts';
import { createMemoryBucket } from '../server/memory-bucket.ts';
import { refreshSources, refreshStatus, storedDirectRentals } from '../server/refresh.ts';
import { COMPASS_LIVE, parseCompassPage } from '../server/compass.ts';
import { assignedJson, loadPublicPages, deduplicatePublicRentals } from '../server/public-rentals.ts';
import { parseApartmentListPage } from '../server/apartmentlist.ts';
import { parseRedfinPage } from '../server/redfin.ts';
import { normalizeListing } from '../src/listings.ts';

const at = new Date(Date.now() - 10_000);
const source = { id: 'compass', name: 'Compass', kind: 'feed' };
const row = (id: number, unit: string, rent = 2500) => normalizeListing({ id: String(id),
  address: '10 Example Street', unit, city: 'Manhattan', state: 'NY', zip: '10001',
  bedrooms: 1, rent, status: 'Active', updatedAt: at.toISOString(),
  latitude: 40.75, longitude: -73.99,
  url: `https://www.compass.com/homedetails/example-NY-10001/${id}_lid/`,
}, source)!;

async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  throw new Error('Expected refresh progress was not persisted.');
}

test('every implemented rental provider is visible and resyncable before its first fetch', async () => {
  const result = await (await handleApi(new Request('https://app.test/api/config'), { BUCKET: createMemoryBucket() })).json();
  for (const id of ['zillow', 'compass', 'renthop', 'realtor', 'redfin', 'apartmentlist', 'cityrealty']) {
    assert.ok(result.sources.some((source: { id: string }) => source.id === id));
    assert.equal(result.sourceCatalog.find((source: { id: string }) => source.id === id + '-live')?.resyncable, true);
  }
});

test('new sources show that they need a feed and a paused StreetEasy cannot be refreshed', async () => {
  const env = { BUCKET: createMemoryBucket(), STREETEASY_SYNC_ENABLED: 'false' };
  const config = await (await handleApi(new Request('https://app.test/api/config'), env)).json();
  for (const id of ['bhs', 'citysnap', 'craigslist', 'rebny-rls']) {
    const source = config.sourceCatalog.find((entry: { id: string }) => entry.id === id);
    assert.equal(source?.resyncable, false);
    assert.match(source?.coverage, /feed.*required/i);
  }
  assert.equal(config.sourceCatalog.find((entry: { id: string }) => entry.id === 'streeteasy-live')?.paused, true);
  const response = await handleApi(new Request('https://app.test/api/refresh', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: 'now', source: 'streeteasy-live' }) }), env, {
    fetcher: () => { throw new Error('A paused source must not be fetched.'); },
  });
  assert.equal(response.status, 422);
});

test('an approved RESO feed imports paginated active rentals and skips rows with display restrictions', async () => {
  const host = 'https://licensed-listings.example.test';
  const url = host + '/odata/Property?$count=true';
  const env = { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([
    { id: 'rebny-rls', url, format: 'reso-web-api', token: 'test-feed-token' },
  ]) };
  const listing = { ListingKey: 'lease-1', StandardStatus: 'Active', PropertyType: 'Residential Lease',
    StreetNumber: '10', StreetName: 'Example', StreetSuffix: 'Street', UnitNumber: '2A',
    StateOrProvince: 'NY', City: 'Brooklyn', PostalCode: '11201', ListPrice: 2650, BedroomsTotal: 1,
    ListingURL: host + '/listings/lease-1' };
  const requests: string[] = [];
  const result = await refreshSources(env, { sourceId: 'rebny-rls', onDemand: true, fetcher: (input, options) => {
    requests.push(input);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer test-feed-token');
    assert.equal(options?.redirect, 'error');
    if (input === url) return Response.json({
      '@odata.count': 3, '@odata.nextLink': '?$skiptoken=next',
      value: [listing, { ...listing, ListingKey: 'hidden', InternetAddressDisplayYN: false }],
    });
    assert.equal(input, host + '/odata/Property?$skiptoken=next');
    return Response.json({ value: [{ ...listing, ListingKey: 'closed', StandardStatus: 'Closed' }] });
  } });
  const saved = result.sources.find(source => source.id === 'rebny-rls');
  assert.equal(saved?.status, 'updated');
  assert.equal(saved?.listingCount, 1);
  assert.equal(saved?.total, 3);
  assert.equal(requests.length, 2);
  const searched = await search({ source: 'rebny-rls', region: 'nyc', liveOnly: true }, env);
  assert.equal(searched.total, 1);
  assert.equal(searched.matches[0]?.rent, 2650);
  assert.equal(searched.matches[0]?.sources[0]?.url, listing.ListingURL);
});

test('Compass accepts script wrapper whitespace and parses JSON strings containing closing braces safely', () => {
  const state = { sharedReactAppProps: { initialResults: { lolResults: { data: [{ listing: {
    pageLink: '/homedetails/example-NY-10001/1_lid/', subtitles: ['10 Example Street, Unit 1', 'Chelsea'],
    status: 0, title: '$2,500', location: { latitude: 40.75, longitude: -73.99 },
    subStats: [{ titleLabel: 'Bedrooms', subtitle: '1' }],
  } }] } } }, harmless: 'text with } and " quotes' };
  const html = '<script> (function(global) {\n global.uc = ' + JSON.stringify(state) + '; })(this); </script>';
  assert.deepEqual(assignedJson(html, /global\.uc\s*=\s*(?=\{)/), state);
  assert.equal(parseCompassPage(html, { city: 'New York', state: 'NY', region: 'nyc' }, at.toISOString()).length, 1);
  assert.equal(assignedJson('<script>global.uc = {', /global\.uc\s*=\s*(?=\{)/), null);
});

test('background refresh responds before relay preparation and publishes independent inventory while it waits', async () => {
  const bucket = createMemoryBucket();
  const feed = { id: 'partner', name: 'Partner', url: 'https://partner.test/rentals' };
  const env = { BUCKET: bucket, FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const response = await handleApi(new Request('https://app.test/api/refresh', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: 'now' }) }), env, {
    backgroundRefresh: true,
    prepareListingSources: async () => { await blocked; throw new Error('relay unavailable'); },
    fetcher: async (url) => url === feed.url ? Response.json({ listings: [{ id: '1',
      address: '10 Example Street', unit: '1A', city: 'Manhattan', state: 'NY', zip: '10001',
      bedrooms: 1, price: 2500, status: 'Active', listingUrl: 'https://partner.test/rentals/1',
    }] }) : new Response('', { status: 403 }),
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).checking, true);
  await until(async () => (await refreshStatus(bucket)).sources.some(item => item.id === feed.id && item.status === 'updated'));
  assert.equal((await search({ liveOnly: true }, env)).total, 1);
  assert.equal((await refreshStatus(bucket)).checking, true);
  release();
  await until(async () => !(await refreshStatus(bucket)).checking);
  const status = await refreshStatus(bucket);
  assert.equal(status.sources.find(item => item.id === 'streeteasy-live')?.status, 'failed');
  assert.equal(status.sources.find(item => item.id === feed.id)?.status, 'updated');
});

test('one failed public page keeps successful pages and identifies the missing portion', async () => {
  const result = await loadPublicPages(source, [1, 2, 3].map(page => ({ url: `https://provider.test/${page}` })),
    (_html, page) => [row(Number(page.url.slice(-1)), page.url.slice(-1))],
    async url => url.endsWith('/2') ? new Response('', { status: 429 }) : new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
  assert.equal(result.pages, 2);
  assert.equal(result.listings.length, 2);
  assert.equal(result.partial, true);
  assert.equal(result.requestedPages, 3);
  assert.equal(result.failedPages, 1);
});

test('partial refresh keeps older units dated and cached, and a complete refresh replaces them', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const initial = { listings: [row(1, 'A'), row(2, 'B'), row(3, 'C')], pages: 3 };
  await refreshSources(env, { sourceId: COMPASS_LIVE.id, now: at, imports: { [COMPASS_LIVE.id]: initial } });
  const later = new Date(at.getTime() + 1000);
  const result = await refreshSources(env, { sourceId: COMPASS_LIVE.id, now: later,
    imports: { [COMPASS_LIVE.id]: { listings: [row(1, 'A', 2400), row(2, 'B')], pages: 2, partial: true, requestedPages: 3, failedPages: 1 } } });
  assert.equal(result.sources.find(item => item.id === COMPASS_LIVE.id)?.partial, true);
  const saved = (await storedDirectRentals(env.BUCKET, COMPASS_LIVE))!;
  assert.equal(saved.listings.length, 3);
  const old = saved.listings.find(item => item.unit === 'C')!;
  assert.equal(old.kind, 'cached');
  assert.equal(old.checkedAt, at.toISOString());
  assert.equal((await search({ liveOnly: true }, env)).total, 2);
  const visible = await search({ liveOnly: true, includeCached: true, includeMap: true }, env);
  assert.equal(visible.total, 3);
  assert.equal(visible.inventoryExpiresAt, undefined);
  assert.equal(visible.mapPoints?.length, 3);
  await refreshSources(env, { sourceId: COMPASS_LIVE.id, now: new Date(at.getTime() + 2000),
    imports: { [COMPASS_LIVE.id]: { listings: [row(1, 'A')], pages: 3 } } });
  assert.equal((await search({ liveOnly: true, includeCached: true }, env)).total, 1);
});

test('Apartment List imports identified available units without collapsing units sharing a property URL', () => {
  const payload = [
    'a:' + JSON.stringify({ rental_id: 'p1', slug: '/ny/new-york/example' }),
    'b:' + JSON.stringify({ status: 'success', data: { p1: [
      { unit_rental_id: 'p1-A', unitTitle: 'Unit A', unitType: '1 Bed', price: 2500, availableNow: true },
      { unit_rental_id: 'p1-B', unitTitle: 'Unit B', unitType: 'Studio', price: 2200, availableNow: true },
      { unit_rental_id: 'p1-C', unitTitle: 'Unit C', unitType: '1 Bed', price: 2400, availableNow: false },
    ] } }),
  ].join('\n');
  const html = `<a href="/ny/new-york/example">Example</a><address>10 Example Street, New York City, NY 10001</address><script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
  const listings = parseApartmentListPage(html, {}, at.toISOString());
  assert.deepEqual(listings.map(item => item.unit), ['A', 'B']);
  assert.equal(deduplicatePublicRentals([...listings, ...listings]).length, 2);
});

test('Redfin excludes communities, rent ranges and inactive rentals', () => {
  const home = { homeData: { propertyType: 4, url: '/NY/New-York/Example/unit-2/home/1',
    addressInfo: { formattedStreetLine: '10 Example Street #2', unitNumber: '#2', zip: '10001', centroid: { centroid: { latitude: 40.75, longitude: -73.99 } } } },
    rentalExtension: { rentalId: 'one', status: 1, numAvailableUnits: 1, bedRange: { min: 1, max: 1 }, rentPriceRange: { min: 2500, max: 2500 } } };
  const html = (homes: any[]) => '<script>root.__reactServerState.InitialContext = ' + JSON.stringify({ 'ReactServerAgent.cache': { dataCache: {
    '/stingray/api/v1/search/rentals?includeKeyFacts=true': { res: { text: JSON.stringify({ homes }) } },
  } } }) + ';</script>';
  assert.equal(parseRedfinPage(html([home]), {}, at.toISOString()).length, 1);
  for (const changes of [{ status: 2 }, { numAvailableUnits: 20 }, { rentPriceRange: { min: 2000, max: 3000 } }]) {
    assert.equal(parseRedfinPage(html([{ ...home, rentalExtension: { ...home.rentalExtension, ...changes } }]), {}, at.toISOString()).length, 0);
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
  const html = '<link rel="canonical" href="https://www.compass.com/for-rent/new-york-ny/">' + card(1, 'Listed By Compass') + card(2, 'Coming Soon');
  const listings = parseCompassPage(html, market, at.toISOString());
  assert.deepEqual(listings.map(({ id, bedrooms, rent }) => ({ id, bedrooms, rent })), [
    { id: 'compass:1', bedrooms: 1, rent: 2500 },
  ]);
  assert.throws(() => parseCompassPage(html.replace('/for-rent/', '/for-sale/'), market, at.toISOString()), /recognized rental page/);
});

test('the existing StreetEasy resync checks the configured feed, preserves inventory after a bad count, and uses the StreetEasy filter', async () => {
  const feed = { id: 'streeteasy', url: 'https://partner.test/rentals', token: 'fixture-token' };
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket, FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) };
  const listing = {
    id: '1234', url: 'https://streeteasy.com/rental/1234', address: '10 Example Street',
    unit: '1', zip: '10001', city: 'Manhattan', state: 'NY', bedrooms: 1, rent: 2500, status: 'Active',
  };
  const run = async (total: number) => handleApi(new Request('https://app.test/api/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ check: 'now', source: 'streeteasy-live' }),
  }), env, { fetcher: async (url, options) => {
    assert.equal(url, feed.url);
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ' + feed.token);
    return Response.json({ listings: [listing], total });
  }, prepareListingSources: async () => { throw new Error('Partner feed should not require the relay.'); } });
  const updated = await (await run(1)).json();
  assert.equal(updated.sources.find(({ id }: { id: string }) => id === 'streeteasy-live')?.transport, 'partner-feed');
  const results = await search({ source: 'streeteasy', liveOnly: true }, env);
  assert.equal(results.matches[0]?.sources[0].url, listing.url);
  assert.equal(results.sources.filter(({ id }) => id === 'streeteasy').length, 1);
  const failed = await (await run(2)).json();
  assert.equal(failed.sources.find(({ id }: { id: string }) => id === 'streeteasy-live')?.status, 'failed');
  const cached = await search({ source: 'streeteasy', liveOnly: true, includeCached: true }, env);
  assert.equal(cached.matches[0]?.sources[0].url, listing.url);
  assert.equal(cached.matches[0]?.kind, 'cached');
});

test('StreetEasy resync can read the public active search as a bounded sample', async () => {
  const url = 'https://streeteasy.com/for-rent/nyc';
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket, STREETEASY_PUBLIC_SEARCH: 'true' };
  const node = { id: '12', status: 'ACTIVE', urlPath: '/rental/12', zipCode: '10001', street: '10 Example Street',
    unit: '#12', bedroomCount: 1, price: 2500, geoPoint: { latitude: 40.75, longitude: -73.99 } };
  const data = { listingData: { search: { criteria: 'area:1|status:open' }, totalCount: 15000,
    edges: [{ node }, { node: { ...node, id: '13', urlPath: '/rental/13', status: 'RENTED' } }] } };
  const payload = 'e:' + JSON.stringify(data);
  const middle = Math.floor(payload.length / 2);
  const html = '<!-- <script>self.__next_f.push(invalid)</script> -->' +
    '<script data-test="bootstrap">  self.__next_f.push(' + JSON.stringify([1, payload.slice(0, middle)]) + '); </script>' +
    '<script>self.__next_f.push(' + JSON.stringify([1, payload.slice(middle)]) + ')</script>';
  const response = await handleApi(new Request('https://app.test/api/refresh', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ check: 'now', source: 'streeteasy-live' }) }), env, {
    fetcher: (requested, options) => {
      assert.equal(requested, url);
      assert.equal(options?.method, undefined);
      return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    },
    prepareListingSources: async () => { throw new Error('Public search should not use the API relay.'); },
  });
  const { sources } = await response.json();
  const status = sources.find(({ id }: { id: string }) => id === 'streeteasy-live');
  assert.equal(status.transport, 'public-search');
  assert.equal(status.total, 15000);
  assert.equal(status.listingCount, 1);
  assert.equal(status.pages, 1);
  const results = await search({ source: 'streeteasy', liveOnly: true }, env);
  assert.equal(results.total, 1);
  assert.equal(results.matches[0]?.sources[0].url, 'https://streeteasy.com/rental/12');
  assert.ok(results.notices.some(notice => notice.includes('first page of the public NYC and New Jersey rental search')));
});

test('public StreetEasy denial names the failing route and honors the provider retry window', async () => {
  const env = { BUCKET: createMemoryBucket(), STREETEASY_PUBLIC_SEARCH: 'true' };
  let calls = 0;
  const refresh = () => refreshSources(env, {
    sourceId: 'streeteasy-live', onDemand: true, forceRefresh: true,
    fetcher: async (url) => {
      calls++;
      assert.equal(url, 'https://streeteasy.com/for-rent/nyc');
      return new Response('<title>Access Denied</title>private upstream details', {
        status: 403, headers: { 'Retry-After': '1800' },
      });
    },
  });

  const startedAt = Date.now();
  const result = await refresh();
  const denied = result.sources.find(({ id }) => id === 'streeteasy-live');
  assert.equal(denied?.status, 'failed');
  assert.equal(denied?.error, 'StreetEasy public rentals page returned HTTP 403 (upstream access-denied page).');
  assert.ok(Date.parse(denied.retryAt!) >= startedAt + 30 * 60_000);
  assert.doesNotMatch(JSON.stringify(result), /private upstream details/);
  assert.equal((await refresh()).state, 'already_checked');
  assert.equal(calls, 1);
});

test('a complete StreetEasy export syncs all rows in one request and preserves the previous export on invalid input', async () => {
  const url = 'https://feed.example.test/complete.json';
  const env = { BUCKET: createMemoryBucket(), FREE_PARTNER_FEEDS_JSON: JSON.stringify([
    { id: 'streeteasy', format: 'streeteasy-complete-export-v1', url, token: 'export-test-secret' },
  ]) };
  const source = { id: 'streeteasy-live' };
  const generatedAt = new Date(at.getTime() - 60_000).toISOString();
  const listings = Array.from({ length: 601 }, (_, i) => ({
    id: String(i + 1), status: 'Active', listingUrl: 'https://streeteasy.com/rental/' + (i + 1),
    address: '10 Example Street', unit: String(i + 1), city: 'Manhattan', state: 'NY',
    zip: '10001', bedrooms: 1, rent: 2500,
  }));
  const complete = {
    schema: 'streeteasy-complete-export-v1', scope: 'all-markets', complete: true,
    generatedAt, total: listings.length, listings,
  };
  let called = 0;
  const run = (overrides: Record<string, unknown> = {}, now = at) => refreshSources(env, {
    sourceId: source.id, now, onDemand: true,
    fetcher: (requested, options) => {
      called++;
      assert.equal(requested, url);
      assert.equal(options?.redirect, 'error');
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer export-test-secret');
      return Response.json({ ...complete, ...overrides });
    },
    prepareListingSources: async () => { throw new Error('Export must not use the StreetEasy relay.'); },
  });
  const first = await run();
  assert.equal(called, 1);
  assert.equal(first.sources[0].status, 'updated');
  assert.equal(first.sources[0].updatedAt, generatedAt);
  assert.equal(first.sources[0].listingCount, 601);
  assert.equal(first.sources[0].requestTransport, complete.schema);
  const result = await search({ liveOnly: true, source: 'streeteasy' }, env);
  assert.equal(result.total, 601);
  const config = await (await handleApi(new Request('https://app.test/api/config'), env)).text();
  const streetEasy = JSON.parse(config).sources.find(({ id }: { id: string }) => id === 'streeteasy');
  assert.equal(streetEasy?.coverage, 'provider-supplied complete active StreetEasy export');
  assert.equal(streetEasy?.sample, false);
  assert.ok(!config.includes('export-test-secret'));
  assert.ok(!config.includes(url));
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
    assert.equal(failed.sources[0].status, 'failed');
    assert.equal(failed.sources[0].updatedAt, generatedAt);
    assert.equal((await storedDirectRentals(env.BUCKET, source))?.listings.length, 601);
  }
  const second = await run({ generatedAt: at.toISOString(), total: 1, listings: [listings[600]] });
  assert.equal(second.sources[0].listingCount, 1);
  assert.equal((await storedDirectRentals(env.BUCKET, source))?.listings[0].unit, '601');
});
