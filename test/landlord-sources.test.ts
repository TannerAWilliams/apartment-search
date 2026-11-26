import { expect, test } from 'bun:test';
import { brodskyListingUrl, loadBrodsky, parseBrodskyBuilding, parseBrodskyRentals } from '../server/sources/brodsky.ts';
import { GLENWOOD_BUILDINGS, glenwoodListingUrl, loadGlenwood, parseGlenwoodSearch } from '../server/sources/glenwood.ts';
import { refreshSources } from '../server/refresh.ts';
import { search } from '../server/search.ts';
import { loadStuyTown, stuyTownListing, stuyTownListingUrl } from '../server/sources/stuytown.ts';
import { parseFilters } from '../src/search.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { required } from './test-values.ts';

const now = new Date('2026-11-23T12:00:00Z');

const unit = (id: string, extra: Record<string, unknown> = {}) => ({
  unitSpk: id,
  unitNumber: '01-E',
  bedrooms: 1,
  bathrooms: 1,
  price: 5277,
  sqft: 944,
  isAvailable: true,
  property: { name: 'Peter Cooper Village' },
  building: { address: '7 PETER COOPER ROAD', latitude: '40.73447', longitude: '-73.975365' },
  ...extra,
});
/** The StuyTown feed: a count, and pages of units. */
function stuyTownFeed(units: unknown[], reported = units.length) {
  const requests: string[] = [];
  const fetcher = (url: string) => {
    requests.push(url);
    const query = new URL(url).searchParams;
    if (url.includes('/units-filter/count')) return Response.json(reported);
    const page = Number(query.get('page'));
    const size = Number(query.get('itemsOnPage'));
    return Response.json({ count: size, unitModels: units.slice(page * size, (page + 1) * size) });
  };
  return { fetcher, requests };
}

test('StuyTown: every apartment the count reports, across pages, with the landlord’s link', async () => {
  const units = Array.from({ length: 150 }, (_, index) => unit(`P~NYPC21~B~007~U~${index}`));
  const { fetcher, requests } = stuyTownFeed(units);
  const result = await loadStuyTown(fetcher, now);
  expect(result).toMatchObject({ total: 150, rawCount: 150, pages: 2, transport: 'stuytown-units-api' });
  expect(result.listings).toHaveLength(150);
  expect(requests.filter((url) => url.includes('page='))).toHaveLength(2);
  expect(result.listings[0]).toMatchObject({
    address: '7 Peter Cooper Road',
    unit: '01-E',
    zip: '10010',
    city: 'Manhattan',
    rent: 5277,
    bedrooms: 1,
    bathrooms: 1,
    squareFeet: 944,
  });
  expect(result.listings[0]?.sources[0]?.url).toBe('https://www.stuytown.com/nyc-apartments-for-rent/unit?unitSpk=P~NYPC21~B~007~U~0');
});

test('StuyTown: a count the pages do not add up to saves nothing', async () => {
  await expect(loadStuyTown(stuyTownFeed([unit('a'), unit('b')], 3).fetcher, now)).rejects.toThrow('StuyTown listed 2 of the 3 apartments');
  await expect(loadStuyTown(() => Response.json('lots'), now)).rejects.toThrow('usable apartment count');
  await expect(loadStuyTown(() => new Response('down', { status: 503 }), now)).rejects.toThrow('HTTP 503');
});

test('StuyTown: units that are not available or not placed are left out, and links must be the landlord’s', () => {
  const at = now.toISOString();
  expect(stuyTownListing(unit('a', { isAvailable: false }), at)).toBeNull();
  expect(stuyTownListing(unit('a', { property: { name: 'Elsewhere' } }), at)).toBeNull();
  expect(required(stuyTownListing(unit('a', { property: { name: 'Stuyvesant Town' } }), at)).zip).toBe('10009');
  expect(stuyTownListingUrl('https://www.stuytown.com/nyc-apartments-for-rent/unit?unitSpk=P~1')).not.toBeNull();
  for (const url of [
    'https://evil.example/nyc-apartments-for-rent/unit?unitSpk=P~1',
    'https://www.stuytown.com/other?unitSpk=P~1',
    'https://www.stuytown.com/nyc-apartments-for-rent/unit',
  ])
    expect(stuyTownListingUrl(url)).toBeNull();
});

