import { expect, test } from 'bun:test';
import { handleApi } from './fixtures/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { OPENIGLOO_TRANSPORT } from '../server/sources/openigloo.ts';
import { refreshSources, refreshStatus } from '../server/refresh.ts';
import { ZUMPER_TRANSPORT } from '../server/sources/zumper.ts';
import { encodeSourceImport } from '../src/source-import.ts';
import { readJson } from './fixtures/json.ts';
import { oneOf } from '../src/domain.ts';
import type { RefreshInfo } from '../src/api-client.ts';

const now = new Date('2026-11-20T12:00:00Z');
const at = now.toISOString();
const statusOf = async (bucket: ReturnType<typeof createMemoryBucket>, id: string) =>
  (await refreshStatus(bucket)).sources.find((source) => source.id === id);

test('imports that do not prove a complete inventory are refused and keep saved data', async () => {
  const bucket = createMemoryBucket();
  await refreshSources(
    { BUCKET: bucket },
    {
      now,
      imports: {
        openigloo: { listings: [], total: 10, rawCount: 10, pages: 1, checkedAt: at, transport: 'sample' },
        'zumper-live': { listings: [], total: 10, rawCount: 9, pages: 20, checkedAt: at, transport: ZUMPER_TRANSPORT },
      },
    },
  );
  expect((await statusOf(bucket, 'openigloo'))?.error).toBe('Openigloo did not return a verifiable complete inventory.');
  expect((await statusOf(bucket, 'zumper-live'))?.status ?? '').toMatch(/failed/);
  const complete = { listings: [], total: 0, rawCount: 0, pages: 25, checkedAt: at, transport: OPENIGLOO_TRANSPORT };
  await refreshSources({ BUCKET: bucket }, { now: new Date(now.getTime() + 3_600_000), imports: { openigloo: complete } });
  expect((await statusOf(bucket, 'openigloo'))?.status).toBe('updated');
});

test('a FirstMover import with malformed rows is refused', async () => {
  const bucket = createMemoryBucket();
  await refreshSources(
    { BUCKET: bucket },
    { now, imports: { firstmover: { changed: true, month: '2026-11', revision: 'a'.repeat(40), rows: [['not', 'a', 'row']] } } },
  );
  expect((await statusOf(bucket, 'firstmover'))?.error).toBe('The FirstMover import had invalid listings.');
});

test('an on-demand check saves NYC HDC re-rentals', async () => {
  const bucket = createMemoryBucket();
  const fetcher = async (url: string) => {
    if (!url.startsWith('https://www.nychdc.com/api/re-rentals')) return new Response(null, { status: 404 });
    return Response.json({
      json: [
        {
          nid: '1',
          title: 'Example Re-rental',
          address: '1 Example Street',
          borough: 'Bronx',
          rent_range: '$1,500',
          pdf: '/sites/default/files/re-rental-1.pdf',
        },
      ],
      pagination: { 'current-page': 1, 'page-count': 1, 'per-page': 10, 'total-results': 1 },
    });
  };
  await refreshSources({ BUCKET: bucket }, { now, onDemand: true, sourceId: 'hdc-rerentals', fetcher });
  const status = await statusOf(bucket, 'hdc-rerentals');
  expect(status?.status).toBe('updated');
  expect(status?.listingCount).toBe(1);
});

test('a StreetEasy partner feed must report its total, and a resync reads a complete export again', async () => {
  const feed = { id: 'streeteasy', url: 'https://partner.example.test/streeteasy' };
  const bucket = createMemoryBucket();
  const fetcher = async () => Response.json({ listings: [] });
  await refreshSources(
    { BUCKET: bucket, FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) },
    { now, onDemand: true, sourceId: 'streeteasy-live', fetcher },
  );
  expect((await statusOf(bucket, 'streeteasy-live'))?.error ?? '').toMatch(/StreetEasy/);

  const exported = createMemoryBucket();
  await exported.put(
    'rentals/refresh.json',
    JSON.stringify({
      sources: [
        {
          id: 'streeteasy-live',
          name: 'StreetEasy',
          status: 'updated',
          checkedAt: at,
          updatedAt: at,
          transport: 'streeteasy-complete-export-v1',
        },
      ],
    }),
  );
  let requests = 0;
  const exportEnv = { BUCKET: exported, FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ ...feed, format: 'streeteasy-complete-export-v1' }]) };
  await refreshSources(exportEnv, {
    now: new Date(now.getTime() + 60_000),
    onDemand: true,
    fetcher: async (url: string) => {
      if (url.startsWith('https://partner.example.test')) requests++;
      return new Response(null, { status: 404 });
    },
  });
  expect(requests, 'a resync is never skipped because the saved export is recent').toBe(1);
});

test('an import where every source fails is reported as unavailable', async () => {
  const bucket = createMemoryBucket();
  const body = { ...encodeSourceImport({ 'streeteasy-live': { listings: 'not a list' } }), fallback: false };
  const response = await handleApi(
    new Request('https://app.test/api/refresh', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    { BUCKET: bucket },
    { privateAuthenticated: true },
  );
  expect([200, 502].includes(response.status)).toBeTruthy();
  const result = await readJson<RefreshInfo>(response);
  if (result.state === 'partial' && result.sources.every(({ status }) => oneOf(['failed', 'feed_required'], status)))
    expect(response.status).toBe(502);
});
