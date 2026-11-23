import { required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { parseFilters, DEFAULT_FILTERS, localWorkplace, directionsLink } from '../src/search.ts';
import type { SearchFilters } from '../src/domain.ts';
import { MARKETS, NYC_SEARCH_DEFAULT, REGIONS, marketsForSearch, regionOf, searchBorough } from '../src/regions.ts';
import { marketplaceAddressSearches, marketplaceIdForUrl, marketplaceLinks } from '../src/marketplaces.ts';
import { listingKey, mergeListings, normalizeListing, sourceLink } from '../src/listings.ts';
import { localSearch, median, rentAreas, SNAPSHOT_MONTH } from '../src/market.ts';
import { marketSnapshot } from '../src/bundled-market.ts';
import { handleApi } from './fixtures/api.ts';
import { search } from '../server/search.ts';
import { appConfig } from '../server/app-config.ts';
import { type ErrorBody, readJson, sentJson } from './fixtures/json.ts';
import type { TravelTimeRequest } from '../server/commute.ts';

/** A search over the bundled FirstMover snapshot, as the app runs offline. */
const snapshotSearch = (filters: SearchFilters) =>
  localSearch(marketSnapshot(), filters, localWorkplace(filters), 'snapshot', [
    { id: 'streeteasy', name: 'StreetEasy', status: 'snapshot' },
  ]);

const sample = {
  id: 'first',
  addressLine1: '12 Grove Street',
  addressLine2: 'Apt 2',
  city: 'Jersey City',
  state: 'NJ',
  zipCode: '07302',
  county: 'Hudson',
  neighborhood: 'Downtown',
  latitude: 40.72,
  longitude: -74.04,
  bedrooms: 1,
  price: 1800,
  status: 'Active',
};
const normalize = (row: Record<string, unknown>, id = 'zillow') => required(normalizeListing(row, { id, name: id, kind: 'feed' }));

test('the StreetEasy filter searches the whole snapshot before the result limit', () => {
  const result = snapshotSearch(parseFilters({ ...DEFAULT_FILTERS, source: 'streeteasy' }));
  expect(result.total > result.matches.length).toBeTruthy();
  expect(result.matches.every(({ sources }) => sources.some(({ id, url }) => id === 'streeteasy' && url))).toBeTruthy();
  expect(result.sourceCounts.find(({ id }) => id === 'streeteasy').count).toBe(result.total);
  expect(snapshotSearch(parseFilters({ ...DEFAULT_FILTERS, source: 'zillow' })).total).toBe(0);
});

test('the map covers matching listings beyond the list cap and respects the source filter', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, source: 'streeteasy', includeMap: true });
  const result = snapshotSearch(filters);
  expect(required(result.mapPoints).length).toBe(result.total);
  expect(required(result.mapPoints).length > result.matches.length).toBeTruthy();
  expect(
    required(result.mapPoints).every(
      ({ name, url, latitude, longitude }) =>
        name === 'StreetEasy' && url.startsWith('https://streeteasy.com/') && Number.isFinite(latitude) && Number.isFinite(longitude),
    ),
  ).toBeTruthy();
  expect(snapshotSearch({ ...filters, source: 'zillow' }).mapPoints).toStrictEqual([]);
  expect(snapshotSearch({ ...filters, includeMap: false }).mapPoints).toBeUndefined();
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
  expect(localSearch(listings, filters, work, 'mixed').matches.every(({ kind }) => kind === 'snapshot')).toBeTruthy();
  for (const sort of ['recent', 'distance']) {
    const result = localSearch(listings, parseFilters({ ...filters, sort }), work, 'mixed');
    expect(result.matches[0].id).toBe(required(near).id);
    expect(result.total).toBe(101);
    expect(required(result.mapPoints).length).toBe(101);
  }
});

