import { initializeInventory } from './startup-inventory.ts';
import '../scripts/check-runtime.ts';
import { allowApiResponseTime } from './http-timeout.ts';
import { readRequestBody, RequestTooLarge } from './request-body.ts';
import { extname, resolve, sep } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { handleApi } from './api.ts';
import { createListingSourceClient } from './relay-client.ts';
import { MIME } from './mime.ts';
import { createMemoryBucket } from './memory-bucket.ts';
import { createBunDatabase } from './bun-database.ts';
import { createPostgresBucket } from './postgres-bucket.ts';
import { createPublicRequestLimits, isPublicRefresh } from './public-access.ts';
import { SESSION_COOKIE, secretsEqual, issueSession, validSession } from './private-session.ts';

const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } } });
const host = values.host || process.env.HOST || '127.0.0.1';
const port = Number(values.port || process.env.PORT || 3000);
const root = fileURLToPath(new URL('../web-build', import.meta.url));
const token = process.env.APP_ACCESS_TOKEN;
const publicApp = process.env.PUBLIC_APP === 'true';
const publicLimits = createPublicRequestLimits();
const local = ['127.0.0.1', '::1', 'localhost'].includes(host);
if (!publicApp && !local && (!token || token.length < 32)) throw new Error('A private APP_ACCESS_TOKEN of at least 32 characters is required.');
// A configured database must connect successfully: never silently fall back and lose data.
const database = process.env.DATABASE_URL ? createBunDatabase(process.env.DATABASE_URL) : null;
const bucket = database ? await createPostgresBucket(database) : createMemoryBucket();
const env = { ...process.env, BUCKET: bucket, TEMPORARY_CACHE: database ? 'false' : 'true' };
// Rebuild the permitted limited sample before accepting searches on an empty startup.
// Never change observation timestamps or silently promote historical rows.
try { await initializeInventory(env); } catch { console.error('Initial inventory check failed; source status remains unavailable.'); }
const publicOrigin = process.env.RENDER_EXTERNAL_URL;
let failures = 0; let resetAt = 0;
const loginPage = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Apartment Search · Sign in</title></head><body><main><h1>Apartment Search</h1><p>This app is private. Enter the access password stored in your Render service environment.</p><form method="post" action="/login"><label>Access password <input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Sign in</button></form><p>Listing storage mode is shown in the app. An empty server startup checks the limited Openigloo sample once. Other provider refreshes are manual.</p></main></body></html>';

const secureHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
};
function reply(body: BodyInit | null = null, status = 200, headers: HeadersInit = {}) {
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(secureHeaders)) merged.set(key, value);
  return new Response(body, { status, headers: merged });
}
Bun.serve({
  hostname: host, port, maxRequestBodySize: 2 * 1024 * 1024, idleTimeout: 30,
  async fetch(request, server) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') return reply('ok');
      const origin = request.headers.get('origin');
      const sameOrigin = publicOrigin ? origin === publicOrigin : local && (!origin || new URL(origin).hostname === 'localhost');
      const bearer = token && secretsEqual(request.headers.get('authorization') ?? '', `Bearer ${token}`);
      const authenticated = publicApp || !token || bearer || validSession(request.headers.get('cookie') ?? '', token);
      if (request.method === 'POST' && !bearer && !sameOrigin) return reply('Cross-origin request rejected.', 403);
      if (url.pathname === '/logout' && request.method === 'POST') {
        return reply(null, 303, { Location: '/', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
      }
      if (url.pathname === '/login' && request.method === 'POST' && token) {
        if (Date.now() >= resetAt) { failures = 0; resetAt = Date.now() + 15 * 60_000; }
        if (failures >= 10) return reply('Too many attempts. Try later.', 429, { 'Retry-After': '900' });
        const body = new TextDecoder().decode(await readRequestBody(request, 4096));
        if (!secretsEqual(new URLSearchParams(body).get('password') ?? '', token)) {
          failures++; return reply('Incorrect password. Go back and try again.', 401);
        }
        failures = 0;
        return reply(null, 303, { Location: '/', 'Set-Cookie': `${SESSION_COOKIE}=${issueSession(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` });
      }
      if (!authenticated) {
        return url.pathname.startsWith('/api/')
          ? reply(JSON.stringify({ error: 'Sign in to the private apartment app.' }), 401, { 'Content-Type': 'application/json' })
          : reply(loginPage, 200, { 'Content-Type': 'text/html; charset=utf-8' });
      }
      if (url.pathname.startsWith('/api/')) {
        if (publicApp && !bearer && !publicLimits.allowApi()) {
          return reply(JSON.stringify({ error: 'The app is busy. Please try again in one minute.' }), 429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        }
        const bytes = await readRequestBody(request, url.pathname === '/api/refresh' ? 2 * 1024 * 1024 : 4096);
        if (publicApp && !bearer && url.pathname === '/api/refresh' && request.method === 'POST') {
          let body: unknown;
          try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* Rejected below. */ }
          if (!isPublicRefresh(body)) return reply(JSON.stringify({ error: 'Public refresh can fetch sources but cannot import listing data.' }), 403, { 'Content-Type': 'application/json' });
          const retry = publicLimits.refreshRetrySeconds();
          if (retry) return reply(JSON.stringify({ error: `Sources were just requested. Try again in ${retry} seconds.` }), 429, { 'Content-Type': 'application/json', 'Retry-After': String(retry) });
        }
        allowApiResponseTime(server, request);
        const response = await handleApi(new Request(url.href, { method: request.method, headers: request.headers, signal: request.signal, body: bytes.length ? bytes : undefined }), env, { ...createListingSourceClient(env), backgroundRefresh: true, privateAuthenticated: !publicApp && Boolean(token) });
        const headers = new Headers(response.headers);
        if (publicApp && !bearer) headers.set('X-Refresh-Retry-After', String(publicLimits.refreshRemainingSeconds()));
        return reply(response.body, response.status, headers);
      }
      if (!['GET', 'HEAD'].includes(request.method)) return reply(null, 405);
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const path = resolve(root, relative);
      if (!path.startsWith(root + sep)) return reply(null, 404);
      const file = Bun.file(path);
      if (!await file.exists()) return reply(null, 404);
      return reply(request.method === 'HEAD' ? null : file, 200, { 'Content-Type': MIME[extname(path) as keyof typeof MIME] || 'application/octet-stream' });
    } catch (error) {
      return reply('The request could not be completed.', error instanceof RequestTooLarge ? 413 : error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'EISDIR') ? 404 : 500);
    }
  },
  error() { return reply('The request could not be completed.', 500); },
});
console.log(`Apartment Search is serving on port ${port}`);
