import { afterEach, expect, test } from 'bun:test';
import { fakeD1 } from './fixtures/fake-d1.ts';
import { readJson, type ErrorBody } from './fixtures/json.ts';
import type { RefreshInfo } from '../src/api-client.ts';

// The Workers runtime module does not exist under Bun; the Workflow class only needs a base class.
const { default: worker } = await import('../server/cloudflare.ts');
const { createD1Bucket } = await import('../server/storage/d1-bucket.ts');
const { SYNC_PROGRESS_KEY } = await import('../server/sources/source-registry.ts');

const TOKEN = 'synthetic-access-token-0123456789';
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
type Instance = { status: string };
async function environment({ publicApp = false, instances = new Map<string, Instance>(), createError = null as Error | null } = {}) {
  const { d1 } = await fakeD1();
  const created: { id: string; params: { delay: boolean; sources?: string[] } }[] = [];
  return {
    created,
    instances,
    env: {
      APARTMENTS: d1,
      APP_ACCESS_TOKEN: TOKEN,
      ...(publicApp ? { PUBLIC_APP: 'true' } : {}),
      ASSETS: { fetch: async (request: Request) => new Response('asset ' + new URL(request.url).pathname) },
      SYNC_WORKFLOW: {
        async create(options: { id: string; params: { delay: boolean; sources?: string[] } }) {
          if (createError) throw createError;
          created.push(options);
          instances.set(options.id, { status: 'queued' });
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
const call = (env: object, path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
  worker.fetch(
    new Request('https://app.test' + path, {
      ...init,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(init.headers as Record<string, string>) },
    }),
    env as Parameters<typeof worker.fetch>[1],
  );
const post = (body: unknown, extra: Record<string, string> = {}) => ({
  method: 'POST',
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...extra },
});

test('health and static assets are served without the API', async () => {
  const { env } = await environment();
  expect(await (await call(env, '/health')).text()).toBe('ok');
  expect(await (await call(env, '/index.html')).text()).toBe('asset /index.html');
});

test('the web app is served with its security policy, and only fingerprinted files are cached long-term', async () => {
  const { env } = await environment();
  const page = await call(env, '/');
  expect(page.headers.get('Content-Security-Policy') ?? '').toMatch(/frame-ancestors 'none'/);
  expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(page.headers.get('Cache-Control')).toBe('private, no-cache, no-transform');
  const bundle = await call(env, '/_expo/static/js/web/index-0123abcd.js');
  expect(bundle.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
  const missing = await call(
    { ...env, ASSETS: { fetch: async () => new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }) } },
    '/_expo/static/gone.js',
  );
  expect(missing.headers.get('Cache-Control'), 'a missing file is never cached long-term').toBe('no-store');
});

test('the app’s own addresses get the app, and other missing files stay missing', async () => {
  const { env } = await environment();
  const onlyIndex = {
    ...env,
    ASSETS: {
      fetch: async (request: Request) =>
        new URL(request.url).pathname === '/' ? new Response('the app') : new Response('not found', { status: 404 }),
    },
  };
  const screen = await call(onlyIndex, '/profile');
  expect(await screen.text()).toBe('the app');
  expect(screen.headers.get('Cache-Control')).toBe('private, no-cache, no-transform');
  expect(await (await call(onlyIndex, '/listing/abc')).text()).toBe('the app');
  expect((await call(onlyIndex, '/nothing-here.png')).status).toBe(404);
});

test('visitors use the app without signing in; what belongs to an account, and resyncing, need one', async () => {
  const { env } = await environment();
  for (const path of ['/api/config', '/index.html', '/health']) expect((await call(env, path, {}, null)).status, path).toBe(200);
  // A wrong or unset token is a visitor, never the app's own scripts.
  for (const [given, token] of [
    [env, 'wrong-token'],
    [{ ...env, APP_ACCESS_TOKEN: '' }, ''],
  ] as const) {
    expect((await call(given, '/api/alerts', {}, token)).status).toBe(401);
    expect((await call(given, '/api/saved', {}, token)).status).toBe(404);
  }
  const resync = await call(
    env,
    '/api/refresh',
    { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://app.test' }, body: JSON.stringify({ check: 'now' }) },
    null,
  );
  expect(resync.status, 'a visitor cannot resync sources').toBe(403);
  expect((await call(env, '/api/config')).status).toBe(200);
});

test('a public app accepts same-origin refresh checks but not imports or cross-origin writes', async () => {
  const { env } = await environment({ publicApp: true });
  expect((await call(env, '/api/refresh', post({ check: 'now' }, { Origin: 'https://elsewhere.test' }), null)).status).toBe(403);
  expect(
    (await call(env, '/api/refresh', { method: 'POST', body: 'not json', headers: { Origin: 'https://app.test' } }, null)).status,
  ).toBe(400);
  const importing = await call(env, '/api/refresh', post({ payload: 'abc' }, { Origin: 'https://app.test' }), null);
  expect(importing.status).toBe(403);
  expect((await readJson<ErrorBody>(importing)).error).toMatch(/cannot import/);
  const checked = await call(env, '/api/refresh', post({ check: 'now', sessionStart: true }, { Origin: 'https://app.test' }), null);
  expect(checked.status, 'a plain check passes through to the API').toBe(200);
  expect((await readJson<RefreshInfo>(checked)).state).toBe('already_checked');
  expect((await call(env, '/api/config', {}, null)).status).toBe(200);
  expect(await (await call(env, '/index.html', {}, null)).text()).toBe('asset /index.html');
});

test('a failure outside the API is a 503 with HTTPS enforced, never a crash', async () => {
  const { env } = await environment();
  const failing = await call(
    {
      ...env,
      ASSETS: {
        fetch: async () => {
          throw new Error('assets unavailable');
        },
      },
    },
    '/index.html',
  );
  expect(failing.status).toBe(503);
  expect((await readJson<ErrorBody>(failing)).error).toMatch(/could not complete the request/);
  expect(failing.headers.get('Strict-Transport-Security') ?? '').toMatch(/max-age=31536000/);
});

test('oversized requests are refused and unexpected failures keep saved data', async () => {
  const { env } = await environment({ publicApp: true });
  const large = await call(
    env,
    '/api/search',
    { method: 'POST', body: 'x'.repeat(5000), headers: { 'Content-Type': 'application/json' } },
    null,
  );
  expect(large.status).toBe(413);
  const broken = {
    ...env,
    APARTMENTS: {
      prepare() {
        throw new Error('database down');
      },
      batch() {
        throw new Error('database down');
      },
    },
  };
  const failed = await call(broken, '/api/config');
  expect(failed.status).toBe(503);
  expect((await readJson<ErrorBody>(failed)).error, 'a storage failure is not blamed on feed settings').toMatch(
    /Saved source data could not be read/,
  );
});

test('a manual resync of a complete source starts its Workflow job and reports it running', async () => {
  const { env, created } = await environment();
  const response = await call(env, '/api/refresh', post({ check: 'now', source: 'openigloo' }));
  expect(response.status).toBe(202);
  expect(created.length).toBe(1);
  expect(created[0].id).toMatch(/^cityrealty-\d+-openigloo$/);
  expect(created[0].params).toStrictEqual({ delay: false, sources: ['openigloo'] });
  const status = await readJson<RefreshInfo>(call(env, '/api/refresh'));
  expect(status.checking).toBe(true);
  expect(status.activeSource, 'a single-source job is named by its id').toBe('openigloo');
});

test('status names the source the Workflow recorded, and nothing once jobs finish', async () => {
  const instances = new Map<string, Instance>();
  const { env } = await environment({ instances });
  instances.set('cityrealty-' + Math.floor(Date.now() / 120_000), { status: 'running' });
  await createD1Bucket(env.APARTMENTS).put(SYNC_PROGRESS_KEY, JSON.stringify({ source: 'zumper-live' }));
  expect((await readJson<RefreshInfo>(call(env, '/api/refresh'))).activeSource).toBe('zumper-live');
  await createD1Bucket(env.APARTMENTS).put(SYNC_PROGRESS_KEY, JSON.stringify({ source: 'unknown-source' }));
  expect((await readJson<RefreshInfo>(call(env, '/api/refresh'))).activeSource, 'a full run falls back to its first source').toBe(
    'apartmentguide-live',
  );
  for (const instance of instances.values()) instance.status = 'complete';
  expect(!(await readJson<RefreshInfo>(call(env, '/api/refresh'))).checking).toBeTruthy();
});

test('starting a job that already exists is accepted, but a failure with no job is reported', async () => {
  const duplicate = Object.assign(new Error('instance already exists'));
  const existing = await environment({ createError: duplicate });
  const id = 'cityrealty-' + Math.floor(Date.now() / 120_000) + '-zumper-live';
  existing.instances.set(id, { status: 'running' });
  expect((await call(existing.env, '/api/refresh', post({ check: 'now', source: 'zumper-live' }))).status).toBe(202);
  const failing = await environment({ createError: new Error('Workflows unavailable') });
  const failed = await call(failing.env, '/api/refresh', post({ check: 'now', source: 'zumper-live' }));
  expect(failed.status >= 500, 'a job that could not start is reported as a server error').toBeTruthy();
});

test('provider requests keep redirects unfollowed, in the form Workers accept', async () => {
  const { env } = await environment();
  const redirects: (RequestRedirect | undefined)[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    redirects.push(init?.redirect);
    return new Response('unavailable', { status: 503 });
  }) as typeof fetch;
  await call(env, '/api/refresh', post({ check: 'now', source: 'housingconnect' }));
  expect(redirects.length > 0, 'the refresh reached the provider').toBeTruthy();
  expect(
    redirects.every((redirect) => redirect === 'manual'),
    String(redirects),
  ).toBeTruthy();
});

test('the dashboard archive is read once through the assets binding and cannot be downloaded directly', async () => {
  const { env } = await environment();
  const bytes = await Bun.file(new URL('../public/data/streeteasy-dashboard-2026-11-17.zip', import.meta.url)).bytes();
  let reads = 0;
  const ASSETS = {
    fetch: async (request: Request) => {
      if (!new URL(request.url).pathname.startsWith('/data/')) return new Response('asset');
      reads++;
      return new Response(bytes);
    },
  };
  const withArchive = { ...env, ASSETS };
  expect((await call(withArchive, '/data/streeteasy-dashboard-2026-11-17.zip')).status).toBe(404);
  expect(reads, 'a direct request never reaches the archive').toBe(0);
  // The market history tables are filled from the archive the first time a series is asked for.
  const history = (series: string) => `/api/history/month?series=${series}&month=2026-10`;
  expect((await call(withArchive, history('rentalIndex_All.csv'))).status).toBe(200);
  expect((await call(withArchive, history('totalInventory_All.csv'))).status).toBe(200);
  expect(reads, 'the archive is read and verified once').toBe(1);
  const missing = { ...env, ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } };
  expect((await call(missing, history('medianAskingRent_All.csv'))).status).toBe(503);
});

test('every response, including a refusal, tells browsers to use HTTPS only', async () => {
  const { env } = await environment();
  for (const [path, token] of [
    ['/index.html', TOKEN],
    ['/api/config', TOKEN],
    ['/health', TOKEN],
    ['/api/config', null],
  ] as const) {
    expect((await call(env, path, {}, token)).headers.get('Strict-Transport-Security'), path).toBe('max-age=31536000; includeSubDomains');
  }
});

test('the Worker wakes at 05:00 and 06:00 UTC and runs the nightly resync only at 1 AM in New York', async () => {
  const { env, created } = await environment();
  const waited: Promise<unknown>[] = [];
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  const RealDate = Date;
  // 06:00 UTC on a winter night is 1 AM in New York.
  const at = new RealDate('2026-01-15T06:00:00Z').getTime();
  globalThis.Date = class extends RealDate {
    constructor(...args: ConstructorParameters<typeof RealDate>) {
      super(...((args.length ? args : [at]) as [number]));
    }
    static override now = () => at;
  } as DateConstructor;
  try {
    await worker.scheduled({}, env as Parameters<typeof worker.scheduled>[1], { waitUntil: (work) => waited.push(work) });
  } finally {
    globalThis.Date = RealDate;
  }
  expect(waited).toHaveLength(1);
  expect(created).toHaveLength(1);
  const settings = await readJson<{ lastNightly?: { background: boolean } }>(call(env, '/api/settings'));
  expect(settings.lastNightly?.background).toBe(true);
});

test('a broken nightly run is logged, not thrown', async () => {
  const { env } = await environment();
  const broken = {
    ...env,
    APARTMENTS: {
      prepare: () => {
        throw new Error('database down');
      },
      batch: async () => [],
    },
  };
  await worker.scheduled({}, broken as unknown as Parameters<typeof worker.scheduled>[1], { waitUntil: () => {} });
});

test('Stripe reaches its webhook without signing in, and nothing else does', async () => {
  const { env } = await environment();
  const response = await call({ ...env, STRIPE_WEBHOOK_SECRET: 'whsec_x' }, '/api/billing/webhook', { method: 'POST', body: '{}' }, null);
  expect(response.status, 'unsigned').toBe(400);
  expect((await call(env, '/api/billing', {}, null)).status).toBe(404);
});
