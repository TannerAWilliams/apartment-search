import { expect, test } from 'bun:test';
import { decideDirect, directListings, LISTED_DAYS, readDirect, submitDirect } from '../server/direct-listings.ts';
import { handleApi } from './fixtures/api.ts';
import { readJson } from './fixtures/json.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import './fixtures/quiet-logs.ts';

const now = new Date('2026-11-24T12:00:00Z');
const input = {
  address: '214 Bedford Avenue',
  unit: '3R',
  zip: '11249',
  bedrooms: 1,
  rent: 3200,
  available: 'March 1',
  description: 'Sunny',
  email: 'owner@example.test',
  phone: '',
};
// OpenStreetMap's place lookup, answering with a point in Williamsburg.
const geocoder = async () => Response.json([{ lat: '40.7172', lon: '-73.9567', display_name: '214 Bedford Avenue, Brooklyn' }]);

const post = (body: unknown) =>
  new Request('https://app.test/api/direct', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

test('an owner submits, an admin approves, and the apartment shows in search for 60 days', async () => {
  const bucket = createMemoryBucket();
  const owner = { account: 'landlord@example.test', fetcher: geocoder };
  const admin = { account: 'admin@example.test', admin: true };
  const submitted = await readJson<{ entry: { id: string; status: string } }>(
    handleApi(post({ action: 'submit', listing: input }), { BUCKET: bucket }, owner),
  );
  expect(submitted.entry.status).toBe('pending');
  const id = submitted.entry.id;
  const pending = await readJson<{ mine: unknown[]; pending: unknown[] }>(
    handleApi(new Request('https://app.test/api/direct'), { BUCKET: bucket }, admin),
  );
  expect(pending.pending.length).toBe(1);
  expect(
    (await readJson<{ pending: unknown[] }>(handleApi(new Request('https://app.test/api/direct'), { BUCKET: bucket }, owner))).pending,
  ).toEqual([]);
  expect(await directListings(bucket, now), 'not before approval').toEqual([]);

  expect((await handleApi(post({ action: 'approve', id }), { BUCKET: bucket }, owner)).status, 'owners cannot approve').toBe(422);
  await decideDirect(bucket, id, 'approve', { admin: true, account: 'admin@example.test', now });
  const [listing] = await directListings(bucket, now);
  expect(listing).toMatchObject({
    id: 'walkup-direct:' + id,
    city: 'Brooklyn',
    region: 'nyc',
    rent: 3200,
    noFee: true,
    latitude: 40.7172,
    contact: { email: 'owner@example.test', available: 'March 1', description: 'Sunny' },
  });
  expect(listing?.sources[0]?.url).toStartWith('mailto:owner@example.test?subject=');
  // It joins every search.
  const found = await readJson<{ matches: { id: string }[] }>(
    handleApi(
      new Request('https://app.test/api/search', {
        method: 'POST',
        body: JSON.stringify({ region: 'brooklyn', bedrooms: 1, maxRent: null, liveOnly: true }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { BUCKET: bucket },
    ),
  );
  expect(found.matches.some(({ id: match }) => match === 'walkup-direct:' + id)).toBe(true);

  // After 60 days it leaves search until renewed.
  const later = new Date(now.getTime() + (LISTED_DAYS + 1) * 86_400_000);
  expect(await directListings(bucket, later)).toEqual([]);
  await decideDirect(bucket, id, 'renew', { admin: false, account: 'landlord@example.test', now: later });
  expect((await directListings(bucket, later)).length).toBe(1);
  await expect(decideDirect(bucket, id, 'remove', { admin: false, account: 'someone@example.test' })).rejects.toThrow(/not yours/);
  expect((await readJson<{ entry: null }>(handleApi(post({ action: 'remove', id }), { BUCKET: bucket }, owner))).entry).toBeNull();
  expect(await readDirect(bucket)).toEqual([]);
});

test('submissions are New York City only, limited, checked, and reviews can reject', async () => {
  const bucket = createMemoryBucket();
  await expect(submitDirect(bucket, 'a@example.test', { ...input, zip: '07302' }, geocoder, now)).rejects.toThrow(/New York City/);
  // A place lookup that fails leaves the listing off the map, not unlisted.
  const down = async () => new Response('busy', { status: 503 });
  const entry = await submitDirect(bucket, 'a@example.test', input, down, now);
  expect(entry.latitude).toBeNull();
  for (let index = 0; index < 4; index++) await submitDirect(bucket, 'a@example.test', input, geocoder, now);
  await expect(submitDirect(bucket, 'a@example.test', input, geocoder, now)).rejects.toThrow(/up to 5/);
  const rejected = await decideDirect(bucket, entry.id, 'reject', { admin: true, account: 'admin@example.test' });
  expect(rejected?.status).toBe('rejected');
  expect(
    (await decideDirect(bucket, entry.id, 'renew', { admin: true, account: 'admin@example.test' }))?.status,
    'a rejected one stays rejected',
  ).toBe('rejected');
  await expect(decideDirect(bucket, 'nope', 'approve', { admin: true, account: 'x' })).rejects.toThrow(/not found/);
  expect(
    (await handleApi(post({ action: 'submit', listing: { ...input, rent: 10 } }), { BUCKET: bucket }, { account: 'a@example.test' }))
      .status,
  ).toBe(422);
  expect((await handleApi(post({ action: 'submit', listing: input }), { BUCKET: bucket })).status).toBe(404);
  expect((await handleApi(new Request('https://app.test/api/direct'), { BUCKET: bucket })).status).toBe(404);
  await bucket.put('direct/listings.json', 'not json');
  expect(await readDirect(bucket)).toEqual([]);
});