test('commute routing checks all matching origins before filtering, sorting, and mapping', async () => {
  const env = {
    FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'zillow', url: 'https://feed.example.test/zillow' }]),
    TRAVELTIME_APP_ID: 'demo-id',
    TRAVELTIME_API_KEY: 'demo-key',
  };
  const rows: (Omit<typeof sample, 'latitude'> & { latitude: number | null })[] = Array.from({ length: 105 }, (_, index) => ({
    ...sample,
    id: String(index),
    addressLine1: `${12 + index} Grove Street`,
    latitude: 40.72 + index / 100000,
    price: 1800 + index,
  }));
  rows.push({ ...sample, id: 'missing', addressLine1: '99 Main Street', latitude: null });
  const result = await search(
    { ...DEFAULT_FILTERS, maxTransitMinutes: 30, maxDrivingMinutes: 45, sort: 'transit', includeMap: true },
    env,
    async (url: string, options?: RequestInit) => {
      if (url === 'https://feed.example.test/zillow') return Response.json(rows);
      expect(url).toBe('https://api.traveltimeapp.com/v4/time-filter/fast');
      expect(required(options).redirect).toBe('manual');
      expect(new Headers(required(options).headers).get('X-Application-Id')).toBe('demo-id');
      expect(new Headers(required(options).headers).get('X-Api-Key')).toBe('demo-key');
      const body = sentJson<TravelTimeRequest>(required(options).body);
      expect(body.locations.length).toBe(106);
      expect(body.locations.at(-1)).toStrictEqual({ id: 'workplace', coords: { lat: 40.75874, lng: -73.97867 } });
      const routes = body.arrival_searches.many_to_one;
      expect(routes.map(({ transportation }) => transportation.type)).toStrictEqual(['public_transport', 'driving+ferry']);
      expect(
        routes.every((route) => route.arrival_location_id === 'workplace' && route.arrival_time_period === 'weekday_morning'),
      ).toBeTruthy();
      const times: Record<string, number[]> = { transit: [1800, 1801, 1600, 1200], driving: [2700, 2300, 2701, 2000] };
      return Response.json({
        results: routes.map(({ id }) => ({
          search_id: id,
          locations: ['0', '1', '2', '104'].map((locationId, index) => ({ id: locationId, properties: { travel_time: times[id][index] } })),
        })),
      });
    },
  );
  expect(result.commute).toBe(true);
  expect(result.matches.map(({ id }) => id)).toStrictEqual(['zillow:104', 'zillow:0']);
  expect(required(result.mapPoints).map(({ transitSeconds, drivingSeconds }) => [transitSeconds, drivingSeconds])).toStrictEqual([
    [1200, 2000],
    [1800, 2700],
  ]);
});

test('a commute filter requires server credentials and reports an unavailable routing service', async () => {
  const response = await handleApi(
    new Request('https://search.example.test/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxDrivingMinutes: 45, routingCredentials: { appId: 'client-id', apiKey: 'client-key' } }),
    }),
    {},
    { fetcher: () => expect.unreachable('No routing request is sent without credentials') },
  );
  expect(response.status).toBe(503);
  expect((await readJson<ErrorBody>(response)).commuteError).toBe(true);
});

test('a routing outage preserves ordinary results but fails an explicitly filtered search', async () => {
  const env = { TRAVELTIME_APP_ID: 'demo-id', TRAVELTIME_API_KEY: 'demo-key' };
  const fetcher = async () => new Response(null, { status: 503 });
  const result = await search({ ...DEFAULT_FILTERS, includeCommute: true }, env, fetcher);
  expect(result.total > 0).toBeTruthy();
  expect(required(result.commuteNotice)).toMatch(/couldn’t calculate routes/);
  await expect(search({ ...DEFAULT_FILTERS, maxTransitMinutes: 45 }, env, fetcher)).rejects.toThrow(/couldn’t calculate routes/);
});

