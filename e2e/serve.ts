/** Serves the web build for the browser tests with Hono on Bun, with the production Worker's headers. */
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cacheControl, securityHeaders } from '../server/web-headers.ts';
import { isAppPath } from '../src/routes.ts';

const app = new Hono()
  // The production Worker's headers, so every browser test also runs under its Content Security Policy.
  .use(securityHeaders)
  .all('/api/*', (c) => c.text('Unexpected unmocked API call', 500))
  .use(async (c, next) => {
    await next();
    if (c.res.ok) c.header('Cache-Control', cacheControl(c.req.path));
  })
  .use(serveStatic({ root: './web-build' }))
  // The app's own addresses get the app, as the Worker serves them.
  .get('*', (c, next) => (isAppPath(c.req.path) ? serveStatic({ path: './web-build/index.html' })(c, next) : next()));

Bun.serve({ hostname: '127.0.0.1', port: 4173, fetch: app.fetch });
