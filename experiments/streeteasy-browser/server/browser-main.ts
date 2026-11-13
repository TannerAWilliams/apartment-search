import { nativeQualificationGate, runNativeFixtureBasics } from '../qualification/native-remote-run.ts';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { qualificationGate } from './qualification-gate.ts';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { BrowserSession } from './browser-session.ts';
import { browserGateway } from './browser-gateway.ts';
import { PlaywrightDriver, verifyBrowserRuntime } from './playwright-session.ts';
const token = process.env.LISTING_RELAY_TOKEN || '';
const session = new BrowserSession(async () => new PlaywrightDriver(), process.env.BROWSERLESS_TOKEN ? 110000 : 600000);
const baseHandler = browserGateway(token, session);
const nativeGate = nativeQualificationGate(process.env.NATIVE_QUALIFICATION_TOKEN || '', signal => runNativeFixtureBasics(process.env.BROWSERLESS_TOKEN || '',signal), () => !stopQualification && (session.state === 'idle' || session.state === 'closed'));
let stopQualification: (() => void) | undefined;
const qualify = () => new Promise<boolean>(resolve => {
  const child = spawn(process.execPath, ['--experimental-strip-types','--test','--test-isolation=none',fileURLToPath(new URL('../qualification/browser.test.ts',import.meta.url))], {stdio:'ignore',env:process.env});
  stopQualification = () => { child.kill('SIGKILL'); resolve(false); };
  const deadline = setTimeout(() => { stopQualification?.(); }, 110000);
  child.once('error', () => { clearTimeout(deadline); stopQualification=undefined; resolve(false); });
  child.once('exit', code => { clearTimeout(deadline); stopQualification=undefined; resolve(code === 0); });
});
const handler = process.env.BROWSERLESS_TOKEN ? qualificationGate(token, qualify, baseHandler) : baseHandler;
const memoryMonitor = setInterval(() => {
  if (session.state === 'idle' || session.state === 'closed') return;
  const { rss, heapUsed, external } = process.memoryUsage();
  console.info('Browser gateway memory', { rss, heapUsed, external });
}, 5000);
memoryMonitor.unref();
const server = createServer(async (incoming, outgoing) => {
  const abort = new AbortController();
  const deadline = setTimeout(() => { abort.abort(); incoming.destroy(); }, incoming.url === '/browser/qualify' ? 115000 : 45000);
  outgoing.on('close', () => { if (!outgoing.writableEnded) abort.abort(); });
  incoming.on('aborted', () => abort.abort());
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(`http://127.0.0.1${incoming.url || '/'}`, {
      method: incoming.method, headers, signal: abort.signal,
      ...(incoming.method === 'POST' ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: 'half' } : {}),
    });
    const nativeResponse = await nativeGate.handle(request);
    const response = nativeResponse || (nativeGate.running ? new Response('Synthetic qualification running', {status:423,headers:{'Cache-Control':'no-store'}}) : await handler(request));
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { if (!outgoing.headersSent) outgoing.writeHead(502, { 'Cache-Control': 'no-store' }); outgoing.end('Browser relay unavailable'); }
  finally { clearTimeout(deadline); }
});
server.headersTimeout = 10000; server.requestTimeout = 45000;
await verifyBrowserRuntime();
server.listen(Number(process.env.PORT || 10000), '0.0.0.0');
process.on('SIGTERM', () => { stopQualification?.(); const stop = setTimeout(() => process.exit(1), 5000); stop.unref(); void Promise.allSettled([nativeGate.cancel(),session.close()]).finally(() => server.close(() => process.exit(0))); });

