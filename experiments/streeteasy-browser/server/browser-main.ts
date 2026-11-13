import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { BrowserSession } from './browser-session.ts';
import { browserGateway } from './browser-gateway.ts';
import { PlaywrightDriver, verifyBrowserRuntime } from './playwright-session.ts';
const token = process.env.LISTING_RELAY_TOKEN || '';
const session = new BrowserSession(async () => new PlaywrightDriver());
const handler = browserGateway(token, session);
const memoryMonitor = setInterval(() => {
  if (session.state === 'idle' || session.state === 'closed') return;
  const { rss, heapUsed, external } = process.memoryUsage();
  console.info('Browser gateway memory', { rss, heapUsed, external });
}, 5000);
memoryMonitor.unref();
const server = createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  const deadline = setTimeout(() => { abort.abort(); incoming.destroy(); }, 45000);
  outgoing.on('close', () => { if (!outgoing.writableEnded) abort.abort(); });
  incoming.on('aborted', () => abort.abort());
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(`http://127.0.0.1${incoming.url || '/'}`, {
      method: incoming.method, headers, signal: abort.signal,
      ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { if (!outgoing.headersSent) outgoing.writeHead(502, { 'Cache-Control': 'no-store' }); outgoing.end('Browser relay unavailable'); }
  finally { clearTimeout(deadline); }
});
server.headersTimeout = 10000; server.requestTimeout = 45000;
await verifyBrowserRuntime();
server.listen(Number(process.env.PORT || 10000), '0.0.0.0');
process.on('SIGTERM', () => { const stop = setTimeout(() => process.exit(1), 5000); stop.unref(); void session.close(); server.close(() => process.exit(0)); });