test('studio, geography, budget, and distance are applied together to real observations', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, region: 'nj', bedrooms: '0', maxRent: '2500', maxMiles: '12' });
  const result = snapshotSearch(filters);
  expect(result.mode).toBe('snapshot');
  expect(result.total > 0).toBeTruthy();
  expect(
    result.matches.every(({ state, rent, bedrooms, miles }) => state === 'NJ' && rent <= 2500 && bedrooms === 0 && required(miles) <= 12),
  ).toBeTruthy();
  expect(result.matches.every((listing, index, items) => index === 0 || items[index - 1].rent <= listing.rent)).toBeTruthy();
  expect(snapshotSearch({ ...filters, maxMiles: 0.1 }).total).toBe(0);
  expect(() => parseFilters({ zip: '9900' })).toThrow(/five-digit ZIP/);
  expect(() => localWorkplace(parseFilters({ workplace: 'custom', customWorkplace: '100, -73' }))).toThrow(/latitude/);
});

test('tri-state coverage includes Long Island ZIPs and Connecticut planning regions', () => {
  expect(regionOf({ state: 'NY', zip: '11050', city: 'Port Washington' })).toBe('li');
  expect(regionOf({ state: 'NY', zip: '11004' })).toBe('nyc');
  expect(regionOf({ state: 'CT', county: 'Greater Bridgeport Planning Region' })).toBe('ct');
  expect(regionOf({ state: 'NJ', county: 'Atlantic County' })).toBeNull();
  expect(regionOf({ state: 'PA', county: 'Northampton County' })).toBe('pa');
});

test('marketplace browse links carry exact studio, ZIP and rent where supported', () => {
  const jerseyCity = MARKETS.find(({ city }) => city === 'Jersey City');
  const links = marketplaceLinks(required(jerseyCity), parseFilters({ bedrooms: 0, maxRent: 1900, zip: '07306' }));
  expect(links.length).toBe(16);
  expect(links.some(({ id }) => id === 'openigloo')).toBeTruthy();
  expect(links.some(({ id }) => id === 'affordablehousing')).toBeTruthy();
  expect(required(links.find(({ id }) => id === 'apartments')).url).toBe('https://www.apartments.com/07306/studios-under-1900/');
  const craigslist = new URL(required(links.find(({ id }) => id === 'craigslist')).url);
  expect(craigslist.searchParams.get('min_bedrooms')).toBe('0');
  expect(craigslist.searchParams.get('max_bedrooms')).toBe('0');
  expect(craigslist.searchParams.get('sort')).toBe('priceasc');
  const newYork = MARKETS.find(({ city }) => city === 'New York');
  const fourBedrooms = marketplaceLinks(required(newYork), parseFilters({ bedrooms: 4, maxRent: 4500 }));
  const streetEasy = new URL(required(fourBedrooms.find(({ id }) => id === 'streeteasy')).url);
  expect(decodeURIComponent(streetEasy.pathname)).toBe('/for-rent/nyc/beds:4|price:-4500');
  expect(required(fourBedrooms.find(({ id }) => id === 'trulia')).url).toBe('https://www.trulia.com/for_rent/New_York,NY/');
});

test('links from different sites are merged only for the same confirmed unit', () => {
  const first = normalize({ ...sample, listingUrl: 'https://www.zillow.com/homedetails/example/' });
  const second = normalize(
    {
      ...sample,
      id: 'another-id',
      addressLine1: '12 Grove St',
      addressLine2: '#2',
      listingUrl: 'https://www.apartments.com/example/abc/',
      updatedAt: '2026-11-09T13:00:00Z',
      price: 1850,
    },
    'apartments',
  );
  const differentUnit = normalize({ ...sample, id: 'another-unit', addressLine2: '3' }, 'apartments');
  const unknownUnit = normalize({ ...sample, id: 'unknown-unit', addressLine2: '' }, 'apartments');
  const rows = mergeListings([first, second, differentUnit, unknownUnit]);

  expect(listingKey(first)).toBe(listingKey(second));
  expect(rows.length).toBe(3);
  expect(rows[0].rent).toBe(1850);
  expect(rows[0].sources.map(({ id }) => id)).toStrictEqual(['apartments', 'zillow']);
  expect(marketplaceIdForUrl('https://www.zillow.com.lookalike.test/example')).toBeNull();
  expect(sourceLink('javascript:alert(1)', 'saved')).toBeNull();
});