const card = (id: string, building: string, bedrooms: number, rent: number) => `<div class="col-md-4 col-sm-6" id="${id}">
  <a href="https://www.glenwoodnyc.com/properties/upper-east-side/${building}">Name</a><span>ID: ${id}</span>
  <div class="col"><p>Bedrooms</p><svg><path d="M1"><\\path><\\svg><span>${bedrooms}</span></div>
  <div class="col"><p>Bathrooms</p><span>1</span></div><p>Monthly Price</p><span>$${rent.toLocaleString('en-US')}</span></div>`;
const searchPage = (cards: string[]) => `<html><body><h4>Search Result: All Neighborhoods</h4>${cards.join('')}</body></html>`;
/** Glenwood's search: all apartments, and each size. */
function glenwoodSite(all: string[], bySize: Record<number, string[]>) {
  return (url: string) => {
    const bedroom = Number(new URL(url).searchParams.get('bedroom'));
    return new Response(searchPage(bedroom === -1 ? all : (bySize[bedroom] ?? [])), { headers: { 'Content-Type': 'text/html' } });
  };
}

test('Glenwood: the all-apartments search, checked against the size searches, with addresses from the building table', async () => {
  const a = card('2139', 'the-pavilion', 1, 6995);
  const b = card('5484', 'the-barclay', 2, 9450);
  // A convertible apartment appears under two sizes.
  const result = await loadGlenwood(glenwoodSite([a, b], { 1: [a, b], 2: [b] }), now);
  expect(result).toMatchObject({ total: 2, rawCount: 2, pages: 6, transport: 'glenwood-search-all' });
  expect(result.listings[0]).toMatchObject({ address: '500 East 77th Street', zip: '10162', bedrooms: 1, rent: 6995, bathrooms: 1 });
  expect(result.listings[0]?.sources[0]?.url).toBe('https://www.glenwoodnyc.com/listing-detail/?lid=2139');
});

test('Glenwood: a mismatch between searches, an unknown building or an unreadable card saves nothing', async () => {
  const a = card('2139', 'the-pavilion', 1, 6995);
  await expect(loadGlenwood(glenwoodSite([a], { 1: [a, card('9', 'the-barclay', 1, 5000)] }), now)).rejects.toThrow('did not match');
  await expect(
    loadGlenwood(glenwoodSite([card('9', 'new-tower', 1, 5000)], { 1: [card('9', 'new-tower', 1, 5000)] }), now),
  ).rejects.toThrow('new-tower');
  expect(() => parseGlenwoodSearch(searchPage(['<div class="col-md-4 col-sm-6" id="7">no details</div>']))).toThrow(
    'did not fully describe',
  );
  expect(() => parseGlenwoodSearch('<html>Maintenance</html>')).toThrow('recognized search page');
  // Glenwood writes a studio as "S".
  expect(
    parseGlenwoodSearch(searchPage([card('3513', 'the-fairmont', 1, 3995).replace('<span>1</span></div>\n', '<span>S</span></div>\n')])),
  ).toMatchObject([{ id: '3513', bedrooms: 0, rent: 3995 }]);
  expect(glenwoodListingUrl('https://www.glenwoodnyc.com/listing-detail/?lid=2139&sr=yes')).toBe(
    'https://www.glenwoodnyc.com/listing-detail/?lid=2139',
  );
  expect(glenwoodListingUrl('https://evil.example/listing-detail/?lid=1')).toBeNull();
  expect(Object.keys(GLENWOOD_BUILDINGS)).toHaveLength(26);
});

test('a landlord check is saved as a full inventory, so search does not call it a sample', async () => {
  const env = { BUCKET: createMemoryBucket() };
  const units = [unit('P~1'), unit('P~2', { unitNumber: '02-A' })];
  // Search judges freshness by the clock, so this check is made now.
  const result = await refreshSources(env, { onDemand: true, sourceId: 'stuytown-live', fetcher: stuyTownFeed(units).fetcher });
  expect(result.sources.find(({ id }) => id === 'stuytown-live')).toMatchObject({ status: 'updated', listingCount: 2, total: 2 });
  const found = await search(
    parseFilters({ region: 'manhattan', liveOnly: true, includeCached: true, bedrooms: null, maxRent: null }),
    env,
    undefined,
    true,
  );
  expect(found.matches).toHaveLength(2);
  expect(found.sources.find(({ id }) => id === 'stuytown')).toMatchObject({ status: 'searched', sample: false });
});

