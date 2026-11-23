import { instanceOf, required } from './test-values.ts';
import { expect, test } from 'bun:test';
import { loadHdcRerentals } from '../server/hdc-rerentals.ts';
import { parseZillowPage, ZILLOW_LIVE } from '../server/zillow.ts';
import { parseRealtorPage, REALTOR_LIVE } from '../server/realtor.ts';
import { retryablePublicSources, decodeSourceImport, encodeSourceImport } from '../src/source-import.ts';
import { rentSeries } from '../src/rent-history.ts';
import { bundledRentHistory } from '../src/bundled-market.ts';
const stamp = '2026-11-17T00:00:00Z';
const hdc = (rows: unknown[], pages = 1, perPage = 2, total = rows.length, page = 1) => ({
  json: rows,
  pagination: { 'current-page': page, 'page-count': pages, 'per-page': perPage, 'total-results': total },
});
const opportunity = {
  nid: '123',
  title: 'Example rental',
  pdf: '/sites/default/files/example.pdf',
  address: '1 Main Street',
  borough: 'Brooklyn',
};
test('HDC validates transport, shape and pagination independently', async () => {
  await expect(loadHdcRerentals(async () => new Response('', { status: 503 }))).rejects.toThrow(/HTTP 503/);
  for (const payload of [{}, hdc([], 1, 2, 0, 2), hdc([], -1), hdc([], 1, 0), hdc([], 1, 51), hdc([], 1, 2, -1), hdc([], 2, 2, 1)]) {
    await expect(loadHdcRerentals(async () => Response.json(payload))).rejects.toThrow(/recognized|pagination/);
  }
  expect(await loadHdcRerentals(async () => Response.json(hdc([], 0)))).toStrictEqual({ results: [], total: 0, limited: false });
  await expect(loadHdcRerentals(async () => Response.json(hdc([{ nid: 'x' }])))).rejects.toThrow(/usable listings/);
});
test('HDC follows offsets, deduplicates IDs and preserves safe PDF and CTA fallbacks', async () => {
  const urls: string[] = [];
  const result = await loadHdcRerentals(async (url) => {
    urls.push(url);
    return Response.json(
      urls.length === 1
        ? hdc([opportunity, { ...opportunity, nid: '456', pdf: null, cta: 'https://example.com/apply' }], 2, 2, 4)
        : hdc([opportunity, { nid: 789, title: null, cta: 'javascript:alert(1)' }], 2, 2, 4, 2),
    );
  });
  expect(result.results.length).toBe(2);
  expect(result.limited).toBe(true);
  expect(urls[1]).toMatch(/current-page=2&offset=2/);
  expect(required(result.results[0]).url).toBe('https://www.nychdc.com/sites/default/files/example.pdf');
  expect(required(result.results[1]).url).toBe('https://example.com/apply');
  expect(required(result.results[1]).rent).toBe('');
});
const zmarket = { city: 'Jersey City', state: 'NJ', region: 'nj' };
const zrow = {
  detailUrl: '/homedetails/12-Grove-St/123_zpid/',
  statusType: 'FOR_RENT',
  hdpData: { homeInfo: { homeType: 'APARTMENT', zpid: 123 } },
  latLong: { latitude: 40.72, longitude: -74.04 },
  addressState: 'NJ',
  addressCity: 'Jersey City',
  addressZipcode: '07302',
  addressStreet: '12 Grove Street',
  beds: 1,
  unformattedPrice: 2400,
};
const zhtml = (rows: unknown[]) =>
  `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { searchPageState: { cat1: { searchResults: { listResults: rows } } } } } })}</script>`;
