import { required } from './test-values.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { parseFilters, DEFAULT_FILTERS, localWorkplace, directionsLink } from '../src/search.ts';
import { MARKETS, NYC_SEARCH_DEFAULT, REGIONS, marketsForSearch, regionOf, searchBorough } from '../src/regions.ts';
import { marketplaceAddressSearches, marketplaceIdForUrl, marketplaceLinks } from '../src/marketplaces.ts';
import { listingKey, mergeListings, normalizeListing, sourceLink } from '../src/listings.ts';
import { localSearch, marketSnapshot, median, rentAreas, snapshotSearch, SNAPSHOT_MONTH } from '../src/market.ts';
import { IMPORT_COLUMNS, parseListingImport } from '../src/import-listings.ts';
import { appConfig, handleApi, search } from '../server/api.ts';

const sample = {
  id: 'first', addressLine1: '12 Grove Street', addressLine2: 'Apt 2',
  city: 'Jersey City', state: 'NJ', zipCode: '07302', county: 'Hudson', neighborhood: 'Downtown',
  latitude: 40.72, longitude: -74.04, bedrooms: 1, price: 1800, status: 'Active',
};
const normalize = (row: Record<string, unknown>, id = 'zillow') => required(normalizeListing(row, { id, name: id, kind: 'feed' }));

test('the StreetEasy filter searches the whole snapshot before the result limit', () => {
  const result = snapshotSearch(parseFilters({ ...DEFAULT_FILTERS, source: 'streeteasy' }));
  assert.ok(result.total > result.matches.length);
  assert.ok(result.matches.every(({ sources }) => sources.some(({ id, url }) => id === 'streeteasy' && url)));
  assert.equal(result.sourceCounts.find(({ id }) => id === 'streeteasy').count, result.total);
  assert.equal(snapshotSearch(parseFilters({ ...DEFAULT_FILTERS, source: 'zillow' })).total, 0);
});

test('the map covers matching listings beyond the list cap and respects the source filter', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, source: 'streeteasy', includeMap: true });
  const result = snapshotSearch(filters);
  assert.equal(required(result.mapPoints).length, result.total);
  assert.ok(required(result.mapPoints).length > result.matches.length);
  assert.ok(required(result.mapPoints).every(({ name, url, latitude, longitude }) => name === 'StreetEasy' &&
    url.startsWith('https://streeteasy.com/') && Number.isFinite(latitude) && Number.isFinite(longitude)));
  assert.deepEqual(snapshotSearch({ ...filters, source: 'zillow' }).mapPoints, []);
  assert.equal(snapshotSearch({ ...filters, includeMap: false }).mapPoints, undefined);
});

test('recent, rent and distance sorting apply before the search caps the listing cards', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, includeMap: true });
  const work = localWorkplace(filters);
  const historic = Array.from({ length: 100 }, (_, index) => ({
    ...normalize({ ...sample, id: String(index) }),
    kind: 'snapshot',
  }));
  const near = normalize({ ...sample, id: 'near', price: 2600, ...work });
  const listings = [...historic, near];
  assert.ok(localSearch(listings, filters, work, 'mixed').matches.every(({ kind }) => kind === 'snapshot'));
  for (const sort of ['recent', 'distance']) {
    const result = localSearch(listings, parseFilters({ ...filters, sort }), work, 'mixed');
    assert.equal(result.matches[0].id, required(near).id);
    assert.equal(result.total, 101);
    assert.equal(required(result.mapPoints).length, 101);
  }
});

