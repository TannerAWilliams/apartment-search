import { Hono } from 'hono';
import { api } from '../../server/api.ts';
import type { AppEnv } from '../../server/contracts.ts';
import type { ApiServices, ApiVariables } from '../../server/routes/context.ts';

/** The API on its own, with the settings and services passed in as bindings; the Worker entry mounts `api` itself. */
const standalone = new Hono<{ Bindings: ApiVariables; Variables: ApiVariables }>()
  .use(async (c, next) => { c.set('appEnv', c.env.appEnv); c.set('services', c.env.services); await next(); })
  .route('/', api);

const noDashboardArchive = async (): Promise<never> => { throw new Error('No dashboard archive is configured.'); };

/** Calls the API with these settings, and stand-ins for the services a test does not pass. */
export function handleApi(request: Request, env: AppEnv, services: Partial<ApiServices> = {}) {
  return standalone.fetch(request, { appEnv: env, services: { privateAuthenticated: false, fetcher: (url, options) => globalThis.fetch(url, options),
    dashboardArchive: noDashboardArchive, ...services } });
}