test('Zillow accepts apartment facts, fee flag and rejects unsafe or ineligible rows', () => {
  expect(() => parseZillowPage('', zmarket, stamp)).toThrow(/recognized/);
  const valid = parseZillowPage(zhtml([zrow, { ...zrow, zpid: 456, listPriceIncludesRequiredMonthlyFees: true }]), zmarket, stamp);
  expect(valid.length).toBe(2);
  expect(valid[0].rent).toBe(2400);
  expect(valid[0].priceIncludesFees).toBe(false);
  expect(valid[1].priceIncludesFees).toBe(true);
  for (const patch of [
    { detailUrl: 'https://evil.example/homedetails/x/1_zpid/' },
    { statusType: 'FOR_SALE' },
    { isBuilding: true },
    { isUndisclosedAddress: true },
    { hdpData: {} },
    { statusText: 'room for rent' },
    { addressState: 'NY' },
    { addressCity: 'Newark' },
    { latLong: {} },
    { addressZipcode: 'bad' },
    { unformattedPrice: 0 },
    { beds: 9 },
  ]) {
    expect(parseZillowPage(zhtml([{ ...zrow, ...patch }]), zmarket, stamp)).toStrictEqual([]);
  }
});
const rmarket = { city: 'Queens', region: 'nyc' };
const rrow = {
  permalink: '12-Test-St_M123-456',
  status: 'for_rent',
  description: { type: 'apartment', beds: 1 },
  list_price: 2400,
  listing_id: '1',
  location: {
    address: { line: '12 Test Street', state_code: 'NY', postal_code: '11101', city: 'Queens', coordinate: { lat: 40.75, lon: -73.94 } },
  },
};
const rhtml = (rows: unknown[]) => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { properties: rows } } })}</script>`;
test('Realtor accepts eligible rentals and rejects pending, non-apartment and corrupt facts', () => {
  expect(() => parseRealtorPage('', rmarket, stamp)).toThrow(/recognized/);
  expect(parseRealtorPage(rhtml([rrow]), rmarket, stamp)[0].rent).toBe(2400);
  for (const patch of [
    { permalink: null },
    { status: 'sold' },
    { flags: { is_pending: true } },
    { description: { type: 'house', beds: 1 } },
    { description: { type: 'apartment', beds: 1.5 } },
    { list_price: 2801 },
    { list_price: 0 },
    { location: {} },
  ])
    expect(parseRealtorPage(rhtml([{ ...rrow, ...patch }]), rmarket, stamp)).toStrictEqual([]);
  for (const patch of [{ state_code: 'NJ' }, { postal_code: 'bad' }, { line: 'unknown' }, { coordinate: {} }, { city: 'elsewhere' }]) {
    const market = patch.city ? { city: 'White Plains', region: 'metroNorth' } : rmarket;
    expect(
      parseRealtorPage(rhtml([{ ...rrow, location: { address: { ...rrow.location.address, ...patch } } }]), market, stamp),
    ).toStrictEqual([]);
  }
});
test('provider loaders reject blocked transport rather than inventing inventory', async () => {
  for (const provider of [ZILLOW_LIVE, REALTOR_LIVE])
    await expect(provider.load(async () => new Response('', { status: 403 }), new Date(stamp))).rejects.toThrow(/403/);
});
test('source retry policy excludes future retries, successful and unsupported providers', () => {
  expect(retryablePublicSources({}, new Date(stamp))).toStrictEqual([]);
  expect(
    retryablePublicSources(
      {
        sources: [
          { id: 'firstmover', status: 'failed' },
          { id: 'housingconnect', status: 'failed', retryAt: '2099-01-01' },
          { id: 'unknown', status: 'failed' },
          { id: 'housingconnect', status: 'updated' },
        ],
      },
      new Date(stamp),
    ),
  ).toStrictEqual(['firstmover']);
  for (const value of [null, [], false]) expect(() => decodeSourceImport(encodeSourceImport(value))).toThrow(/invalid/);
  expect(() => decodeSourceImport({ payload: 'AAAA' })).toThrow(/invalid/);
});
test('bundled history preserves absent months and missing bedroom observations', () => {
  const history = bundledRentHistory('1900-06', 'missing', 'zip');
  expect(history.length).toBe(5);
  expect(history[0]).toStrictEqual(['1900-01', []]);
  expect(
    rentSeries({ id: 'x', label: 'X', detail: '', count: 1, sizes: [{ median: 2000, count: 1 }] }, 0, '1900-06', history)[0],
  ).toStrictEqual({ month: '1900-01', median: null, count: 0 });
});

import { parseListingImport } from '../src/import-listings.ts';
import { parseRentHopPage, RENTHOP_LIVE } from '../server/renthop.ts';
import { parseAffordableRentals, AFFORDABLE_LIVE } from '../server/affordable-rentals.ts';
test('CSV rejects missing/duplicate columns, empty files and invalid optional coordinates', () => {
  const header = 'url,address,unit,city,state,zip,bedrooms,rent';
  for (const csv of ['', header, header + ',rent\n', header + '\nhttps://example.com,1 Main,,Brooklyn,NY,11201,1,1000,extra'])
    expect(() => parseListingImport(csv)).toThrow();
  for (const coords of ['40,', 'x,-73', '91,-73'])
    expect(() =>
      parseListingImport(`${header},latitude,longitude\nhttps://example.com,1 Main,,Brooklyn,NY,11201,1,1000,${coords}`),
    ).toThrow(/coordinates/);
  expect(parseListingImport(`${header},latitude,longitude\nhttps://example.com,1 Main,,Brooklyn,NY,11201,1,1000,40,-73`)[0].latitude).toBe(
    40,
  );
});
const hopCard = `<div id="listing-1"><a id="listing-1-title" href="/listings/example/1">12 Test Street</a><div id="listing-1-neighborhoods">Example, Brooklyn</div><div>11201</div><div id="listing-1-price">$2,000</div><div><img alt="bedrooms"></div><div>Studio</div><span latitude="40.7" longitude="-73.9"></span><div id="listing-1-padding">`;
test('RentHop parses studio facts and refuses shared rooms, over-budget and incomplete cards', async () => {
  expect(() => parseRentHopPage('', { budget: 2200 }, stamp)).toThrow(/recognized/);
  const listings = parseRentHopPage(hopCard, { budget: 2200 }, stamp);
  expect(listings.length).toBe(1);
  expect(listings[0].bedrooms).toBe(0);
  expect(listings[0].rent).toBe(2000);
  expect(parseRentHopPage(hopCard.replace('Studio', '1 Bed'), { budget: 2200 }, stamp)[0].bedrooms).toBe(1);
  for (const card of [
    hopCard.replace('12 Test Street', '12 shared apartment'),
    hopCard.replace('11201', '00000'),
    hopCard.replace('$2,000', '$3,000'),
    hopCard.replace('latitude=', 'absent='),
    hopCard.replace('/listings/example/1', 'https://evil.example/listings/example/1'),
    hopCard.replace('Studio', 'unknown'),
  ])
    expect(parseRentHopPage(card, { budget: 2200 }, stamp)).toStrictEqual([]);
  await expect(RENTHOP_LIVE.load(async () => new Response('', { status: 403 }), new Date(stamp))).rejects.toThrow(/403/);
});
const affordableCard = `<article data-listing-card-type="rental"><span class="green--text"><em></em>Available Now</span><span class="details-category">Apartment</span><a data-track="listing-card-link" href="/brooklyn-ny/test-123/"></a><div class="tnresult--propertyaddress">12 Test Street, Brooklyn, NY 11201</div><div class="card--price">$2,000</div><div class="card--details"><span>Studio</span></div><div class="card--tmlp--text"><div>Total Monthly Price</div></div></article>`;
test('AffordableHousing recognizes availability, borough restrictions and disclosed fee inclusion', async () => {
  const market = { city: 'Brooklyn', state: 'NY', region: 'nyc' };
  expect(() => parseAffordableRentals('', market, stamp)).toThrow(/recognized/);
  const result = parseAffordableRentals(affordableCard, market, stamp);
  expect(result.length).toBe(1);
  expect(result[0].priceIncludesFees).toBe(true);
  expect(result[0].bedrooms).toBe(0);
  expect(
    parseAffordableRentals(
      affordableCard.replace('Studio</span>', '1 <span>beds</span>').replace('Total Monthly Price', 'Rent'),
      market,
      stamp,
    )[0].priceIncludesFees,
  ).toBe(false);
  for (const card of [
    affordableCard.replace('Available Now', 'Unavailable'),
    affordableCard.replace('Apartment', 'House'),
    affordableCard.replace('11201', '10001'),
    affordableCard.replace('NY 11201', 'NJ 11201'),
    affordableCard.replace('$2,000', 'unknown'),
    affordableCard.replace('Studio', 'unknown'),
    affordableCard.replace('/brooklyn-ny/test-123/', 'javascript:alert(1)'),
  ])
    expect(parseAffordableRentals(card, market, stamp)).toStrictEqual([]);
  await expect(AFFORDABLE_LIVE.load(async () => new Response('', { status: 403 }), new Date(stamp))).rejects.toThrow(/403/);
});

