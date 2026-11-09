import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilters, previewSearch, DEFAULT_FILTERS, localWorkplace } from '../src/search.mjs';
import { MARKETS, regionOf } from '../src/regions.mjs';
import { marketplaceLinks } from '../src/marketplaces.mjs';
import { nextWeekdayArrival } from '../server/commute.mjs';
import { appConfig, handleApi, search } from '../server/api.mjs';
import { rentcastQuery } from '../server/listings.mjs';

const sample = {
  id: 'first', addressLine1: '12 Grove Street', addressLine2: 'Apt 2',
  city: 'Jersey City', state: 'NJ', zipCode: '07302', county: 'Hudson',
  latitude: 40.72, longitude: -74.04, bedrooms: 1, price: 1800, status: 'Active',
};

test('studio, geography, budget, and distance are applied together', () => {
  const filters = parseFilters({ ...DEFAULT_FILTERS, region: 'nj', bedrooms: '0', maxRent: '1500', maxMiles: '12' });
  const result = previewSearch(filters);
  assert.equal(result.mode, 'demo');
  assert.deepEqual(result.matches.map(({ city, rent, bedrooms }) => [city, rent, bedrooms]), [['Newark', 1425, 0]]);
  assert.equal(previewSearch({ ...filters, maxMiles: 5 }).total, 0);
  assert.throws(() => parseFilters({ zip: '9900' }), /five-digit ZIP/);
  assert.throws(() => localWorkplace(parseFilters({ workplace: 'custom', customWorkplace: '100, -73' })), /latitude/);
});

test('tri-state coverage includes Long Island ZIPs and Connecticut planning regions', () => {
  assert.equal(regionOf({ state: 'NY', zip: '11050', city: 'Port Washington' }), 'li');
  assert.equal(regionOf({ state: 'NY', zip: '11004' }), 'nyc');
  assert.equal(regionOf({ state: 'CT', county: 'Greater Bridgeport Planning Region' }), 'ct');
  assert.equal(regionOf({ state: 'NJ', county: 'Atlantic County' }), null);
});

test('marketplace links carry exact studio, ZIP and rent filters where supported', () => {
  const jerseyCity = MARKETS.find(({ city }) => city === 'Jersey City');
  const links = marketplaceLinks(jerseyCity, parseFilters({ bedrooms: 0, maxRent: 1900, zip: '07306' }));
  assert.equal(links.length, 14);
  assert.equal(links.find(({ id }) => id === 'apartments').url, 'https://www.apartments.com/07306/studios-under-1900/');
  const craigslist = new URL(links.find(({ id }) => id === 'craigslist').url);
  assert.equal(craigslist.searchParams.get('min_bedrooms'), '0');
  assert.equal(craigslist.searchParams.get('max_bedrooms'), '0');
  assert.equal(craigslist.searchParams.get('sort'), 'priceasc');
});

test('weekday arrivals stay at the selected local time across daylight saving changes', () => {
  assert.equal(nextWeekdayArrival('08:30', new Date('2026-10-30T17:00:00Z')), '2026-11-02T13:30:00.000Z');
  assert.equal(nextWeekdayArrival('08:30', new Date('2026-03-06T18:00:00Z')), '2026-03-09T12:30:00.000Z');
});

test('RentCast queries active units by ZIP and use an exact studio count', () => {
  const query = rentcastQuery(parseFilters({ region: 'nj', zip: '07302', bedrooms: 0, maxRent: 2500 }));
  assert.equal(query.get('status'), 'Active');
  assert.equal(query.get('propertyType'), 'Apartment|Condo|Multi-Family');
  assert.equal(query.get('zipCode'), '07302');
  assert.equal(query.get('bedrooms'), '0');
  assert.equal(query.get('price'), '1:2500');
  assert.equal(query.has('radius'), false);
});

test('live feeds deduplicate the same confirmed unit and filter scheduled routes', async () => {
  const env = {
    RENTCAST_API_KEY: 'test-listings',
    GOOGLE_ROUTES_API_KEY: 'test-routes',
    PARTNER_FEEDS_JSON: JSON.stringify([
      { id: 'zillow', url: 'https://feed.example.test/zillow', token: 'test-partner' },
      { id: 'renthop', url: 'https://feed.example.test/renthop' },
    ]),
  };

  const fetcher = async (url, options) => {
    if (url.startsWith('https://api.rentcast.io/')) {
      assert.equal(options.headers['X-Api-Key'], 'test-listings');
      return Response.json([
        { ...sample, lastSeenDate: '2026-11-08T13:00:00Z' },
        { ...sample, id: 'third', addressLine2: 'Apt 3', price: 1700 },
        { ...sample, id: 'inactive', addressLine2: 'Apt 4', status: 'Inactive' },
        { ...sample, id: 'fourth', addressLine2: 'Apt 5', latitude: null },
      ]);
    }
    if (url.endsWith('/zillow')) {
      assert.equal(options.headers.Authorization, 'Bearer test-partner');
      return Response.json({ listings: [{
        ...sample, id: 'same-unit', addressLine1: '12 Grove St', addressLine2: '#2',
        price: 1850, updatedAt: '2026-11-09T13:00:00Z', listingUrl: 'https://example.test/listing',
      }] });
    }
    if (url.endsWith('/renthop')) return new Response('', { status: 503 });
    assert.match(url, /routes\.googleapis\.com/);
    const payload = JSON.parse(options.body);
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-routes');
    assert.equal(payload.travelMode, 'TRANSIT');
    assert.match(payload.arrivalTime, /T1[23]:30:00\.000Z$/);
    assert.equal(payload.origins.length, 2);
    return Response.json([
      { originIndex: 1, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '2100s', distanceMeters: 12000 },
      { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_EXISTS', duration: '3000s', distanceMeters: 13000 },
    ]);
  };

  const results = await search({ ...DEFAULT_FILTERS, zip: '07302', maxMinutes: 45 }, env, fetcher);
  assert.equal(results.mode, 'live');
  assert.equal(results.total, 1);
  assert.equal(results.matches[0].rent, 1850);
  assert.deepEqual(results.matches[0].sources.map(({ id }) => id), ['zillow', 'rentcast']);
  assert.equal(results.matches[0].transitSeconds, 2100);
  assert.equal(results.sources.find(({ id }) => id === 'renthop').status, 'unavailable');
});

test('the API identifies preview mode and keeps an authenticated backend private', async () => {
  assert.deepEqual(appConfig({}), { mode: 'demo', sources: [], transit: false });
  const request = new Request('https://search.example.test/api/config');
  const locked = await handleApi(request, { APP_ACCESS_TOKEN: 'test-token' }, { requireToken: true });
  assert.equal(locked.status, 401);
  const invalid = await handleApi(new Request('https://search.example.test/api/search', {
    method: 'POST', body: JSON.stringify({ maxMinutes: 45 }),
  }), {});
  assert.equal(invalid.status, 422);
});
