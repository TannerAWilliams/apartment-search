import { afterEach, mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './fixtures/fake-d1.ts';

// The Workers runtime module does not exist under Bun; the Workflow class only needs a base class.
mock.module('cloudflare:workers', () => ({
  WorkflowEntrypoint: class { env: unknown; constructor(_ctx: unknown, env: unknown) { this.env = env; } },
}));
const { default: worker } = await import('../server/cloudflare.ts');
const { createD1Bucket } = await import('../server/d1-bucket.ts');
const { SYNC_PROGRESS_KEY } = await import('../server/source-registry.ts');

const TOKEN = 'synthetic-access-token-0123456789';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
type Instance = { status: string };
async function environment({ publicApp = false, instances = new Map<string, Instance>(), createError = null as Error | null } = {}) {
  const { d1 } = await fakeD1();
  const created: { id: string; params: { delay: boolean; sources?: string[] } }[] = [];
  return {
    created, instances,
    env: {
      APARTMENTS: d1, APP_ACCESS_TOKEN: TOKEN, ...(publicApp ? { PUBLIC_APP: 'true' } : {}),
      ASSETS: { fetch: async (request: Request) => new Response('asset ' + new URL(request.url).pathname) },
      SYNC_WORKFLOW: {
        async create(options: { id: string; params: { delay: boolean; sources?: string[] } }) {
          if (createError) throw createError;
          created.push(options); instances.set(options.id, { status: 'queued' });
        },
        async get(id: string) {
          const instance = instances.get(id);
          if (!instance) throw new Error('not found');
          return { status: async () => instance };
        },
      },
    },
  };
}
const call = (env: object, path: string, init: RequestInit = {}, token: string | null = TOKEN) => worker.fetch(new Request('https://app.test' + path, {
  ...init, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...init.headers as Record<string, string> },
}), env as Parameters<typeof worker.fetch>[1]);
const post = (body: unknown, extra: Record<string, string> = {}) =>
  ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...extra } });

test('health and static assets are served without the API', async () => {
  const { env } = await environment();
  assert.equal(await (await call(env, '/health')).text(), 'ok');
  assert.equal(await (await call(env, '/index.html')).text(), 'asset /index.html');
});

