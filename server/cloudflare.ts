import { type Context, Hono } from 'hono';
import { stripeWebhook } from './billing.ts';
import { publicPages } from './public-pages.ts';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as v from 'valibot';
import { api } from './api.ts';
import { jsonBodies, type ApiVariables, type SyncJob } from './routes/context.ts';
import { RefreshCheckSchema } from './routes/inputs.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { createD1Bucket, type D1Database } from './storage/d1-bucket.ts';
import { timingSafeEqual } from 'hono/utils/buffer';
import { type Auth, createAuth, sessionEmail } from './auth.ts';
import { isAdmin } from './roles.ts';
import { runScheduled } from './nightly.ts';
import { log } from './log.ts';
import { isAppPath } from '../src/routes.ts';
import { securityHeaders, withCacheControl } from './web-headers.ts';
import { type ArchiveLoader, DASHBOARD_ARCHIVE_PATH } from './dashboard-snapshot.ts';
import { SYNC_PROGRESS_KEY, WORKFLOW_SOURCE_IDS } from './sources/source-registry.ts';
export { CityRealtySync } from './sync-workflow.ts';

type Workflow = {
  create(options: { id: string; params: { delay: boolean; sources?: string[] } }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status: string }> }>;
};
type Environment = AppEnv & {
  /** Secret: comma-separated emails allowed to sign in, kept out of the repository. */
  ACCESS_ALLOWED_EMAILS?: string;
  OPEN_SIGNUPS?: string;
  /** Secret: turns on sign-in with an email code (server/auth.ts) and signs its sessions. */
  BETTER_AUTH_SECRET?: string;
  APARTMENTS: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  SYNC_WORKFLOW?: Workflow;
  /** Workers rate limits (wrangler.jsonc): searches, and lookups that call outside services. */
  SEARCH_LIMIT?: RateLimit;
  LOOKUP_LIMIT?: RateLimit;
};
type RateLimit = { limit(options: { key: string }): Promise<{ success: boolean }> };
type Worker = { Bindings: Environment; Variables: ApiVariables & { signedIn: boolean; caller: string; account: string | null } };

/** The costly routes and the limit each counts against. Search can also ask TravelTime for commute times. */
const LIMITED_ROUTES: Record<string, 'SEARCH_LIMIT' | 'LOOKUP_LIMIT'> = {
  '/api/search': 'SEARCH_LIMIT',
  '/api/search-check': 'SEARCH_LIMIT',
  '/api/geocode': 'LOOKUP_LIMIT',
  '/api/building-report': 'LOOKUP_LIMIT',
};

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const fail = <S extends ContentfulStatusCode>(c: Context, status: S, error: string) => c.json({ error }, status, HEADERS);

/** One archive reader per assets binding, so an isolate reads and verifies the dashboard archive once. */
const archiveReaders = new WeakMap<Environment['ASSETS'], ArchiveLoader>();
function dashboardArchive(assets: Environment['ASSETS']) {
  let reader = archiveReaders.get(assets);
  if (!reader) {
    reader = async () => {
      const archive = await assets.fetch(new Request('https://assets.local' + DASHBOARD_ARCHIVE_PATH));
      if (!archive.ok) throw new Error('The dashboard archive returned HTTP ' + archive.status + '.');
      return new Uint8Array(await archive.arrayBuffer());
    };
    archiveReaders.set(assets, reader);
  }
  return reader;
}