test('address searches are distinct from direct links and use the unit and ZIP', () => {
  const listing = normalize({ ...sample, listingUrl: 'https://www.zillow.com/homedetails/example/' });
  const searches = marketplaceAddressSearches(listing);
  for (const id of ['cityrealty', 'citysnap', 'craigslist']) {
    expect(searches.some((search) => search.id === id)).toBeTruthy();
  }
  expect(searches.some(({ id }) => id === 'zillow')).toBe(false);
  const link = new URL(required(searches.find(({ id }) => id === 'streeteasy')).url);
  expect(required(link.searchParams.get('q'))).toMatch(/site:streeteasy\.com "12 Grove Street" "2" 07302/);
});

test('scoped search and rent medians include Manhattan and Brooklyn only', () => {
  for (const region of [NYC_SEARCH_DEFAULT, 'manhattan', 'brooklyn']) {
    const filters = parseFilters({ ...DEFAULT_FILTERS, region, includeMap: true });
    const result = snapshotSearch(filters);
    expect(result.total > 0).toBeTruthy();
    expect(required(result.mapPoints).length).toBe(result.total);
    const boroughs = region === NYC_SEARCH_DEFAULT ? ['manhattan', 'brooklyn'] : [region];
    expect(result.matches.every((listing) => boroughs.includes(required(searchBorough(listing))))).toBeTruthy();
    const areas = rentAreas(marketSnapshot(), { region, grouping: 'city' });
    expect(areas.slice(1).map(({ label }) => label)).toStrictEqual(
      ['Brooklyn, NY', 'Manhattan, NY'].filter((label) => boroughs.includes(label.split(',')[0].toLowerCase())),
    );
  }
});

test('the exact S21D owner and marketplace links appear on the card and map', () => {
  const unit = marketSnapshot().find(({ id }) => id === 'streeteasy:5177042');
  const result = localSearch(
    [required(unit)],
    parseFilters({ ...DEFAULT_FILTERS, region: 'manhattan', includeMap: true }),
    localWorkplace(DEFAULT_FILTERS),
    'snapshot',
  );
  expect(result.matches[0].kind).toBe('snapshot');
  expect(required(result.mapPoints)[0].name).toBe('Brodsky');
  expect(required(result.mapPoints)[0].url).toMatch(/one-columbus-place-apartment-s-21d$/);
  expect(required(required(result.mapPoints)[0].additionalLinks).map(({ id }) => id)).toStrictEqual(['linecity', 'streeteasy']);
});

test('the available rentals view excludes off-market, sold, rented and stale records from cards and pins', () => {
  const datedIds = ['streeteasy:5191227', 'streeteasy:5179916', 'streeteasy:5184733', 'streeteasy:5179017'];
  const dated = marketSnapshot().filter(({ id }) => datedIds.includes(id));
  expect(dated.length).toBe(datedIds.length);
  const active = normalize({
    ...sample,
    addressLine1: '55 Berry Street',
    city: 'Brooklyn',
    county: 'Kings',
    state: 'NY',
    zipCode: '11249',
    listingUrl: 'https://www.zillow.com/homedetails/example/',
  });
  const cached = { ...active, id: 'cached', kind: 'cached' };
  const unlinked = normalize({
    ...sample,
    id: 'unlinked',
    addressLine1: '56 Berry Street',
    city: 'Brooklyn',
    county: 'Kings',
    state: 'NY',
    zipCode: '11249',
  });
  const filters = parseFilters({ ...DEFAULT_FILTERS, region: NYC_SEARCH_DEFAULT, includeMap: true, liveOnly: true });
  const listings = [...dated, active, cached, unlinked];
  const result = localSearch(listings, filters, localWorkplace(filters), 'live');
  expect(result.matches.map(({ id }) => id)).toStrictEqual([required(active).id]);
  expect(required(result.mapPoints).map(({ title }) => title)).toStrictEqual(['55 Berry Street #Apt 2']);
  const streetEasy = localSearch(listings, { ...filters, source: 'streeteasy' }, localWorkplace(filters), 'live');
  expect(streetEasy.matches).toStrictEqual([]);
  expect(streetEasy.mapPoints).toStrictEqual([]);
});