test('commute routing checks all matching origins before filtering, sorting, and mapping', async () => {
  const env = { FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'zillow', url: 'https://feed.example.test/zillow' }]),
    TRAVELTIME_APP_ID: 'demo-id', TRAVELTIME_API_KEY: 'demo-key' };
  const rows: (Omit<typeof sample, 'latitude'> & { latitude: number | null })[] = Array.from({ length: 105 }, (_, index) => ({
    ...sample, id: String(index), addressLine1: `${12 + index} Grove Street`,
    latitude: 40.72 + index / 100000, price: 1800 + index,
  }));
  rows.push({ ...sample, id: 'missing', addressLine1: '99 Main Street', latitude: null });
  const result = await search({ ...DEFAULT_FILTERS, maxTransitMinutes: 30, maxDrivingMinutes: 45, sort: 'transit', includeMap: true }, env,
    async (url: string, options?: RequestInit) => {
      if (url === 'https://feed.example.test/zillow') return Response.json(rows);
      assert.equal(url, 'https://api.traveltimeapp.com/v4/time-filter/fast');
      assert.equal(required(options).redirect, 'error');
      assert.equal(new Headers(required(options).headers).get('X-Application-Id'), 'demo-id');
      assert.equal(new Headers(required(options).headers).get('X-Api-Key'), 'demo-key');
      const body = JSON.parse(String(required(options).body));
      assert.equal(body.locations.length, 106);
      assert.deepEqual(body.locations.at(-1), { id: 'workplace', coords: { lat: 40.75874, lng: -73.97867 } });
      const routes: { id: string; transportation: { type: string }; arrival_location_id: string; arrival_time_period: string }[] = body.arrival_searches.many_to_one;
      assert.deepEqual(routes.map(({ transportation }) => transportation.type), ['public_transport', 'driving+ferry']);
      assert.ok(routes.every((route) => route.arrival_location_id === 'workplace' && route.arrival_time_period === 'weekday_morning'));
      const times: Record<string, number[]> = { transit: [1800, 1801, 1600, 1200], driving: [2700, 2300, 2701, 2000] };
      return Response.json({ results: routes.map(({ id }) => ({
        search_id: id, locations: ['0', '1', '2', '104'].map((locationId, index) =>
          ({ id: locationId, properties: { travel_time: times[id][index] } })),
      })) });
    });
  assert.equal(result.commute, true);
  assert.deepEqual(result.matches.map(({ id }) => id), ['zillow:104', 'zillow:0']);
  assert.deepEqual(required(result.mapPoints).map(({ transitSeconds, drivingSeconds }) => [transitSeconds, drivingSeconds]),
    [[1200, 2000], [1800, 2700]]);
});

test('a commute filter requires server credentials and reports an unavailable routing service', async () => {
  const response = await handleApi(new Request('https://search.example.test/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ maxDrivingMinutes: 45, routingCredentials: { appId: 'client-id', apiKey: 'client-key' } }),
  }), {}, { fetcher: () => assert.fail('No routing request is sent without credentials') });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).commuteError, true);
});

test('a routing outage preserves ordinary results but fails an explicitly filtered search', async () => {
  const env = { TRAVELTIME_APP_ID: 'demo-id', TRAVELTIME_API_KEY: 'demo-key' };
  const fetcher = async () => new Response(null, { status: 503 });
  const result = await search({ ...DEFAULT_FILTERS, includeCommute: true }, env, fetcher);
  assert.ok(result.total > 0);
  assert.match(required(result.commuteNotice), /couldn’t calculate routes/);
  await assert.rejects(search({ ...DEFAULT_FILTERS, maxTransitMinutes: 45 }, env, fetcher), /couldn’t calculate routes/);
});

test('a CSV keeps direct marketplace links on the same unit without marking them live', () => {
  const csv = IMPORT_COLUMNS + ',latitude,longitude\n' +
    'https://www.apartments.com/example/abc/,12 Grove Street,2,Jersey City,NJ,07302,1,2600,40.72,-74.04\n' +
    'https://www.zillow.com/homedetails/example/,12 Grove St,Apt 2,Jersey City,NJ,07302,1,2600,,';
  const listings = mergeListings(parseListingImport(csv));
  assert.equal(listings.length, 1);
  assert.equal(listings[0].zip, '07302');
  assert.equal(listings[0].kind, 'saved');
  assert.equal(listings[0].longitude, -74.04);
  assert.deepEqual(listings[0].sources.map(({ id }) => id), ['apartments', 'zillow']);
  assert.throws(() => parseListingImport(csv.replace('07302', '7302')), /line 2/);
  assert.throws(() => parseListingImport(csv.replace('40.72,-74.04', '40.72,')), /coordinates on line 2/);
});

