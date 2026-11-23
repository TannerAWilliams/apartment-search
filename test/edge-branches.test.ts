import { expect, test } from 'bun:test';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { createD1Bucket } from '../server/d1-bucket.ts';
import { checkFirstMover } from '../server/firstmover.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { refreshSources, refreshStatus } from '../server/refresh.ts';
import { requestForRefresh } from '../server/source-requests.ts';
import { AFFORDABLE_LIVE } from '../server/affordable-rentals.ts';
import { parseApartmentsPage } from '../server/apartments-com.ts';
import { safeListingUrl } from '../src/marketplaces.ts';
import { regionOf } from '../src/regions.ts';


test('values outside every supported area or URL rule are rejected quietly', () => {
  expect(safeListingUrl('https://[not a host')).toBeNull();
  expect(regionOf({ state: 'NY', zip: '12207' }), 'Albany').toBeNull();
  expect(regionOf({ state: 'TX', zip: '75201' })).toBeNull();
});

test('a D1 snapshot missing one of its parts is reported, not returned truncated', async () => {
  const { d1, sqlite } = await fakeD1();
  const bucket = createD1Bucket(d1);
  await bucket.put('two-parts', 'x'.repeat(3_000_000));
  sqlite.run("DELETE FROM apartment_object_parts WHERE key = 'two-parts' AND part = 1");
  await expect(bucket.get('two-parts')).rejects.toThrow(/snapshot is incomplete/);
});

test('the Cloudflare entry answers a request body that breaks off with an error, without crashing', async () => {
  const { default: worker } = await import('../server/cloudflare.ts');
  const { d1 } = await fakeD1();
  const body = new ReadableStream({ pull(controller) { controller.error(new Error('connection reset')); } });
  const response = await worker.fetch(new Request('https://app.test/api/search', { method: 'POST', body, duplex: 'half', headers: { Authorization: 'Bearer token-0123456789abcdef', 'Content-Type': 'application/json' } } as RequestInit),
    { APARTMENTS: d1, APP_ACCESS_TOKEN: 'token-0123456789abcdef', ASSETS: { fetch: async () => new Response() } } as never);
  expect(response.status).toBe(400);
  expect(await response.json()).toStrictEqual({ error: 'Send a JSON request.' });
});

test('FirstMover refuses a catalog whose newest monthly CSV is missing or too large', async () => {
  const fetcher = async () => Response.json([{ type: 'file', name: 'Listings-2026-10.csv', sha: 'a'.repeat(40), size: 500 * 1024 * 1024 }]);
  await expect(checkFirstMover(null, fetcher)).rejects.toThrow(/unavailable or too large/);
});

test('a StreetEasy partner feed whose rows are all unusable is not saved as an empty inventory', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket, FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: 'streeteasy', url: 'https://partner.example.test/se' }]) };
  await refreshSources(env, { now: new Date(), onDemand: true, sourceId: 'streeteasy-live', fetcher: async () => Response.json({ listings: [{ unusable: true }], total: 1 }) });
  const status = (await refreshStatus(bucket)).sources.find(({ id }) => id === 'streeteasy-live');
  expect(status?.status).toBe('failed');
});

test('a StreetEasy denial page that cannot be read still reports the denial', async () => {
  const body = new ReadableStream({ pull(controller) { controller.error(new Error('reset')); } });
  const request = requestForRefresh(async () => new Response(body, { status: 403 }), AbortSignal.timeout(5000));
  await expect(request('https://api-v6.streeteasy.com/', { method: 'POST' })).rejects.toMatchObject({ httpStatus: 403 });
});

test('Apartments.com cards with malformed share data are skipped, not fatal', () => {
  const page = '<script type="application/ld+json">' + JSON.stringify({ '@graph': [{ '@type': 'CollectionPage', mainEntity: { itemListElement: [{ item: {} }] } }] }) + '</script>' +
    `<article data-listing-key="abc1234" data-listing-share-lines='{not json'></article>`;
  expect(parseApartmentsPage(page, { borough: 'manhattan', bedrooms: 1 }, new Date().toISOString())).toStrictEqual([]);
});

test('AffordableHousing.com keeps its listings when geocoding is unavailable', async () => {
  const card = (city: string, zip: string) => `<article data-listing-card-type="standard"><span class="green--text"><em></em> Available Now</span>
    <span class="details-category">Apartment</span><a data-track="listing-card-link" href="/${city.toLowerCase()}-ny/example-apartments-123/"></a>
    <div class="tnresult--propertyaddress">10 Example Street, ${city}, NY ${zip}</div><div class="card--price">$2,000</div>
    <div class="card--details"><span>1 <span>bed</span></span></div></article>`;
  const pages: Record<string, string> = { 'new-york-ny': card('Manhattan', '10025'), 'brooklyn-ny': card('Brooklyn', '11215') };
  const fetcher = async (url: string) => {
    if (url.includes('geocoding')) throw new Error('geocoder down');
    const slug = new URL(url).pathname.split('/')[1];
    return new Response(pages[slug] ?? '<article data-listing-card-type="x"></article>', { headers: { 'content-type': 'text/html' } });
  };
  const result = await AFFORDABLE_LIVE.load(fetcher, new Date());
  expect(result.listings.length >= 1).toBeTruthy();
});
