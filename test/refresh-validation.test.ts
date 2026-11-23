import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { handleApi } from '../server/api.ts';
import { createMemoryBucket } from './fixtures/memory-bucket.ts';
import { OPENIGLOO_TRANSPORT } from '../server/openigloo.ts';
import { refreshSources, refreshStatus } from '../server/refresh.ts';
import { ZUMPER_TRANSPORT } from '../server/zumper.ts';
import { encodeSourceImport } from '../src/pull-sources.ts';

const now = new Date('2026-11-20T12:00:00Z');
const at = now.toISOString();
const statusOf = async (bucket: ReturnType<typeof createMemoryBucket>, id: string) => (await refreshStatus(bucket)).sources.find((source) => source.id === id);

test('imports that do not prove a complete inventory are refused and keep saved data', async () => {
  const bucket = createMemoryBucket();
  await refreshSources({ BUCKET: bucket }, { now, imports: {
    openigloo: { listings: [], total: 10, rawCount: 10, pages: 1, checkedAt: at, transport: 'sample' },
    'zumper-live': { listings: [], total: 10, rawCount: 9, pages: 20, checkedAt: at, transport: ZUMPER_TRANSPORT },
  } });
  assert.equal((await statusOf(bucket, 'openigloo'))?.error, 'Openigloo did not return a verifiable complete inventory.');
  assert.match((await statusOf(bucket, 'zumper-live'))?.status ?? '', /failed/);
  const complete = { listings: [], total: 0, rawCount: 0, pages: 25, checkedAt: at, transport: OPENIGLOO_TRANSPORT };
  await refreshSources({ BUCKET: bucket }, { now: new Date(now.getTime() + 3_600_000), imports: { openigloo: complete } });
  assert.equal((await statusOf(bucket, 'openigloo'))?.status, 'updated');
});

test('a FirstMover import with malformed rows is refused', async () => {
  const bucket = createMemoryBucket();
  await refreshSources({ BUCKET: bucket }, { now, imports: { firstmover: { changed: true, month: '2026-11', revision: 'a'.repeat(40), rows: [['not', 'a', 'row']] } } });
  assert.equal((await statusOf(bucket, 'firstmover'))?.error, 'The FirstMover import had invalid listings.');
});

test('an on-demand check saves NYC HDC re-rentals', async () => {
  const bucket = createMemoryBucket();
  const fetcher = async (url: string) => {
    if (!url.startsWith('https://www.nychdc.com/api/re-rentals')) return new Response(null, { status: 404 });
    return Response.json({ json: [{ nid: '1', title: 'Example Re-rental', address: '1 Example Street', borough: 'Bronx', rent_range: '$1,500', pdf: '/sites/default/files/re-rental-1.pdf' }],
      pagination: { 'current-page': 1, 'page-count': 1, 'per-page': 10, 'total-results': 1 } });
  };
  await refreshSources({ BUCKET: bucket }, { now, onDemand: true, sourceId: 'hdc-rerentals', fetcher });
  const status = await statusOf(bucket, 'hdc-rerentals');
  assert.equal(status?.status, 'updated');
  assert.equal(status?.listingCount, 1);
});

test('a StreetEasy partner feed must report its total, and a recent export is not fetched again', async () => {
  const feed = { id: 'streeteasy', url: 'https://partner.example.test/streeteasy' };
  const bucket = createMemoryBucket();
  const fetcher = async () => Response.json({ listings: [] });
  await refreshSources({ BUCKET: bucket, FREE_PARTNER_FEEDS_JSON: JSON.stringify([feed]) }, { now, onDemand: true, sourceId: 'streeteasy-live', fetcher });
  assert.match((await statusOf(bucket, 'streeteasy-live'))?.error ?? '', /StreetEasy/);

  const exported = createMemoryBucket();
  await exported.put('rentals/refresh.json', JSON.stringify({ sources: [{ id: 'streeteasy-live', name: 'StreetEasy', status: 'updated', checkedAt: at, updatedAt: at, transport: 'streeteasy-complete-export-v1' }] }));
  let requests = 0;
  const exportEnv = { BUCKET: exported, FREE_PARTNER_FEEDS_JSON: JSON.stringify([{ ...feed, format: 'streeteasy-complete-export-v1' }]) };
  await refreshSources(exportEnv, { now: new Date(now.getTime() + 60_000), onDemand: true, skipStreetEasy: false,
    fetcher: async (url: string) => { if (url.startsWith('https://partner.example.test')) requests++; return new Response(null, { status: 404 }); } });
  assert.equal(requests, 0, 'a recent complete export is reused');
});

test('an import where every source fails is reported as unavailable', async () => {
  const bucket = createMemoryBucket();
  const body = { ...encodeSourceImport({ 'streeteasy-live': { listings: 'not a list' } }), fallback: false };
  const response = await handleApi(new Request('https://app.test/api/refresh', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    { BUCKET: bucket }, { privateAuthenticated: true });
  assert.ok([200, 502].includes(response.status));
  const result = await response.json();
  if (result.state === 'partial' && result.sources.every(({ status }: { status: string }) => ['failed', 'feed_required'].includes(status))) assert.equal(response.status, 502);
});