test('studio, geography, budget, and distance are applied together to real observations', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, region: 'nj', bedrooms: '0', maxRent: '2500', maxMiles: '12' });
  const result = snapshotSearch(filters);
  assert.equal(result.mode, 'snapshot');
  assert.ok(result.total > 0);
  assert.ok(result.matches.every(({ state, rent, bedrooms, miles }) =>
    state === 'NJ' && rent <= 2500 && bedrooms === 0 && required(miles) <= 12));
  assert.ok(result.matches.every((listing, index, items) => index === 0 || items[index - 1].rent <= listing.rent));
  assert.equal(snapshotSearch({ ...filters, maxMiles: 0.1 }).total, 0);
  assert.throws(() => parseFilters({ zip: '9900' }), /five-digit ZIP/);
  assert.throws(() => localWorkplace(parseFilters({ workplace: 'custom', customWorkplace: '100, -73' })), /latitude/);
});

test('tri-state coverage includes Long Island ZIPs and Connecticut planning regions', () => {
  assert.equal(regionOf({ state: 'NY', zip: '11050', city: 'Port Washington' }), 'li');
  assert.equal(regionOf({ state: 'NY', zip: '11004' }), 'nyc');
  assert.equal(regionOf({ state: 'CT', county: 'Greater Bridgeport Planning Region' }), 'ct');
  assert.equal(regionOf({ state: 'NJ', county: 'Atlantic County' }), null);
  assert.equal(regionOf({ state: 'PA', county: 'Northampton County' }), 'pa');
});

test('marketplace browse links carry exact studio, ZIP and rent where supported', () => {
  const jerseyCity = MARKETS.find(({ city }) => city === 'Jersey City');
  const links = marketplaceLinks(required(jerseyCity), parseFilters({ bedrooms: 0, maxRent: 1900, zip: '07306' }));
  assert.equal(links.length, 16);
  assert.ok(links.some(({ id }) => id === 'openigloo'));
  assert.ok(links.some(({ id }) => id === 'affordablehousing'));
  assert.equal(required(links.find(({ id }) => id === 'apartments')).url, 'https://www.apartments.com/07306/studios-under-1900/');
  const craigslist = new URL(required(links.find(({ id }) => id === 'craigslist')).url);
  assert.equal(craigslist.searchParams.get('min_bedrooms'), '0');
  assert.equal(craigslist.searchParams.get('max_bedrooms'), '0');
  assert.equal(craigslist.searchParams.get('sort'), 'priceasc');
  const newYork = MARKETS.find(({ city }) => city === 'New York');
  const fourBedrooms = marketplaceLinks(required(newYork), parseFilters({ bedrooms: 4, maxRent: 4500 }));
  const streetEasy = new URL(required(fourBedrooms.find(({ id }) => id === 'streeteasy')).url);
  assert.equal(decodeURIComponent(streetEasy.pathname), '/for-rent/nyc/beds:4|price:-4500');
  assert.equal(required(fourBedrooms.find(({ id }) => id === 'trulia')).url, 'https://www.trulia.com/for_rent/New_York,NY/');
});

test('links from different sites are merged only for the same confirmed unit', () => {
  const first = normalize({ ...sample, listingUrl: 'https://www.zillow.com/homedetails/example/' });
  const second = normalize({ ...sample, id: 'another-id', addressLine1: '12 Grove St',
    addressLine2: '#2', listingUrl: 'https://www.apartments.com/example/abc/', updatedAt: '2026-11-09T13:00:00Z',
    price: 1850 }, 'apartments');
  const differentUnit = normalize({ ...sample, id: 'another-unit', addressLine2: '3' }, 'apartments');
  const unknownUnit = normalize({ ...sample, id: 'unknown-unit', addressLine2: '' }, 'apartments');
  const rows = mergeListings([first, second, differentUnit, unknownUnit]);

  assert.equal(listingKey(first), listingKey(second));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].rent, 1850);
  assert.deepEqual(rows[0].sources.map(({ id }) => id), ['apartments', 'zillow']);
  assert.equal(marketplaceIdForUrl('https://www.zillow.com.lookalike.test/example'), null);
  assert.equal(sourceLink('javascript:alert(1)', 'saved'), null);
});