/** Starts and reports on the sync Workflow, which runs the complete syncs one durable step at a time. */
function workflowJob(workflow: Workflow, bucket: Bucket): SyncJob {
  // One instance ID per two-minute window, so repeated taps start one run. The prefix predates the
  // Workflow's other sources; status checks look for it.
  const workflowId = (offset = 0) => 'cityrealty-' + (Math.floor(Date.now() / 120_000) - offset);
  return {
    async start(delay, sources) {
      const id = workflowId() + (sources ? '-' + sources.join('-') : '');
      try {
        await workflow.create({ id, params: { delay, ...(sources ? { sources } : {}) } });
      } catch (error) {
        const existing = await workflow
          .get(id)
          .then((instance) => instance.status())
          .catch(() => {
            throw error;
          });
        if (existing.status === 'unknown') throw error;
      }
    },
    /** The source the running sync Workflow is on, or null when none runs. */
    async pending() {
      const ids = [0, 1].flatMap((offset) =>
        ['', ...WORKFLOW_SOURCE_IDS.map((source) => '-' + source)].map((suffix) => workflowId(offset) + suffix),
      );
      const statuses = await Promise.allSettled(ids.map((id) => workflow.get(id).then((instance) => instance.status())));
      const running = ids.filter((_, index) => {
        const result = statuses[index];
        return result.status === 'fulfilled' && ['queued', 'running', 'waiting'].includes(result.value.status);
      });
      if (!running.length) return null;
      const progress = await bucket
        .get(SYNC_PROGRESS_KEY)
        .then((object) => object?.json<{ source?: string }>())
        .catch(() => null);
      if (progress?.source && WORKFLOW_SOURCE_IDS.includes(progress.source)) return progress.source;
      return WORKFLOW_SOURCE_IDS.find((source) => running[0].endsWith('-' + source)) ?? WORKFLOW_SOURCE_IDS[0];
    },
  };
}

/** The ExecutionContext, which tests calling the Worker directly do not pass. */
function executionContext(c: Context) {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
}

const app = new Hono<Worker>();

// Hono's secure headers on every response, sign-in refusals included: HTTPS only, the Content Security Policy and the rest.
app.use(securityHeaders);

/** Better Auth for these settings, made once per isolate, or null when email-code sign-in is not set up. */
const auths = new WeakMap<Environment, Auth>();
function authFor(env: Environment) {
  if (!env.BETTER_AUTH_SECRET) return null;
  const auth = auths.get(env) ?? createAuth(env, env.APARTMENTS);
  auths.set(env, auth);
  return auth;
}

// Sign-in itself (sending and checking codes, signing out) works before signing in; AUTH_BASE_PATH in server/auth.ts.
app.on(['GET', 'POST'], '/api/auth/*', async (c): Promise<Response> => {
  const auth = authFor(c.env);
  return auth ? auth.handler(c.req.raw) : fail(c, 404, 'Not found.');
});

// Stripe reports payments here (server/billing.ts). It cannot sign in, so its signature is checked instead.
app.post('/api/billing/webhook', (c) => stripeWebhook(c.env, createD1Bucket(c.env.APARTMENTS), c.req.raw));

// The deployed app is private. People sign in with an email code (Better Auth, server/auth.ts); scripts such
// as the StreetEasy home sync send the app access token instead. The app's own pages load signed out, so they
// can show the sign-in form; the API and data need one or the other. PUBLIC_APP opens the app for local development.
app.use(async (c, next) => {
  const env = c.env;
  const bearer = Boolean(
    env.APP_ACCESS_TOKEN && (await timingSafeEqual(c.req.header('Authorization') ?? '', 'Bearer ' + env.APP_ACCESS_TOKEN)),
  );
  const auth = bearer ? null : authFor(env);
  const session = auth
    ? await sessionEmail(auth, env, c.req.raw.headers).catch((cause) => {
        log.error('session_check_failed', cause);
        return null;
      })
    : null;
  const signedIn = bearer || session !== null;
  const reading = ['GET', 'HEAD'].includes(c.req.method);
  if (env.PUBLIC_APP !== 'true' && !signedIn && !(auth && reading && !c.req.path.startsWith('/api/'))) {
    return fail(c, 401, 'Sign in to the private apartment app.');
  }
  // The web app's session rides on a browser cookie, so changes must come from the app's own pages.
  // The native app sends its session as a bearer token, which another site cannot make a browser send.
  const cookie = session !== null && !c.req.header('Authorization');
  if (cookie && !reading && c.req.header('Origin') !== new URL(c.req.url).origin) {
    return fail(c, 403, 'Cross-origin request rejected.');
  }
  c.set('signedIn', signedIn);
  c.set('account', session);
  // Limits count per person: the signed-in email, the app access token, or else the visitor's address.
  c.set('caller', session ?? (bearer ? 'app-access-token' : 'ip:' + (c.req.header('CF-Connecting-IP') ?? 'unknown')));
  return next();
});