const brodskyUnit = (uid: string, property: string, extra: Record<string, unknown> = {}) => ({
  uid,
  propertyUid: property,
  neighborhoodUid: 'lincoln-square',
  url: `/rentals/lincoln-square/${property}/${uid}`,
  apartmentName: 'S37A',
  beds: 2,
  baths: 2,
  minimumRent: 8500,
  zipCode: '10019',
  latitude: 40.77,
  longitude: -73.98,
  description: 'A {braced} "quoted" note',
  ...extra,
});
/** A rentals page embedding its apartments in Next.js flight data, as brodsky.com does. */
const brodskyPage = (units: unknown[]) =>
  `<html><script>self.__next_f.push(${JSON.stringify([1, '5:["$","div",null,{"units":' + JSON.stringify(units) + '}]\n'])})</script></html>`;
const brodskyBuilding = (street: string, city = 'New York') =>
  `<script type="application/ld+json">{"address":{"streetAddress":"${street}","addressLocality":"${city}"}}</script>`;
function brodskySite(units: unknown[], buildings: Record<string, string>) {
  const requests: string[] = [];
  const fetcher = (url: string) => {
    requests.push(url);
    const path = new URL(url).pathname;
    const body = path === '/rentals' ? brodskyPage(units) : (buildings[path.split('/').at(-1) ?? ''] ?? '<html></html>');
    return new Response(body, { headers: { 'Content-Type': 'text/html' } });
  };
  return { fetcher, requests };
}

test('Brodsky: every apartment on its rentals page, with each building’s address from its own page', async () => {
  const units = [
    brodskyUnit('one-a', 'one-columbus-place'),
    brodskyUnit('one-b', 'one-columbus-place', { apartmentName: 'S16F' }),
    brodskyUnit('city-1', 'city-tower'),
  ];
  const { fetcher, requests } = brodskySite(units, {
    'one-columbus-place': brodskyBuilding('One Columbus Place'),
    'city-tower': brodskyBuilding('10 City Point', 'Brooklyn'),
  });
  const result = await loadBrodsky(fetcher, now);
  expect(result).toMatchObject({ total: 3, rawCount: 3, pages: 3, transport: 'brodsky-rentals-page' });
  // One request per building, not per apartment.
  expect(requests).toHaveLength(3);
  expect(result.listings.map(({ address, city, unit }) => [address, city, unit])).toEqual([
    ['One Columbus Place', 'Manhattan', 'S37A'],
    ['One Columbus Place', 'Manhattan', 'S16F'],
    ['10 City Point', 'Brooklyn', 'S37A'],
  ]);
  expect(result.listings[0]?.sources[0]?.url).toBe('https://www.brodsky.com/rentals/lincoln-square/one-columbus-place/one-a');
});

test('Brodsky: an empty or partly described page, or a building without an address, saves nothing', async () => {
  await expect(loadBrodsky(brodskySite([], {}).fetcher, now)).rejects.toThrow('recognized rentals page');
  expect(() => parseBrodskyRentals(brodskyPage([brodskyUnit('x', 'tower', { minimumRent: null })]))).toThrow('did not fully describe');
  expect(() => parseBrodskyRentals(brodskyPage([brodskyUnit('x', '../etc')]))).toThrow('did not fully describe');
  await expect(loadBrodsky(brodskySite([brodskyUnit('x', 'tower')], {}).fetcher, now)).rejects.toThrow('building’s address');
  expect(parseBrodskyBuilding(brodskyBuilding('12 East 86th Street'))).toEqual({ address: '12 East 86th Street', city: 'Manhattan' });
  expect(brodskyListingUrl('https://www.brodsky.com/rentals/a/b/c?x=1')).toBe('https://www.brodsky.com/rentals/a/b/c');
  for (const url of ['https://evil.example/rentals/a/b/c', 'https://www.brodsky.com/sales/a/b/c', 'https://www.brodsky.com/rentals/a/b'])
    expect(brodskyListingUrl(url)).toBeNull();
});