test('address searches are distinct from direct links and use the unit and ZIP', () => {
  const listing = normalize({ ...sample, listingUrl: 'https://www.zillow.com/homedetails/example/' });
  const searches = marketplaceAddressSearches(listing);
  for (const id of ['cityrealty', 'citysnap', 'craigslist']) {
    assert.ok(searches.some(search => search.id === id));
  }
  assert.equal(searches.some(({ id }) => id === 'zillow'), false);
  const link = new URL(required(searches.find(({ id }) => id === 'streeteasy')).url);
  assert.match(required(link.searchParams.get('q')), /site:streeteasy\.com "12 Grove Street" "2" 07302/);
});

test('scoped search and rent medians include Manhattan and Brooklyn only', () => {
  for (const region of [NYC_SEARCH_DEFAULT, 'manhattan', 'brooklyn']) {
    const filters = parseFilters({ ...DEFAULT_FILTERS, region, includeMap: true });
    const result = snapshotSearch(filters);
    assert.ok(result.total > 0);
    assert.equal(required(result.mapPoints).length, result.total);
    const boroughs = region === NYC_SEARCH_DEFAULT ? ['manhattan', 'brooklyn'] : [region];
    assert.ok(result.matches.every((listing) => boroughs.includes(required(searchBorough(listing)))));
    const areas = rentAreas(marketSnapshot(), { region, grouping: 'city' });
    assert.deepEqual(areas.slice(1).map(({ label }) => label), ['Brooklyn, NY', 'Manhattan, NY'].filter((label) =>
      boroughs.includes(label.split(',')[0].toLowerCase())));
  }
});

test('the exact S21D owner and marketplace links appear on the card and map', () => {
  const unit = marketSnapshot().find(({ id }) => id === 'streeteasy:5177042');
  const result = localSearch([required(unit)], parseFilters({ ...DEFAULT_FILTERS, region: 'manhattan', includeMap: true }),
    localWorkplace(DEFAULT_FILTERS), 'snapshot');
  assert.equal(result.matches[0].kind, 'snapshot');
  assert.equal(required(result.mapPoints)[0].name, 'Brodsky');
  assert.match(required(result.mapPoints)[0].url, /one-columbus-place-apartment-s-21d$/);
  assert.deepEqual(required(required(result.mapPoints)[0].additionalLinks).map(({ id }) => id), ['linecity', 'streeteasy']);
});

test('the available rentals view excludes off-market, sold, rented and stale records from cards and pins', () => {
  const datedIds = ['streeteasy:5191227', 'streeteasy:5179916', 'streeteasy:5184733', 'streeteasy:5179017'];
  const dated = marketSnapshot().filter(({ id }) => datedIds.includes(id));
  assert.equal(dated.length, datedIds.length);
  const active = normalize({ ...sample, addressLine1: '55 Berry Street', city: 'Brooklyn', county: 'Kings',
    state: 'NY', zipCode: '11249', listingUrl: 'https://www.zillow.com/homedetails/example/' });
  const cached = { ...active, id: 'cached', kind: 'cached' };
  const unlinked = normalize({ ...sample, id: 'unlinked', addressLine1: '56 Berry Street', city: 'Brooklyn', county: 'Kings',
    state: 'NY', zipCode: '11249' });
  const filters = parseFilters({ ...DEFAULT_FILTERS, region: NYC_SEARCH_DEFAULT, includeMap: true, liveOnly: true });
  const listings = [...dated, active, cached, unlinked];
  const result = localSearch(listings, filters, localWorkplace(filters), 'live');
  assert.deepEqual(result.matches.map(({ id }) => id), [required(active).id]);
  assert.deepEqual(required(result.mapPoints).map(({ title }) => title), ['55 Berry Street #Apt 2']);
  const streetEasy = localSearch(listings, { ...filters, source: 'streeteasy' }, localWorkplace(filters), 'live');
  assert.deepEqual(streetEasy.matches, []);
  assert.deepEqual(streetEasy.mapPoints, []);
});

