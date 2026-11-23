import type { FetchTransport } from '../src/fetch-type.ts';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { relayRequest } from './relay-policy.ts';

export function createRelay(token: string, fetcher: FetchTransport = fetch, appToken?: string) {
  if (token.length < 32) throw new Error('LISTING_RELAY_TOKEN must have at least 32 characters.');
  if (appToken !== undefined && appToken.length < 32) throw new Error('LISTING_RELAY_APP_TOKEN must have at least 32 characters.');
  let active = 0;
  let windowStart = Date.now();
  let requests = 0;
  const expected = [token, ...(appToken === undefined ? [] : [appToken])].map(key => Buffer.from(`Bearer ${key}`));
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const respond = (status: number, text: string) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: text })); };
    if (req.url === '/health' && req.method === 'GET') { res.writeHead(200); res.end('ok'); return; }
    const received = Buffer.from(req.headers.authorization ?? '');
    if (!expected.reduce((matched, key) => (received.length === key.length && timingSafeEqual(received, key) ? 1 : 0) | matched, 0)) { respond(401, 'Unauthorized'); return; }
    if (req.url !== '/fetch' || req.method !== 'POST') { respond(404, 'Not found'); return; }
    if (active >= 6) { res.setHeader('Retry-After', '5'); respond(429, 'Relay busy'); return; }
    if (Date.now() - windowStart >= 3600000) { requests = 0; windowStart = Date.now(); }
    if (requests >= 1000) { res.setHeader('Retry-After', String(Math.ceil((windowStart + 3600000 - Date.now()) / 1000))); respond(429, 'Hourly relay limit reached'); return; }
    active++;
    requests++;
    const abort = new AbortController();
    const timer = setTimeout(() => { abort.abort(); req.destroy(); }, 15000);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2048) { respond(413, 'Request too large'); return; } }
      const request = relayRequest(JSON.parse(body));
      if (!request) { respond(422, 'Unsupported listing request'); return; }
      const upstream = await fetcher(request.url, { ...request.init, signal: abort.signal });
      const content: Uint8Array[] = [];
      let length = 0;
      if (upstream.body) {
        const reader = upstream.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 8 * 1024 * 1024) { await reader.cancel(); respond(502, 'Source response too large'); return; }
          content.push(value);
        }
      }
      // Preserve source status/rate limits, never forward cookies or redirects.
      const retryAfter = upstream.headers.get('Retry-After');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      res.writeHead(upstream.status, { 'Content-Type': request.url.includes('api-v6') ? 'application/json' : 'text/html; charset=utf-8' });
      res.end(Buffer.concat(content));
    } catch {
      if (!res.headersSent) respond(502, 'Listing source request failed'); else res.end();
    } finally { clearTimeout(timer); active--; }
  });
}
/** Starts the relay from environment settings; returns the listening server. */
export function startRelay(env: Record<string, string | undefined> = process.env, host = '0.0.0.0') {
  const server = createRelay(env.LISTING_RELAY_TOKEN ?? '', fetch, env.LISTING_RELAY_APP_TOKEN);
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.listen(Number(env.PORT ?? 10000), host);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startRelay();
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 20000).unref(); });
}

