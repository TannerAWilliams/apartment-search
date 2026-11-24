import { afterEach, expect, test } from 'bun:test';
import { required } from './test-values.ts';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { readJson, type RpcRequest, sentJson } from './fixtures/json.ts';

const { CityRealtySync } = await import('../server/sync-workflow.ts');
const { createD1Bucket } = await import('../server/storage/d1-bucket.ts');
const { refreshStatus } = await import('../server/refresh/status.ts');
const { openiglooPacing } = await import('../server/sources/openigloo.ts');
const { SYNC_PROGRESS_KEY } = await import('../server/sources/source-registry.ts');

openiglooPacing.intervalMs = 0;
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Runs steps inline and records their names, like the Workflows runtime without durability. */
function steps() {
  const names: string[] = [];
  const sleeps: string[] = [];
  return {
    names,
    sleeps,
    step: {
      async do<T>(name: string, _config: unknown, callback: () => Promise<T>) {
        names.push(name);
        return callback();
      },
      async sleep(name: string) {
        sleeps.push(name);
      },
    },
  };
}

/** Openigloo's MCP server with an empty inventory. */
const emptyOpenigloo = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith('https://mcp.openigloo.com/')) throw new Error('Unexpected request to ' + url);
  const message = sentJson<RpcRequest>(init?.body);
  if (message.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } });
  if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
  return Response.json({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { total_matches: 0, apartments: [] } } });
}) as typeof fetch;

async function workflow() {
  const { d1 } = await fakeD1();
  const env = { APARTMENTS: d1 };
  return { env, bucket: createD1Bucket(d1), sync: new CityRealtySync({} as never, env as never) };
}

test('an Openigloo sync searches every part, records its progress and saves the inventory', async () => {
  globalThis.fetch = emptyOpenigloo;
  const { bucket, sync } = await workflow();
  const { step, names } = steps();
  const outcome = await sync.run(
    { payload: { delay: false, sources: ['openigloo'] }, instanceId: 'run-1', timestamp: new Date() },
    step as never,
  );
  expect(outcome).toStrictEqual({ openigloo: { state: 'complete', listingCount: 0 } });
  expect(names.filter((name) => name.startsWith('Search Openigloo part')).length).toBe(25);
  expect((await readJson<{ source: string }>(required(await bucket.get(SYNC_PROGRESS_KEY)))).source).toBe('openigloo');
  expect((await refreshStatus(bucket)).sources.find(({ id }) => id === 'openigloo')?.status).toBe('updated');
});

test('a failed source makes the run fail with that source named', async () => {
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
  const { sync } = await workflow();
  const { step, sleeps } = steps();
  await expect(
    sync.run({ payload: { delay: true, sources: ['openigloo', 'not-a-sync'] }, instanceId: 'run-2', timestamp: new Date() }, step as never),
  ).rejects.toThrow(/^Openigloo: /);
  expect(sleeps).toStrictEqual(['Give other sources time to start']);
});

test('CityRealty failures are reported, and the run waits out another refresh before giving up', async () => {
  globalThis.fetch = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  const failing = await workflow();
  await expect(
    failing.sync.run(
      { payload: { delay: false, sources: ['cityrealty-live'] }, instanceId: 'run-3', timestamp: new Date() },
      steps().step as never,
    ),
  ).rejects.toThrow(/^CityRealty: /);
  const busy = await workflow();
  await busy.bucket.put(
    'rentals/refresh.json',
    JSON.stringify({ running: true, startedAt: new Date().toISOString(), activeSource: 'cityrealty-live' }),
  );
  const { step, sleeps } = steps();
  await expect(
    busy.sync.run({ payload: { delay: false, sources: ['cityrealty-live'] }, instanceId: 'run-4', timestamp: new Date() }, step as never),
  ).rejects.toThrow(/Another source refresh is already running/);
  expect(sleeps.length).toBe(6);
});

