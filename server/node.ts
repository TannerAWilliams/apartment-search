import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { handleApi } from './api.ts';
import { MIME } from './mime.ts';
import { createMemoryBucket } from './memory-bucket.ts';
import { SESSION_COOKIE, secretsEqual, issueSession, validSession } from './private-session.ts';

const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } } });
const host = values.host || process.env.HOST || '127.0.0.1';
const port = Number(values.port || process.env.PORT || 3000);
const root = fileURLToPath(new URL('../web-build', import.meta.url));
const token = process.env.APP_ACCESS_TOKEN;
const local = ['127.0.0.1', '::1', 'localhost'].includes(host);
if (!local && (!token || token.length < 32)) throw new Error('A private APP_ACCESS_TOKEN of at least 32 characters is required.');
const env = { ...process.env, BUCKET: createMemoryBucket(), TEMPORARY_CACHE: 'true' };
const publicOrigin = process.env.RENDER_EXTERNAL_URL;
let failures = 0; let resetAt = 0;
const loginPage = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Apartment Search · Sign in</title></head><body><main><h1>Apartment Search</h1><p>This app is private. Enter the access password stored in your Render service environment.</p><form method="post" action="/login"><label>Access password <input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Sign in</button></form><p>Listings are stored temporarily. A free-server restart clears them; use Resync to fetch available sources again.</p></main></body></html>';

createServer(async (incoming, outgoing) => {
  outgoing.setHeader('Cache-Control', 'no-store');
  outgoing.setHeader('X-Content-Type-Options', 'nosniff');
  outgoing.setHeader('Referrer-Policy', 'no-referrer');
  outgoing.setHeader('X-Frame-Options', 'DENY');
  try {
    const url = new URL(incoming.url, 'http://localhost');
    if (url.pathname === '/health' && incoming.method === 'GET') { outgoing.writeHead(200).end('ok'); return; }
    const origin = incoming.headers.origin;
    const sameOrigin = publicOrigin ? origin === publicOrigin : local && (!origin || new URL(origin).hostname === 'localhost');
    const bearer = token && secretsEqual(incoming.headers.authorization ?? '', `Bearer ${token}`);
    const authenticated = !token || bearer || validSession(incoming.headers.cookie ?? '', token);
    if (incoming.method === 'POST' && !bearer && !sameOrigin) { outgoing.writeHead(403).end('Cross-origin request rejected.'); return; }
    if (url.pathname === '/logout' && incoming.method === 'POST') {
      outgoing.writeHead(303, { Location: '/', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` }).end(); return;
    }
    if (url.pathname === '/login' && incoming.method === 'POST' && token) {
      if (Date.now() >= resetAt) { failures = 0; resetAt = Date.now() + 15 * 60_000; }
      if (failures >= 10) { outgoing.writeHead(429, { 'Retry-After': '900' }).end('Too many attempts. Try later.'); return; }
      let body = ''; for await (const chunk of incoming) { body += chunk.toString(); if (body.length > 4096) { outgoing.writeHead(413).end(); return; } }
      if (!secretsEqual(new URLSearchParams(body).get('password') ?? '', token)) { failures++; outgoing.writeHead(401).end('Incorrect password. Go back and try again.'); return; }
      failures = 0;
      outgoing.writeHead(303, { Location: '/', 'Set-Cookie': `${SESSION_COOKIE}=${issueSession(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400` }).end(); return;
    }
    if (!authenticated) {
      if (url.pathname.startsWith('/api/')) outgoing.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Sign in to the private apartment app.' }));
      else outgoing.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(loginPage);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; let bytes = 0; const limit = url.pathname === '/api/refresh' ? 2 * 1024 * 1024 : 4096;
      for await (const chunk of incoming) { bytes += chunk.length; if (bytes > limit) { outgoing.writeHead(413).end('Request too large.'); return; } chunks.push(chunk); }
      const response = await handleApi(new Request(url.href, { method: incoming.method, headers: incoming.headers as Record<string, string>, body: bytes ? Buffer.concat(chunks) : undefined }), env);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)).end(Buffer.from(await response.arrayBuffer())); return;
    }
    if (!['GET', 'HEAD'].includes(incoming.method)) { outgoing.writeHead(405).end(); return; }
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = resolve(root, relative);
    if (!file.startsWith(root + sep)) { outgoing.writeHead(404).end(); return; }
    const content = await readFile(file);
    outgoing.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' }).end(incoming.method === 'HEAD' ? undefined : content);
  } catch (error) { outgoing.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500).end('The request could not be completed.'); }
}).listen(port, host, () => console.log(`Private Apartment Search is serving on port ${port}`));
