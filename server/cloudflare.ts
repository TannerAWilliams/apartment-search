import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import * as v from 'valibot';
import { api } from './api.ts';
import { jsonBodies, type ApiVariables, type SyncJob } from './routes/context.ts';
import { RefreshCheckSchema } from './routes/inputs.ts';
import type { AppEnv, Bucket } from './contracts.ts';
import { createD1Bucket, type D1Database } from './d1-bucket.ts';
import { secretsEqual } from './secrets.ts';
import { log } from './log.ts';
import { STRICT_TRANSPORT_SECURITY, withWebHeaders } from './web-headers.ts';
import { accessSettings, verifyAccessToken } from './access.ts';
import { type ArchiveLoader, DASHBOARD_ARCHIVE_PATH } from './dashboard-snapshot.ts';
import { SYNC_PROGRESS_KEY, WORKFLOW_SOURCE_IDS } from './source-registry.ts';
export { CityRealtySync } from './sync-workflow.ts';

type Workflow = {
  create(options: { id: string; params: { delay: boolean; sources?: string[] } }): Promise<unknown>;
  get(id: string): Promise<{ status(): Promise<{ status: string }> }>;
};
type Environment = AppEnv & {
  /** The Cloudflare Access application in front of apartments.5thof6.com; see server/access.ts. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Secret: comma-separated emails allowed to sign in, kept out of the repository. */
  ACCESS_ALLOWED_EMAILS?: string;
  APARTMENTS: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  SYNC_WORKFLOW?: Workflow;
};
type Worker = { Bindings: Environment; Variables: ApiVariables & { signedIn: boolean } };

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
      try { await workflow.create({ id, params: { delay, ...(sources ? { sources } : {}) } }); }
      catch (error) {
        const existing = await workflow.get(id).then(instance => instance.status()).catch(() => { throw error; });
        if (existing.status === 'unknown') throw error;
      }
    },
    /** The source the running sync Workflow is on, or null when none runs. */
    async pending() {
      const ids = [0, 1].flatMap(offset => ['', ...WORKFLOW_SOURCE_IDS.map(source => '-' + source)].map(suffix => workflowId(offset) + suffix));
      const statuses = await Promise.allSettled(ids.map(id => workflow.get(id).then(instance => instance.status())));
      const running = ids.filter((_, index) => { const result = statuses[index];
        return result.status === 'fulfilled' && ['queued', 'running', 'waiting'].includes(result.value.status); });
      if (!running.length) return null;
      const progress = await bucket.get(SYNC_PROGRESS_KEY).then(object => object?.json<{ source?: string }>()).catch(() => null);
      if (progress?.source && WORKFLOW_SOURCE_IDS.includes(progress.source)) return progress.source;
      return WORKFLOW_SOURCE_IDS.find(source => running[0].endsWith('-' + source)) ?? WORKFLOW_SOURCE_IDS[0];
    },
  };
}

/** The ExecutionContext, which tests calling the Worker directly do not pass. */
function executionContext(c: Context) {
  try { return c.executionCtx; } catch { return undefined; }
}

const app = new Hono<Worker>();

// Every response asks browsers to use HTTPS only.
app.use(async (c, next) => { await next(); c.header('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY); });

// The deployed app is private. A browser signs in with Cloudflare Access, whose token this Worker
// verifies; scripts such as the StreetEasy home sync send the app access token instead. Every request,
// assets included, needs one of them. PUBLIC_APP opens the app for local development.
app.use(async (c, next) => {
  const env = c.env;
  const bearer = Boolean(env.APP_ACCESS_TOKEN && secretsEqual(c.req.header('Authorization') ?? '', 'Bearer ' + env.APP_ACCESS_TOKEN));
  const access = bearer ? null : accessSettings(env);
  const accessEmail = access ? await verifyAccessToken(c.req.header('Cf-Access-Jwt-Assertion') ?? null, access)
    .catch((cause) => { log.error('access_check_failed', cause); return null; }) : null;
  const signedIn = bearer || accessEmail !== null;
  if (env.PUBLIC_APP !== 'true' && !signedIn) return fail(c, 401, 'Sign in to the private apartment app.');
  // An Access session rides on a browser cookie, so changes must come from the app's own pages.
  if (accessEmail && !['GET', 'HEAD'].includes(c.req.method) && c.req.header('Origin') !== new URL(c.req.url).origin) {
    return fail(c, 403, 'Cross-origin request rejected.');
  }
  c.set('signedIn', signedIn);
  return next();
});

app.get('/health', (c) => c.text('ok', 200, HEADERS));
// The dashboard archive is published with the static files only so the API can read it.
app.all('/data/*', (c) => fail(c, 404, 'Not found.'));

app.use('/api/*', async (c, next) => {
  const env = c.env;
  const appEnv = { ...env, BUCKET: createD1Bucket(env.APARTMENTS) };
  const ctx = executionContext(c);
  c.set('appEnv', appEnv);
  c.set('services', {
    privateAuthenticated: c.var.signedIn,
    fetcher: (url, options) => fetch(url, options),
    waitUntil: ctx ? (work) => ctx.waitUntil(work) : undefined,
    syncJob: env.SYNC_WORKFLOW ? workflowJob(env.SYNC_WORKFLOW, appEnv.BUCKET) : undefined,
    dashboardArchive: dashboardArchive(env.ASSETS),
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
    const body: unknown = await c.req.raw.clone().json().catch(() => undefined);
    if (body === undefined) return void (c.res = fail(c, 400, 'Send a JSON request.'));
    if (!v.is(RefreshCheckSchema, body)) return void (c.res = fail(c, 403, 'Public refresh cannot import listing data.'));
    await next();
  });
});

app.route('/', api);
app.all('*', async (c) => withWebHeaders(await c.env.ASSETS.fetch(c.req.raw), c.req.path));

app.onError((cause, c) => {
  log.error('request_failed', cause, { path: c.req.path, method: c.req.method });
  return fail(c, 503, 'Apartment Search could not complete the request.');
});

export default app;