test('saving Openigloo waits for another refresh to finish before giving up', async () => {
  globalThis.fetch = emptyOpenigloo;
  const { bucket, sync } = await workflow();
  await bucket.put(
    'rentals/refresh.json',
    JSON.stringify({ running: true, startedAt: new Date().toISOString(), activeSource: 'openigloo' }),
  );
  const { step, sleeps } = steps();
  await expect(
    sync.run({ payload: { delay: false, sources: ['openigloo'] }, instanceId: 'run-5', timestamp: new Date() }, step as never),
  ).rejects.toThrow(/Another source refresh is already running/);
  expect(sleeps.filter((name) => name.includes('saving Openigloo')).length).toBe(6);
});

test('a CityRealty check that is cooling down ends without an error', async () => {
  const { bucket, sync } = await workflow();
  const later = new Date(Date.now() + 60 * 60_000).toISOString();
  await bucket.put(
    'rentals/refresh.json',
    JSON.stringify({
      sources: [
        {
          id: 'cityrealty-live',
          name: 'CityRealty',
          status: 'failed',
          checkedAt: new Date().toISOString(),
          updatedAt: null,
          retryAt: later,
        },
      ],
    }),
  );
  const outcome = await sync.run(
    { payload: { delay: false, sources: ['cityrealty-live'] }, instanceId: 'run-6', timestamp: new Date() },
    steps().step as never,
  );
  expect(outcome).toStrictEqual({ 'cityrealty-live': { state: 'already_checked', listingCount: undefined } });
});

test('Openigloo is not saved when a search step left no results, or the results fall short of the total', async () => {
  globalThis.fetch = emptyOpenigloo;
  const { sync } = await workflow();
  // Skipping the search steps leaves no saved parts, as a lost step would.
  const skipping = {
    async do<T>(name: string, _config: unknown, callback: () => Promise<T>) {
      return name.startsWith('Search Openigloo part') ? (undefined as T) : callback();
    },
    async sleep() {},
  };
  await expect(
    sync.run({ payload: { delay: false, sources: ['openigloo'] }, instanceId: 'run-7', timestamp: new Date() }, skipping as never),
  ).rejects.toThrow(/search step from this sync is missing/);

  // Openigloo reports apartments it never returns.
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const message = sentJson<RpcRequest>(init?.body);
    if (message.method === 'initialize')
      return Response.json({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-11-25' } });
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: '2.0', id: message.id, result: { structuredContent: { total_matches: 4, apartments: [] } } });
  }) as typeof fetch;
  const short = await workflow();
  await expect(
    short.sync.run(
      { payload: { delay: false, sources: ['openigloo'] }, instanceId: 'run-8', timestamp: new Date() },
      steps().step as never,
    ),
  ).rejects.toThrow(/^Openigloo: /);
});

test('an Openigloo save that loses a race to another write reports that failure', async () => {
  globalThis.fetch = emptyOpenigloo;
  const { bucket, sync } = await workflow();
  bucket.snapshots.write = async () => null;
  await expect(
    sync.run({ payload: { delay: false, sources: ['openigloo'] }, instanceId: 'run-9', timestamp: new Date() }, steps().step as never),
  ).rejects.toThrow(/^Openigloo: The Openigloo inventory could not be refreshed/);
});

test('the nightly run checks listed buildings in five steps', async () => {
  const { afterFullRun } = await import('../server/sync-workflow.ts');
  globalThis.fetch = (async () => {
    throw new Error('city records unreachable');
  }) as unknown as typeof fetch;
  const { bucket } = await workflow();
  const { step, names } = steps();
  // The bundled sample inventory has New York City buildings; each batch takes the next 40.
  await expect(afterFullRun(step as never, { BUCKET: bucket }), 'open data unreachable').rejects.toThrow(/unreachable/);
  const skipping = {
    do: async (name: string, _config: unknown, callback: () => Promise<unknown>) => (
      names.push(name), name.startsWith('Refresh') ? [] : callback()
    ),
  };
  expect(await afterFullRun(skipping as never, { BUCKET: bucket })).toBe(200);
  expect(names).toStrictEqual([
    'Refresh rent registrations and subway stations',
    'Refresh rent registrations and subway stations',
    ...[1, 2, 3, 4, 5].map((batch) => `Check building records (${batch} of 5)`),
  ]);
});