test('direction links route from the apartment to the workplace in the requested mode', () => {
  const work = localWorkplace(DEFAULT_FILTERS);
  for (const mode of ['transit', 'driving']) {
    const coordinates = new URL(directionsLink({ latitude: 40.68, longitude: -73.99 }, required(work), mode));
    expect(coordinates.origin + coordinates.pathname).toBe('https://www.google.com/maps/dir/');
    expect(Object.fromEntries(coordinates.searchParams)).toStrictEqual({
      api: '1',
      origin: '40.68,-73.99',
      destination: `${required(work).latitude},${required(work).longitude}`,
      travelmode: mode,
    });
    const address = new URL(directionsLink({ address: '38 Lott Ave', city: 'Brooklyn', state: 'NY', zip: '11212' }, required(work), mode));
    expect(address.searchParams.get('origin')).toBe('38 Lott Ave, Brooklyn, NY, 11212');
  }
});

test('medians handle even and odd sample counts and missing bedroom sizes', () => {
  expect(median([])).toBeNull();
  expect(median([1800, 2000, 2200])).toBe(2000);
  expect(median([2001, 2100])).toBe(2050.5);
  const rows = [1700, 1900, 2800].map((rent, index) =>
    normalize({ ...sample, id: String(index), addressLine2: String(index), bedrooms: index === 2 ? 2 : 0, price: rent }),
  );
  const [, area] = rentAreas(rows, { region: 'nj' });
  expect(area.label).toBe('Downtown');
  expect(area.sizes).toStrictEqual([
    { median: 1800, count: 2 },
    { median: null, count: 0 },
    { median: 2800, count: 1 },
    { median: null, count: 0 },
    { median: null, count: 0 },
  ]);
  expect(rentAreas(rows, { region: 'ct' })).toStrictEqual([]);
  expect(rentAreas(rows, { grouping: 'zip' })[1].label).toBe('07302');
  expect(rentAreas(rows, { grouping: 'city' })[1].label).toBe('Jersey City, NJ');
});

test('the published snapshot provides dated StreetEasy links and measured rents', () => {
  const rows = marketSnapshot();
  expect(rows.length > 10_000).toBeTruthy();
  expect(
    rows.every(
      ({ seenAt, kind, sources }) =>
        kind === 'snapshot' &&
        required(seenAt).startsWith(SNAPSHOT_MONTH) &&
        sources.every(({ url }) => marketplaceIdForUrl(url) === 'streeteasy'),
    ),
  ).toBeTruthy();
  const urls = rows.flatMap(({ sources }) => sources.map(({ url }) => url));
  expect(new Set(urls).size).toBe(urls.length);
  const parkSlope = rentAreas(rows).find(({ label, detail }) => label === 'Park Slope' && detail === 'Brooklyn, NY');
  expect(required(parkSlope).sizes.every(({ median, count }) => required(median) > 0 && count > 0)).toBeTruthy();
});

test('without configured feeds the app uses its snapshot and makes no network calls', async () => {
  const env = {};
  expect(appConfig(env)).toStrictEqual({
    mode: 'snapshot',
    storageMode: 'none',
    browserImportAllowed: true,
    dashboardAvailable: false,
    snapshotMonth: SNAPSHOT_MONTH,
    sources: [],
  });
  const result = await search({ ...DEFAULT_FILTERS }, env, () => expect.unreachable('No network call should occur'));
  expect(result.mode).toBe('snapshot');
});