test('the web app is served with its security policy, and only fingerprinted files are cached long-term', async () => {
  const { env } = await environment();
  const page = await call(env, '/');
  assert.match(page.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
  assert.equal(page.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(page.headers.get('Cache-Control'), 'private, no-cache');
  const bundle = await call(env, '/_expo/static/js/web/index-0123abcd.js');
  assert.equal(bundle.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  const missing = await call({ ...env, ASSETS: { fetch: async () => new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }) } }, '/_expo/static/gone.js');
  assert.equal(missing.headers.get('Cache-Control'), 'no-store', 'a missing file is never cached long-term');
});

test('the private app requires the access token for every request, assets included', async () => {
  const { env } = await environment();
  for (const path of ['/api/config', '/index.html', '/health']) {
    const denied = await call(env, path, {}, null);
    assert.equal(denied.status, 401, path);
    assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal((await call(env, '/api/config', {}, 'wrong-token')).status, 401);
  assert.equal((await call({ ...env, APP_ACCESS_TOKEN: '' }, '/api/config', {}, '')).status, 401, 'an unset token opens nothing');
  assert.equal((await call(env, '/api/config')).status, 200);
});

test('a public app accepts same-origin refresh checks but not imports or cross-origin writes', async () => {
  const { env } = await environment({ publicApp: true });
  assert.equal((await call(env, '/api/refresh', post({ check: 'now' }, { Origin: 'https://elsewhere.test' }), null)).status, 403);
  assert.equal((await call(env, '/api/refresh', { method: 'POST', body: 'not json', headers: { Origin: 'https://app.test' } }, null)).status, 400);
  const importing = await call(env, '/api/refresh', post({ payload: 'abc' }, { Origin: 'https://app.test' }), null);
  assert.equal(importing.status, 403);
  assert.match((await importing.json()).error, /cannot import/);
  assert.equal((await call(env, '/api/config', {}, null)).status, 200);
  assert.equal(await (await call(env, '/index.html', {}, null)).text(), 'asset /index.html');
});

test('oversized requests are refused and unexpected failures keep saved data', async () => {
  const { env } = await environment({ publicApp: true });
  const large = await call(env, '/api/search', { method: 'POST', body: 'x'.repeat(5000), headers: { 'Content-Type': 'application/json' } }, null);
  assert.equal(large.status, 413);
  const broken = { ...env, APARTMENTS: { prepare() { throw new Error('database down'); }, batch() { throw new Error('database down'); } } };
  const failed = await call(broken, '/api/config');
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /Saved source data could not be read/, 'a storage failure is not blamed on feed settings');
});

test('a manual resync of a complete source starts its Workflow job and reports it running', async () => {
  const { env, created } = await environment();
  const response = await call(env, '/api/refresh', post({ check: 'now', source: 'openigloo' }));
  assert.equal(response.status, 202);
  assert.equal(created.length, 1);
  assert.match(created[0].id, /^cityrealty-\d+-openigloo$/);
  assert.deepEqual(created[0].params, { delay: false, sources: ['openigloo'] });
  const status = await (await call(env, '/api/refresh')).json();
  assert.equal(status.checking, true);
  assert.equal(status.activeSource, 'openigloo', 'a single-source job is named by its id');
});

test('status names the source the Workflow recorded, and nothing once jobs finish', async () => {
  const instances = new Map<string, Instance>();
  const { env } = await environment({ instances });
  instances.set('cityrealty-' + Math.floor(Date.now() / 120_000), { status: 'running' });
  await createD1Bucket(env.APARTMENTS).put(SYNC_PROGRESS_KEY, JSON.stringify({ source: 'zumper-live' }));
  assert.equal((await (await call(env, '/api/refresh')).json()).activeSource, 'zumper-live');
  await createD1Bucket(env.APARTMENTS).put(SYNC_PROGRESS_KEY, JSON.stringify({ source: 'unknown-source' }));
  assert.equal((await (await call(env, '/api/refresh')).json()).activeSource, 'cityrealty-live', 'a full run falls back to its first source');
  for (const instance of instances.values()) instance.status = 'complete';
  assert.ok(!(await (await call(env, '/api/refresh')).json()).checking);
});

test('starting a job that already exists is accepted, but a failure with no job is reported', async () => {
  const duplicate = Object.assign(new Error('instance already exists'));
  const existing = await environment({ createError: duplicate });
  const id = 'cityrealty-' + Math.floor(Date.now() / 120_000) + '-zumper-live';
  existing.instances.set(id, { status: 'running' });
  assert.equal((await call(existing.env, '/api/refresh', post({ check: 'now', source: 'zumper-live' }))).status, 202);
  const failing = await environment({ createError: new Error('Workflows unavailable') });
  const failed = await call(failing.env, '/api/refresh', post({ check: 'now', source: 'zumper-live' }));
  assert.ok(failed.status >= 500, 'a job that could not start is reported as a server error');
});

test('provider requests keep redirects unfollowed, in the form Workers accept', async () => {
  const { env } = await environment();
  const redirects: (RequestRedirect | undefined)[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    redirects.push(init?.redirect);
    return new Response('unavailable', { status: 503 });
  }) as typeof fetch;
  await call(env, '/api/refresh', post({ check: 'now', source: 'housingconnect' }));
  assert.ok(redirects.length > 0, 'the refresh reached the provider');
  assert.ok(redirects.every((redirect) => redirect === 'manual'), String(redirects));
});

test('the dashboard archive is read once through the assets binding and cannot be downloaded directly', async () => {
  const { env } = await environment();
  const bytes = await Bun.file(new URL('../public/data/streeteasy-dashboard-2026-11-17.zip', import.meta.url)).bytes();
  let reads = 0;
  const ASSETS = { fetch: async (request: Request) => {
    if (!new URL(request.url).pathname.startsWith('/data/')) return new Response('asset');
    reads++;
    return new Response(bytes);
  } };
  const withArchive = { ...env, ASSETS };
  assert.equal((await call(withArchive, '/data/streeteasy-dashboard-2026-11-17.zip')).status, 404);
  assert.equal(reads, 0, 'a direct request never reaches the archive');
  assert.equal((await call(withArchive, '/api/dashboard?file=rentalIndex_All.csv')).status, 200);
  assert.equal((await call(withArchive, '/api/dashboard?file=totalInventory_All.csv')).status, 200);
  assert.equal(reads, 1, 'the archive is read and verified once');
  const missing = { ...env, ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } };
  assert.equal((await call(missing, '/api/dashboard?file=rentalIndex_All.csv')).status, 503);
});
