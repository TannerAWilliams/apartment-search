/**
 * The API under /api/, a Hono app made of route groups (server/routes/). Each route checks its input with a
 * Valibot schema (server/routes/inputs.ts) and its reply types reach the app through `ApiRoutes`.
 */
import { HTTPException } from 'hono/http-exception';
import { methodNotAllowed } from 'hono/method-not-allowed';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { SearchInputError } from '../src/search.ts';
import { CommuteError } from './commute.ts';
import { log } from './log.ts';
import { alertRoutes } from './routes/alerts.ts';
import { factory, fail } from './routes/context.ts';
import { dataRoutes } from './routes/data.ts';
import { historyRoutes } from './routes/history.ts';
import { searchRoutes } from './routes/search.ts';
import { sourceRoutes } from './routes/sources.ts';
import { vitalsRoutes } from './routes/vitals.ts';
import { settingsRoutes } from './routes/settings.ts';

export const api = factory
  .createApp()
  .basePath('/api')
  .use(async (c, next) => {
    await next();
    // API answers are never cached, except a reply that says the browser alone may keep it (Street View images).
    if (!c.res.headers.get('Cache-Control')?.startsWith('private,')) c.header('Cache-Control', 'no-store');
  })
  .route('/', sourceRoutes)
  .route('/', searchRoutes)
  .route('/', dataRoutes)
  .route('/', historyRoutes)
  .route('/', alertRoutes)
  .route('/', settingsRoutes)
  .route('/', vitalsRoutes);

/** The routes and the shape of each reply, for the app's API client. */
export type ApiRoutes = typeof api;

// A known path asked with the wrong method gets a 405 that says which methods to use (Hono's method-not-allowed
// middleware, which also sets the Allow header); anything else is a 404.
api.use(
  methodNotAllowed({
    app: api,
    onMethodNotAllowed: (c, methods) =>
      c.json({ error: `Use ${methods.filter((method) => method !== 'HEAD').join(' or ')} for this endpoint.` }, 405, {
        Allow: methods.join(', '),
      }),
  }),
);
api.all('*', (c) => fail(c, 404, 'Endpoint not found.'));

api.onError((error, c) => {
  if (error instanceof HTTPException)
    return error.status === 413 ? fail(c, 413, 'The request is too large.') : fail(c, 400, 'Send a JSON request.');
  if (error instanceof CommuteError) return c.json({ error: error.message, commuteError: true }, error.status as ContentfulStatusCode);
  if (error instanceof SearchInputError) return fail(c, 422, error.message);
  log.error('request_failed', error, { path: c.req.path, method: c.req.method });
  if (c.req.method !== 'POST') return fail(c, 503, 'Walkup could not complete the request.');
  if (c.req.path === '/api/refresh') return fail(c, 502, 'The listing sources could not be checked. Try reloading the page.');
  return fail(c, 502, 'The address or listing feed could not be reached. Try again or use a workplace preset.');
});