test('direction links route from the apartment to the workplace in the requested mode', () => {
  const work = localWorkplace(DEFAULT_FILTERS);
  for (const mode of ['transit', 'driving']) {
    const coordinates = new URL(directionsLink({ latitude: 40.68, longitude: -73.99 }, required(work), mode));
    assert.equal(coordinates.origin + coordinates.pathname, 'https://www.google.com/maps/dir/');
    assert.deepEqual(Object.fromEntries(coordinates.searchParams), {
      api: '1', origin: '40.68,-73.99', destination: `${required(work).latitude},${required(work).longitude}`, travelmode: mode,
    });
    const address = new URL(directionsLink({ address: '38 Lott Ave', city: 'Brooklyn', state: 'NY', zip: '11212' }, required(work), mode));
    assert.equal(address.searchParams.get('origin'), '38 Lott Ave, Brooklyn, NY, 11212');
  }
});

test('medians handle even and odd sample counts and missing bedroom sizes', () => {
  assert.equal(median([]), null);
  assert.equal(median([1800, 2000, 2200]), 2000);
  assert.equal(median([2001, 2100]), 2050.5);
  const rows = [1700, 1900, 2800].map((rent, index) =>
    normalize({ ...sample, id: String(index), addressLine2: String(index),
      bedrooms: index === 2 ? 2 : 0, price: rent }));
  const [, area] = rentAreas(rows, { region: 'nj' });
  assert.equal(area.label, 'Downtown');
  assert.deepEqual(area.sizes, [
    { median: 1800, count: 2 }, { median: null, count: 0 },
    { median: 2800, count: 1 }, { median: null, count: 0 }, { median: null, count: 0 },
  ]);
  assert.deepEqual(rentAreas(rows, { region: 'ct' }), []);
  assert.equal(rentAreas(rows, { grouping: 'zip' })[1].label, '07302');
  assert.equal(rentAreas(rows, { grouping: 'city' })[1].label, 'Jersey City, NJ');
});

test('the published snapshot provides dated StreetEasy links and measured rents', () => {
  const rows = marketSnapshot();
  assert.ok(rows.length > 10_000);
  assert.ok(rows.every(({ seenAt, kind, sources }) => kind === 'snapshot' && required(seenAt).startsWith(SNAPSHOT_MONTH) &&
    sources.every(({ url }) => marketplaceIdForUrl(url) === 'streeteasy')));
  const urls = rows.flatMap(({ sources }) => sources.map(({ url }) => url));
  assert.equal(new Set(urls).size, urls.length);
  const parkSlope = rentAreas(rows).find(({ label, detail }) => label === 'Park Slope' && detail === 'Brooklyn, NY');
  assert.ok(required(parkSlope).sizes.every(({ median, count }) => required(median) > 0 && count > 0));
});

test('previous paid provider credentials never trigger network calls', async () => {
  const env = { RENTCAST_API_KEY: 'unused', GOOGLE_ROUTES_API_KEY: 'unused', PARTNER_FEEDS_JSON: 'unused' };
  assert.deepEqual(appConfig(env), { mode: 'snapshot', storageMode: 'none', browserImportAllowed: true, dashboardAvailable: false, listingRequestTransport: 'direct', snapshotMonth: SNAPSHOT_MONTH, sources: [] });
  const result = await search({ ...DEFAULT_FILTERS }, env, () => assert.fail('No network call should occur'));
  assert.equal(result.mode, 'snapshot');
});

