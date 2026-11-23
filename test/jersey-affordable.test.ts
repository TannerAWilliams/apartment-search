import { expect, test } from 'bun:test';
import {
  JERSEY_AFFORDABLE,
  JERSEY_PAGE,
  loadJerseyAffordable,
  parseJerseyAffordable,
  storedJerseyAffordable,
} from '../server/sources/jersey-affordable.ts';
import { configuredFeeds } from '../server/sources/listings.ts';
import { refreshSources } from '../server/refresh.ts';
import type { HousingResponse } from '../server/contracts.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { required } from './test-values.ts';

const now = new Date('2026-11-19T12:00:00Z');
const notice = (name: string, address: string, counts: string) =>
  `<p><strong>"${name}"</strong><br>"${name}" is located at ${address}, Jersey City, NJ 07302. This building has ${counts} available.</p>`;
const notices = [
  notice('Casa One', '166 Van Reipen Ave.', '7 studio apartments, 10 one-bedroom apartments, and 1 three-bedroom apartment'),
  notice('Modera Lofts', '350 Warren St.', 'a studio apartment and 1 one-bedroom apartment and 2 two-bedroom apartments'),
  notice('40 Lembeck', '40 Lembeck Ave.', '2 two-bedroom apartments and 1 three-bedroom apartment'),
  notice('485 Marin', '485 Marin Blvd.', '3 studio apartments, 7 one-bedroom apartments, and 2 two-bedroom apartment'),
];
const page = (items = notices.join(''), date = '11-16-2026') =>
  `<div><h4><span>Current Affordable Housing Postings</span></h4><p>Flyer Attachment (Updated ${date}; 12 PM EST)</p><a href="https://affordablehousingjc.com/">Apply</a>${items}</div>`;
const html = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/html' } });

test('notices keep the bedroom counts the city publishes, without prices or deadlines', () => {
  const data = parseJerseyAffordable(page(), now);
  expect(data.revision).toBe('2026-11-16');
  expect(data.notices).toHaveLength(4);
  expect(data.total).toBe(37);
  expect(required(data.notices[1]).sizes).toEqual([1, 1, 2, 0, 0]);
  expect(Object.keys(required(data.notices[0])).sort()).toEqual(['address', 'id', 'name', 'sizes', 'total']);
});

test('an empty or changed page, or an impossible or future revision, fails rather than reporting zero', () => {
  for (const value of [
    page(''),
    page().replace('Current Affordable Housing Postings', 'Unavailable'),
    page().replace(JERSEY_PAGE, '').replace('https://affordablehousingjc.com/', 'https://example.com'),
    page(undefined, '02-30-2026'),
    page(undefined, '12-01-2026'),
    page().replace('Updated', 'Posted'),
  ]) {
    expect(() => parseJerseyAffordable(value, now)).toThrow();
  }
});

test('duplicate, partial or unfamiliar counts fail closed', () => {
  for (const value of [
    page(notices[0] + notices[0]),
    page().replace('7 studio apartments', 'seven studio apartments'),
    page().replace('7 studio apartments', '0 studio apartments'),
    page().replace('7 studio apartments', '1 studio apartment and 7 studio apartments'),
    page().replace('07302. This building', 'invalid. This building'),
    page().replace('is located at 40', 'stands at 40'),
  ]) {
    expect(() => parseJerseyAffordable(value, now)).toThrow();
  }
});

test('a heading elsewhere on the page cannot supply the revision or the application link', () => {
  const outside = '<h4>Other content</h4><p>Updated 11-16-2026;</p><a href="https://affordablehousingjc.com/">Apply</a>';
  expect(() => parseJerseyAffordable(outside + '<h4>Current Affordable Housing Postings</h4>' + notices[0] + '</div>', now)).toThrow();
  expect(parseJerseyAffordable(outside + page(), now).total).toBe(37);
});

test('the loader reads only the official page and refuses errors and other content types', async () => {
  for (const response of [new Response('blocked', { status: 403 }), Response.json({})])
    await expect(loadJerseyAffordable(() => response, now)).rejects.toThrow();
  const data = await loadJerseyAffordable((url, init) => {
    expect(url).toBe(JERSEY_PAGE);
    expect(init?.redirect).toBe('manual');
    return html(page());
  }, now);
  expect(data.total).toBe(37);
});

test('a refresh saves the postings, the housing API returns them, and a failed check keeps the last good copy', async () => {
  const bucket = createMemoryBucket();
  const env = { BUCKET: bucket };
  const check = await refreshSources(env, { onDemand: true, sourceId: JERSEY_AFFORDABLE.id, now, fetcher: () => html(page()) });
  expect(check.sources?.find(({ id }) => id === JERSEY_AFFORDABLE.id)).toMatchObject({ status: 'updated', listingCount: 4 });
  const saved = required(await storedJerseyAffordable(bucket));
  expect(saved.total).toBe(37);

  const housing = await readJson<HousingResponse>(
    handleApi(new Request('https://app.test/api/housing'), env, {
      fetcher: () => {
        throw new Error('The API reads saved data only.');
      },
    }),
  );
  expect(housing.jersey).toEqual(saved);

  const failures = [new Response('down', { status: 503 }), html('<html>No postings</html>'), html(page(undefined, '11-15-2026'))];
  for (const [index, reply] of failures.entries()) {
    const failed = await refreshSources(env, {
      onDemand: true,
      sourceId: JERSEY_AFFORDABLE.id,
      now: new Date(`2026-11-${20 + index}T12:00:00Z`),
      fetcher: () => reply,
    });
    expect(failed.sources?.find(({ id }) => id === JERSEY_AFFORDABLE.id)?.status).toBe('failed');
    expect(await storedJerseyAffordable(bucket)).toEqual(saved);
  }
});

test('a saved copy that is not recognized reads as nothing saved', async () => {
  const bucket = createMemoryBucket();
  await bucket.put('rentals/jersey-affordable.json', JSON.stringify({ revision: 'soon' }));
  expect(await storedJerseyAffordable(bucket)).toBeNull();
  expect(await storedJerseyAffordable(undefined)).toBeNull();
});

test('a partner feed cannot take the Jersey City source ID', () => {
  expect(() =>
    configuredFeeds({
      FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ id: JERSEY_AFFORDABLE.id, name: 'Collision', url: 'https://example.com/feed.json' }]),
    }),
  ).toThrow();
});
