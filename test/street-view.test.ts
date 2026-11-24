import { expect, test } from 'bun:test';
import { reserveStreetViewImage, STREET_VIEW_DEFAULT_MONTHLY_LIMIT, streetViewLimit } from '../server/street-view.ts';
import { handleApi } from './fixtures/api.ts';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { readJson } from './fixtures/json.ts';
import './fixtures/quiet-logs.ts';

const KEY = 'test-maps-key';
const PNG = new Uint8Array([137, 80, 78, 71]);

/** Google's two Street View endpoints, faked: the metadata check and the image. */
function google({ status = 'OK', image = true }: { status?: string; image?: boolean } = {}) {
  const requests: URL[] = [];
  const fetcher = async (url: string) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.endsWith('/metadata')) return Response.json({ status });
    return image ? new Response(PNG, { headers: { 'content-type': 'image/jpeg' } }) : new Response('quota', { status: 403 });
  };
  return { fetcher, requests, images: () => requests.filter((url) => !url.pathname.endsWith('/metadata')).length };
}

const get = (query: string) => new Request('https://app.test/api/street-view?' + query);

test('the monthly cap is a whole number from 0 to 100,000, and 9,000 otherwise', () => {
  expect(streetViewLimit(undefined)).toBe(STREET_VIEW_DEFAULT_MONTHLY_LIMIT);
  expect(STREET_VIEW_DEFAULT_MONTHLY_LIMIT).toBeLessThan(10_000);
  for (const value of ['', ' ', 'x', '1.5', '-1', '100001']) expect(streetViewLimit(value)).toBe(9000);
  expect(streetViewLimit('0')).toBe(0);
  expect(streetViewLimit('2500')).toBe(2500);
});

test('each image counts against its month, and none is counted past the cap', async () => {
  const { d1 } = await fakeD1();
  expect(await reserveStreetViewImage(d1, '2026-11', 0)).toBe(false);
  for (let index = 0; index < 3; index++) expect(await reserveStreetViewImage(d1, '2026-11', 3)).toBe(true);
  expect(await reserveStreetViewImage(d1, '2026-11', 3)).toBe(false);
  expect(await reserveStreetViewImage(d1, '2026-12', 3)).toBe(true);
  const rows = await d1.prepare('SELECT month, images FROM street_view_usage ORDER BY month').all<{ month: string; images: number }>();
  expect(rows.results).toEqual([
    { month: '2026-11', images: 3 },
    { month: '2026-12', images: 1 },
  ]);
});

test('a card gets Google’s image only where Street View has one, within the free monthly cap', async () => {
  const { d1 } = await fakeD1();
  const env = { GOOGLE_MAPS_API_KEY: KEY, STREET_VIEW_MONTHLY_LIMIT: '2' };
  const street = google();
  const response = await handleApi(get('lat=40.7306123&lng=-73.9866456'), env, { database: d1, fetcher: street.fetcher });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/jpeg');
  expect(response.headers.get('cache-control')).toBe('private, max-age=86400');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  // The point is rounded so one building's cards share an image; the key goes to Google, never to the page.
  const [metadata, image] = street.requests;
  expect(metadata?.searchParams.get('location')).toBe('40.73061,-73.98665');
  expect(image?.searchParams.get('key')).toBe(KEY);
  expect(image?.searchParams.get('size')).toBe('640x400');

  // No imagery there: only the free metadata check runs, and nothing is counted.
  const empty = google({ status: 'ZERO_RESULTS' });
  const none = await handleApi(get('lat=40.7&lng=-73.9'), env, { database: d1, fetcher: empty.fetcher });
  expect(none.status).toBe(404);
  expect(empty.images()).toBe(0);

  // The second image is the month's last; the third is refused before Google is asked for it.
  expect((await handleApi(get('lat=40.71&lng=-73.91'), env, { database: d1, fetcher: google().fetcher })).status).toBe(200);
  const past = google();
  const capped = await handleApi(get('lat=40.72&lng=-73.92'), env, { database: d1, fetcher: past.fetcher });
  expect(capped.status).toBe(429);
  expect((await readJson<{ error: string }>(capped)).error).toMatch(/free Street View images are used up/);
  expect(past.images()).toBe(0);
});

test('Street View says when it is not set up, the point is wrong, or Google does not answer with an image', async () => {
  const { d1 } = await fakeD1();
  const env = { GOOGLE_MAPS_API_KEY: KEY };
  expect((await handleApi(get('lat=40.7&lng=-73.9'), {}, { database: d1, fetcher: google().fetcher })).status).toBe(404);
  expect((await handleApi(get('lat=40.7&lng=-73.9'), env, { fetcher: google().fetcher })).status).toBe(404);
  for (const query of ['lat=95&lng=-73.9', 'lat=40.7&lng=-190', 'lat=x&lng=1', 'lat=40.7'])
    expect((await handleApi(get(query), env, { database: d1, fetcher: google().fetcher })).status).toBe(422);
  // A failed metadata check reads as no image.
  const down = async () => new Response('busy', { status: 503 });
  expect((await handleApi(get('lat=40.7&lng=-73.9'), env, { database: d1, fetcher: down })).status).toBe(404);
  const garbled = async () => new Response('not json');
  expect((await handleApi(get('lat=40.7&lng=-73.9'), env, { database: d1, fetcher: garbled })).status).toBe(404);
  expect((await handleApi(get('lat=40.7&lng=-73.9'), env, { database: d1, fetcher: google({ image: false }).fetcher })).status).toBe(502);
  const textImage = async (url: string) =>
    url.includes('/metadata') ? Response.json({ status: 'OK' }) : new Response('<html>', { headers: { 'content-type': 'text/html' } });
  expect((await handleApi(get('lat=40.7&lng=-73.9'), env, { database: d1, fetcher: textImage })).status).toBe(502);
  const unreachable = async () => {
    throw new Error('network down');
  };
  expect((await handleApi(get('lat=40.7&lng=-73.9'), env, { database: d1, fetcher: unreachable })).status).toBe(502);
});

test('the app learns from its config whether Street View is set up', async () => {
  const config = (env: Record<string, string>) =>
    readJson<{ streetViewAvailable: boolean }>(handleApi(new Request('https://app.test/api/config'), env));
  expect((await config({})).streetViewAvailable).toBe(false);
  expect((await config({ GOOGLE_MAPS_API_KEY: KEY })).streetViewAvailable).toBe(true);
});