test('only explicitly configured free feeds are queried and verified independently', async () => {
  const env = { FREE_PARTNER_FEEDS_JSON: JSON.stringify([
    { id: 'zillow', url: 'https://feed.example.test/zillow', token: 'test-partner' },
    { id: 'renthop', url: 'https://feed.example.test/renthop' },
  ]) };
  const result = await search({ ...DEFAULT_FILTERS, region: 'nj', zip: '07302' }, env, async (url: string, options?: RequestInit) => {
    if (url.endsWith('/renthop')) return new Response('', { status: 503 });
    assert.equal(new Headers(required(options).headers).get('Authorization'), 'Bearer test-partner');
    return Response.json({ listings: [sample, { ...sample, id: 'inactive', status: 'Inactive' }] });
  });
  assert.equal(result.mode, 'live');
  assert.equal(result.total, 1);
  assert.equal(required(result.sources.find(({ id }) => id === 'renthop')).status, 'unavailable');
});

test('the API identifies snapshot mode and protects a private backend', async () => {
  const request = new Request('https://search.example.test/api/config');
  const locked = await handleApi(request, { APP_ACCESS_TOKEN: 'test-token' }, { requireToken: true });
  assert.equal(locked.status, 401);
  const result = await handleApi(new Request('https://search.example.test/api/search', {
    method: 'POST', body: JSON.stringify({ maxMinutes: 45 }),
  }), {});
  assert.equal(result.status, 422);
});

test('company filters match the advertiser field and company URLs can be saved as direct links', async () => {
  const { companyCounts } = await import('../src/companies.ts');
  const source = normalize({ ...sample, company: 'Compass New Jersey, LLC' });
  const filters = parseFilters({ ...DEFAULT_FILTERS, company: 'compass' });
  assert.equal(localSearch([source], filters, localWorkplace(filters), 'live').total, 1);
  assert.equal(localSearch([source], { ...filters, company: 'SERHANT.' }, localWorkplace(filters), 'live').total, 0);
  assert.deepEqual(companyCounts([source]), { compass: 1 });
  assert.equal(marketplaceIdForUrl('https://serhant.com/properties/example'), 'serhant');
});

test('server result pages expose every match beyond the first 100 without repeats', () => {
  const rows = Array.from({ length: 235 }, (_, n) => normalize({ ...sample, id: String(n), addressLine2: 'Apt ' + n, price: 1800 + n }));
  const ids = [];
  let offset: number | null = 0;
  do {
    const filters = parseFilters({ region: 'all', bedrooms: null, maxRent: null, offset });
    const page = localSearch(rows, filters, localWorkplace(filters), 'live');
    assert.equal(page.total, 235);
    assert.equal(page.offset, offset);
    assert.ok(page.matches.length <= 100);
    ids.push(...page.matches.map(row => row.id));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(ids.length, 235);
  assert.equal(new Set(ids).size, 235);
  const previous = localSearch(rows, parseFilters({ offset: 100 }), localWorkplace(DEFAULT_FILTERS), 'live');
  assert.equal(previous.matches[0].rent, 1900);
});

test('result offset validation rejects malformed pagination requests', () => {
  for (const offset of [-1, 1.5, 'x', 1000001]) assert.throws(() => parseFilters({ offset }));
  assert.equal(parseFilters({}).offset, 0);
});



test('every selectable region supplies a marketplace without undefined dereferences', () => {
  for (const region of Object.keys(REGIONS)) {
    const filters = parseFilters({ region });
    const markets = marketsForSearch(filters);
    assert.ok(markets.length > 0, region);
    for (const market of markets) assert.ok(marketplaceLinks(market, filters).length > 0, region);
  }
  assert.deepEqual(marketsForSearch({ region: 'all' }), MARKETS);
  assert.ok(marketsForSearch({ region: 'nj' }).every(market => market.state === 'NJ'));
});

test('CSV import accepts eastern Pennsylvania rentals and still rejects other states', async () => {
  const { parseListingImport } = await import('../src/import-listings.ts');
  const header = 'url,address,unit,city,state,zip,bedrooms,rent';
  const [listing] = parseListingImport(`${header}\nhttps://example.com/pa,12 Main Street,,Easton,PA,18042,1,1500`);
  assert.equal(listing.state, 'PA');
  assert.equal(listing.region, 'pa');
  assert.throws(() => parseListingImport(`${header}\nhttps://example.com/ma,12 Main Street,,Boston,MA,02108,1,2500`), /state, ZIP/);
});