test('only explicitly configured free feeds are queried and verified independently', async () => {
  const env = {
    FREE_PARTNER_FEEDS_JSON: JSON.stringify([
      { id: 'zillow', url: 'https://feed.example.test/zillow', token: 'test-partner' },
      { id: 'renthop', url: 'https://feed.example.test/renthop' },
    ]),
  };
  const result = await search({ ...DEFAULT_FILTERS, region: 'nj', zip: '07302' }, env, async (url: string, options?: RequestInit) => {
    if (url.endsWith('/renthop')) return new Response('', { status: 503 });
    expect(new Headers(required(options).headers).get('Authorization')).toBe('Bearer test-partner');
    return Response.json({ listings: [sample, { ...sample, id: 'inactive', status: 'Inactive' }] });
  });
  expect(result.mode).toBe('live');
  expect(result.total).toBe(1);
  expect(required(result.sources.find(({ id }) => id === 'renthop')).status).toBe('unavailable');
});

// Access control for the private app is in the Cloudflare entry; see test/cloudflare.test.ts.
test('the API identifies snapshot mode', async () => {
  const result = await handleApi(
    new Request('https://search.example.test/api/search', {
      method: 'POST',
      body: JSON.stringify({ maxMinutes: 45 }),
      headers: { 'Content-Type': 'application/json' },
    }),
    {},
  );
  expect(result.status).toBe(422);
  expect((await readJson<ErrorBody>(result)).error).toMatch(/transit directions link/);
});

test('company filters match the advertiser field and company URLs can be saved as direct links', async () => {
  const { companyCounts } = await import('../src/companies.ts');
  const source = normalize({ ...sample, company: 'Compass New Jersey, LLC' });
  const filters = parseFilters({ ...DEFAULT_FILTERS, company: 'compass' });
  expect(localSearch([source], filters, localWorkplace(filters), 'live').total).toBe(1);
  expect(localSearch([source], { ...filters, company: 'SERHANT.' }, localWorkplace(filters), 'live').total).toBe(0);
  expect(companyCounts([source])).toStrictEqual({ compass: 1 });
  expect(marketplaceIdForUrl('https://serhant.com/properties/example')).toBe('serhant');
});

test('server result pages expose every match beyond the first 100 without repeats', () => {
  const rows = Array.from({ length: 235 }, (_, n) => normalize({ ...sample, id: String(n), addressLine2: 'Apt ' + n, price: 1800 + n }));
  const ids = [];
  let offset: number | null = 0;
  do {
    const filters = parseFilters({ region: 'all', bedrooms: null, maxRent: null, offset });
    const page = localSearch(rows, filters, localWorkplace(filters), 'live');
    expect(page.total).toBe(235);
    expect(page.offset).toBe(offset);
    expect(page.matches.length <= 100).toBeTruthy();
    ids.push(...page.matches.map((row) => row.id));
    offset = page.nextOffset;
  } while (offset !== null);
  expect(ids.length).toBe(235);
  expect(new Set(ids).size).toBe(235);
  const previous = localSearch(rows, parseFilters({ offset: 100 }), localWorkplace(DEFAULT_FILTERS), 'live');
  expect(previous.matches[0].rent).toBe(1900);
});

test('result offset validation rejects malformed pagination requests', () => {
  for (const offset of [-1, 1.5, 'x', 1000001]) expect(() => parseFilters({ offset })).toThrow();
  expect(parseFilters({}).offset).toBe(0);
});

test('every selectable region supplies a marketplace without undefined dereferences', () => {
  for (const region of Object.keys(REGIONS)) {
    const filters = parseFilters({ region });
    const markets = marketsForSearch(filters);
    expect(markets.length > 0, region).toBeTruthy();
    for (const market of markets) expect(marketplaceLinks(market, filters).length > 0, region).toBeTruthy();
  }
  expect(marketsForSearch({ region: 'all' })).toStrictEqual(MARKETS);
  expect(marketsForSearch({ region: 'nj' }).every((market) => market.state === 'NJ')).toBeTruthy();
});
