import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilters, DEFAULT_FILTERS, localWorkplace } from '../src/search.mjs';
import { MARKETS, regionOf } from '../src/regions.mjs';
import { marketplaceAddressSearches, marketplaceIdForUrl, marketplaceLinks } from '../src/marketplaces.mjs';
import { listingKey, mergeListings, normalizeListing, sourceLink } from '../src/listings.mjs';
import { marketSnapshot, median, rentAreas, snapshotSearch, SNAPSHOT_MONTH } from '../src/market.mjs';
import { appConfig, handleApi, search } from '../server/api.mjs';

const sample = {
  id: 'first', addressLine1: '12 Grove Street', addressLine2: 'Apt 2',
  city: 'Jersey City', state: 'NJ', zipCode: '07302', county: 'Hudson', neighborhood: 'Downtown',
  latitude: 40.72, longitude: -74.04, bedrooms: 1, price: 1800, status: 'Active',
};
const normalize = (row, id = 'zillow') => normalizeListing(row, { id, name: id, kind: 'feed' });

test('studio, geography, budget, and distance are applied together to real observations', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, region: 'nj', bedrooms: '0', maxRent: '2500', maxMiles: '12' });
  const result = snapshotSearch(filters);
  assert.equal(result.mode, 'snapshot');
  assert.ok(result.total > 0);
  assert.ok(result.matches.every(({ state, rent, bedrooms, miles }) =>
    state === 'NJ' && rent <= 2500 && bedrooms === 0 && miles <= 12));
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
  const links = marketplaceLinks(jerseyCity, parseFilters({ bedrooms: 0, maxRent: 1900, zip: '07306' }));
  assert.equal(links.length, 16);
  assert.ok(links.some(({ id }) => id === 'openigloo'));
  assert.ok(links.some(({ id }) => id === 'affordablehousing'));
  assert.equal(links.find(({ id }) => id === 'apartments').url, 'https://www.apartments.com/07306/studios-under-1900/');
  const craigslist = new URL(links.find(({ id }) => id === 'craigslist').url);
  assert.equal(craigslist.searchParams.get('min_bedrooms'), '0');
  assert.equal(craigslist.searchParams.get('max_bedrooms'), '0');
  assert.equal(craigslist.searchParams.get('sort'), 'priceasc');
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
  assert.equal(searches.length, 14);
  assert.equal(searches.some(({ id }) => id === 'zillow'), false);
  const link = new URL(searches.find(({ id }) => id === 'streeteasy').url);
  assert.match(link.searchParams.get('q'), /site:streeteasy\.com "12 Grove Street" "2" 07302/);
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
  assert.ok(rows.every(({ seenAt, kind, sources }) => kind === 'snapshot' && seenAt.startsWith(SNAPSHOT_MONTH) &&
    sources.every(({ url }) => marketplaceIdForUrl(url) === 'streeteasy')));
  const urls = rows.flatMap(({ sources }) => sources.map(({ url }) => url));
  assert.equal(new Set(urls).size, urls.length);
  const parkSlope = rentAreas(rows).find(({ label, detail }) => label === 'Park Slope' && detail === 'Brooklyn, NY');
  assert.ok(parkSlope.sizes.every(({ median, count }) => median > 0 && count > 0));
});

test('previous paid provider credentials never trigger network calls', async () => {
  const env = { RENTCAST_API_KEY: 'unused', GOOGLE_ROUTES_API_KEY: 'unused', PARTNER_FEEDS_JSON: 'unused' };
  assert.deepEqual(appConfig(env), { mode: 'snapshot', snapshotMonth: SNAPSHOT_MONTH, sources: [] });
  const result = await search(DEFAULT_FILTERS, env, () => assert.fail('No network call should occur'));
  assert.equal(result.mode, 'snapshot');
});

test('only explicitly configured free feeds are queried and verified independently', async () => {
  const env = { FREE_PARTNER_FEEDS_JSON: JSON.stringify([
    { id: 'zillow', url: 'https://feed.example.test/zillow', token: 'test-partner' },
    { id: 'renthop', url: 'https://feed.example.test/renthop' },
  ]) };
  const result = await search({ ...DEFAULT_FILTERS, region: 'nj', zip: '07302' }, env, async (url, options) => {
    if (url.endsWith('/renthop')) return new Response('', { status: 503 });
    assert.equal(options.headers.Authorization, 'Bearer test-partner');
    return Response.json({ listings: [sample, { ...sample, id: 'inactive', status: 'Inactive' }] });
  });
  assert.equal(result.mode, 'live');
  assert.equal(result.total, 1);
  assert.equal(result.sources.find(({ id }) => id === 'renthop').status, 'unavailable');
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
