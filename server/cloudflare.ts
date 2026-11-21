import { handleApi } from './api.ts';
import type { AppEnv } from './contracts.ts';
import { createD1Bucket, type D1Database } from './d1-bucket.ts';
import { secretsEqual } from './private-session.ts';
import { isPublicRefresh } from './public-access.ts';
import { readRequestBody, RequestTooLarge } from './request-body.ts';
import { WORKFLOW_SOURCE_IDS } from './refresh.ts';
import { createRefreshWorkflow, type RefreshWorkflowBinding } from './refresh-workflow.ts';
import { createListingSourceClient } from './relay-client.ts';
export { CityRealtySync } from './cityrealty-workflow.ts';

type Environment = AppEnv & {
  APARTMENTS: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
  CITYREALTY_SYNC?: RefreshWorkflowBinding;
};

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const error = (message: string, status: number) => Response.json({ error: message }, { status, headers });

export default {
  async fetch(request: Request, env: Environment) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') return new Response('ok', { headers });
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const bearer = Boolean(env.APP_ACCESS_TOKEN && secretsEqual(
      request.headers.get('Authorization') ?? '', 'Bearer ' + env.APP_ACCESS_TOKEN,
    ));
    if (env.PUBLIC_APP !== 'true' && !bearer) return error('Sign in to the private apartment app.', 401);

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
      const appEnv = { ...env, BUCKET: createD1Bucket(env.APARTMENTS), LISTING_FETCH_TRANSPORT: 'direct' };
      const client = createListingSourceClient(appEnv, (target, options) =>
        fetch(target, options?.redirect === 'error' ? { ...options, redirect: 'manual' } : options));
      const workflow = env.CITYREALTY_SYNC;
      return await handleApi(apiRequest, appEnv, { ...client, privateAuthenticated: bearer,
        refreshWorkflow: workflow ? createRefreshWorkflow(appEnv.BUCKET, workflow, WORKFLOW_SOURCE_IDS) : undefined,
      });
    } catch (cause) {
      if (cause instanceof RequestTooLarge) return error('The request is too large.', 413);
      return error('Apartment Search could not complete the request.', 503);
    }
  },
};