// A burst of costly requests, from a stuck page or a leaked token, is refused rather than run.
app.use('/api/*', async (c, next) => {
  const binding = c.req.method === 'POST' ? LIMITED_ROUTES[c.req.path] : undefined;
  const limiter = binding && c.env[binding];
  if (limiter && !(await limiter.limit({ key: binding + ':' + c.var.caller })).success) {
    log.warn('rate_limited', { path: c.req.path });
    return c.json({ error: 'Too many requests. Wait a minute, then try again.' }, 429, { ...HEADERS, 'Retry-After': '60' });
  }
  return next();
});

app.get('/health', (c) => c.text('ok', 200, HEADERS));
// Public neighborhood pages, the sitemap and robots.txt, for search engines; open without signing in.
app.on('GET', ['/robots.txt', '/sitemap.xml', '/rents', '/rents/*'], (c) =>
  publicPages({ ...c.env, BUCKET: createD1Bucket(c.env.APARTMENTS) }, (url, options) => fetch(url, options)).fetch(c.req.raw),
);
// The dashboard archive is published with the static files only so the API can read it.
app.all('/data/*', (c) => fail(c, 404, 'Not found.'));

app.use('/api/*', async (c, next) => {
  const env = c.env;
  const appEnv = { ...env, BUCKET: createD1Bucket(env.APARTMENTS) };
  const ctx = executionContext(c);
  c.set('appEnv', appEnv);
  c.set('services', {
    privateAuthenticated: c.var.signedIn,
    account: c.var.account,
    admin: isAdmin(env, { account: c.var.account, token: c.var.caller === 'app-access-token' }),
    fetcher: (url, options) => fetch(url, options),
    waitUntil: ctx ? (work) => ctx.waitUntil(work) : undefined,
    syncJob: env.SYNC_WORKFLOW ? workflowJob(env.SYNC_WORKFLOW, appEnv.BUCKET) : undefined,
    dashboardArchive: dashboardArchive(env.ASSETS),
    database: env.APARTMENTS,
  });
  await next();
});

// Without signing in (a public app), a refresh may only ask for a check, from the app's own pages.
const publicBodies = jsonBodies(() => 4096);
app.post('/api/refresh', async (c, next) => {
  if (c.var.signedIn) return next();
  if (c.req.header('Origin') !== new URL(c.req.url).origin) return fail(c, 403, 'Cross-origin request rejected.');
  return publicBodies(c, async () => {
    // A copy, so the API still reads the body itself.
    const body: unknown = await c.req.raw
      .clone()
      .json()
      .catch(() => undefined);
    if (body === undefined) return void (c.res = fail(c, 400, 'Send a JSON request.'));
    if (!v.is(RefreshCheckSchema, body)) return void (c.res = fail(c, 403, 'Public refresh cannot import listing data.'));
    await next();
  });
});

app.route('/', api);
app.all('*', async (c) => {
  const asset = await c.env.ASSETS.fetch(c.req.raw);
  // The app's own addresses (/market, /profile, /listing/ID) are one page: the app's index, which opens that screen.
  if (asset.status !== 404 || !isAppPath(c.req.path)) return withCacheControl(asset, c.req.path);
  return withCacheControl(await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url), c.req.raw)), '/');
});

app.onError((cause, c) => {
  log.error('request_failed', cause, { path: c.req.path, method: c.req.method });
  return fail(c, 503, 'Walkup could not complete the request.');
});

/** Scheduled resyncs (server/nightly.ts): Cloudflare wakes the Worker every hour; the hour in New York decides what runs. */
async function scheduled(_controller: unknown, env: Environment, ctx: { waitUntil(work: Promise<unknown>): void }) {
  const bucket = createD1Bucket(env.APARTMENTS);
  const run = runScheduled(
    { ...env, BUCKET: bucket },
    {
      fetcher: (url, options) => fetch(url, options),
      syncJob: env.SYNC_WORKFLOW ? workflowJob(env.SYNC_WORKFLOW, bucket) : undefined,
    },
  ).catch((cause) => log.error('scheduled_resync_failed', cause));
  ctx.waitUntil(run);
  await run;
}

export default { fetch: app.fetch, scheduled };
