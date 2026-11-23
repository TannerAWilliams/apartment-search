import { handleApi } from './api.ts';
import type { AppEnv } from './contracts.ts';
import { createD1Bucket, type D1Database } from './d1-bucket.ts';
import { secretsEqual } from './secrets.ts';
import { isPublicRefresh } from './public-access.ts';
import { log } from './log.ts';
import { withWebHeaders } from './web-headers.ts';
import { type ArchiveLoader, DASHBOARD_ARCHIVE_PATH } from './dashboard-snapshot.ts';
import { readRequestBody, RequestTooLarge } from './request-body.ts';
import { SYNC_PROGRESS_KEY, WORKFLOW_SOURCE_IDS } from './source-registry.ts';
export { CityRealtySync } from './sync-workflow.ts';

type Environment = AppEnv & {
  APARTMENTS: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  SYNC_WORKFLOW?: {
    create(options: { id: string; params: { delay: boolean; sources?: string[] } }): Promise<unknown>;
    get(id: string): Promise<{ status(): Promise<{ status: string }> }>;
  };
};

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });

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

export default {
  async fetch(request: Request, env: Environment) {
    const url = new URL(request.url);
    // The deployed app is private: apartment-search-access adds this token after Cloudflare Access
    // sign-in, so every request, assets included, needs it. PUBLIC_APP opens it for local development.
    const bearer = Boolean(env.APP_ACCESS_TOKEN && secretsEqual(
      request.headers.get('Authorization') ?? '', 'Bearer ' + env.APP_ACCESS_TOKEN,
    ));
    if (env.PUBLIC_APP !== 'true' && !bearer) return error('Sign in to the private apartment app.', 401);
    if (url.pathname === '/health' && request.method === 'GET') return new Response('ok', { headers });
    // The dashboard archive is published with the static files only so the API can read it.
    if (url.pathname.startsWith('/data/')) return error('Not found.', 404);
    if (!url.pathname.startsWith('/api/')) return withWebHeaders(await env.ASSETS.fetch(request), url.pathname);

    try {
      let apiRequest = request;
      if (request.method === 'POST') {
        const refresh = url.pathname === '/api/refresh';
        const body = await readRequestBody(request, refresh && bearer ? 2 * 1024 * 1024 : 4096);
        if (refresh && !bearer) {
          if (request.headers.get('Origin') !== url.origin) return error('Cross-origin request rejected.', 403);
          let value: unknown;
          try { value = JSON.parse(new TextDecoder().decode(body)); } catch { return error('Send a JSON request.', 400); }
          if (!isPublicRefresh(value)) return error('Public refresh cannot import listing data.', 403);
        }
        apiRequest = new Request(request.url, { method: 'POST', headers: request.headers, signal: request.signal, body });
      }
      const appEnv = { ...env, BUCKET: createD1Bucket(env.APARTMENTS) };
      // Workers reject redirect: 'error'; 'manual' keeps redirects unfollowed, and source readers reject non-success responses.
      const fetcher = (target: string, options?: RequestInit) =>
        fetch(target, options?.redirect === 'error' ? { ...options, redirect: 'manual' } : options);
      const workflow = env.SYNC_WORKFLOW;
      // One instance ID per two-minute window, so repeated taps start one run. The prefix predates the
      // Workflow's other sources; status checks look for it.
      const workflowId = (offset = 0) => 'cityrealty-' + (Math.floor(Date.now() / 120_000) - offset);
      return await handleApi(apiRequest, appEnv, { fetcher, privateAuthenticated: bearer, dashboardArchive: dashboardArchive(env.ASSETS),
        syncJob: workflow ? {
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
            const progress = await appEnv.BUCKET.get(SYNC_PROGRESS_KEY).then(object => object?.json()).catch(() => null) as { source?: string } | null;
            if (progress?.source && WORKFLOW_SOURCE_IDS.includes(progress.source)) return progress.source;
            return WORKFLOW_SOURCE_IDS.find(source => running[0].endsWith('-' + source)) ?? WORKFLOW_SOURCE_IDS[0];
          },
        } : undefined,
      });
    } catch (cause) {
      if (cause instanceof RequestTooLarge) return error('The request is too large.', 413);
      log.error('request_failed', cause, { path: url.pathname, method: request.method });
      return error('Apartment Search could not complete the request.', 503);
    }
  },
};