import { geocodeRentalAddresses } from '../server/geocode-rentals.ts';
import { fetchPublicHtml, publicListingUrl } from '../server/public-rentals.ts';
test('geocoding retains source facts on failure and accepts only exact in-region coordinates', async () => {
  let calls = 0;
  expect(
    await geocodeRentalAddresses([], async () => {
      calls++;
      throw new Error('Unexpected fixture fetch');
    }),
  ).toStrictEqual([]);
  expect(calls).toBe(0);
  const listings = [
    { id: 'a', address: '1 "Test" Street', city: 'Manhattan', state: 'NY', zip: '10001' },
    { id: 'b', address: '2 Test Street', city: 'Brooklyn', state: 'NY', zip: '11201' },
  ];
  expect(await geocodeRentalAddresses(listings, async () => new Response('', { status: 503 }))).toStrictEqual(listings);
  const result = await geocodeRentalAddresses(listings, async (_url: string, options?: RequestInit) => {
    const body = instanceOf(required(options).body, FormData);
    const addressFile = instanceOf(body.get('addressFile'), Blob);
    expect(await addressFile.text()).toMatch(/New York/);
    return new Response('a,,Match,Exact,,"-73.9,40.7"\nb,,No_Match,Exact\nb,,Match,Non_Exact\nb,,Match,Exact,,"-90,40"\nb,,Match,Exact\n');
  });
  expect(result[0].latitude).toBe(40.7);
  expect(result[1].latitude).toBeUndefined();
});
test('HTML fetch rejects unsupported content and oversized declared and streamed bodies', async () => {
  expect(publicListingUrl('http://[', 'https://example.com', /^\//)).toBeNull();
  for (const response of [
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    new Response(null, { headers: { 'content-type': 'text/html' } }),
    new Response('x', { headers: { 'content-type': 'text/html', 'content-length': '6000000' } }),
  ])
    await expect(fetchPublicHtml(async () => response, 'https://example.com', 'Example')).rejects.toThrow(/supported/);
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    fetchPublicHtml(async () => new Response(body, { headers: { 'content-type': 'text/html' } }), 'https://example.com', 'Example'),
  ).rejects.toThrow(/too large/);
  expect(cancelled).toBe(true);
});

test('the browser can read every public export the retry check names', async () => {
  const { PUBLIC_SOURCE_IDS } = await import('../src/source-import.ts');
  const { pullPublicSources } = await import('../src/pull-sources.ts');
  const results = await pullPublicSources({}, async () => {
    throw new Error('offline');
  });
  expect(Object.keys(results)).toStrictEqual(PUBLIC_SOURCE_IDS);
});
