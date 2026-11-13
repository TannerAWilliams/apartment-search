/** Controlled test fixture only. Never import into the production gateway.
 * Creating this server does not listen or make outbound requests. Callers explicitly
 * bind it behind HTTPS on each of two controlled origins. Mock tests cannot qualify
 * Chromium/CDP streaming, interception, cookie, or destination-counter guarantees.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';

type HeaderMap = Record<string, string | string[]>;
export interface FixtureRequest { method: string; path: string; headers: Record<string, string | string[] | undefined> }
export interface FixtureResponse { status: number; headers: HeaderMap; body: Buffer | AsyncIterable<Buffer> }
export interface FixtureConfig { origin: string; peerOrigin: string; controlToken: string }
const keys = ['cookie', 'cors', 'gzip', 'br', 'overflow', 'redirect', 'redirectDestination', 'iframeDestination', 'workerDestination', 'websocketAttempt', 'popupDestination','websocketSrcdoc','websocketBlank','websocketBlob','websocketData'] as const;
type Counter = typeof keys[number];
const text = (value: string) => Buffer.from(value);
const payload = text('native-fixture-decoded-body\n'.repeat(128));
const compressedGzip = gzipSync(payload);
const compressedBrotli = brotliCompressSync(payload);
const MAX_ACTIVE_RESPONSES = 4;
const IDLE_MS = 10000;
const RESPONSE_DEADLINE_MS = 15000;
function origin(value: string): string {
 const url = new URL(value);
 if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value) throw Error('Fixture requires canonical HTTPS origins');
 return url.origin;
}
function authorized(value: string | string[] | undefined, token: string): boolean {
 if (typeof value !== 'string') return false;
 const actual = Buffer.from(value), expected = Buffer.from(`Bearer ${token}`);
 return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function createNativeFixture(config: FixtureConfig) {
 const fixed = Object.freeze({ origin: origin(config.origin), peerOrigin: origin(config.peerOrigin), controlToken: config.controlToken });
 if (fixed.origin === fixed.peerOrigin || !/^[A-Za-z0-9_-]{32,256}$/.test(fixed.controlToken)) throw Error('Fixture requires distinct origins and a strong control token');
 const counts = Object.fromEntries(keys.map(key => [key, 0])) as Record<Counter, number>;
 const hit = (key: Counter) => { counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + 1); };
 const reply = (status: number, body: Buffer | AsyncIterable<Buffer>, headers: HeaderMap = {}): FixtureResponse => ({ status, headers: {'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff', ...headers}, body });
 function dispatch(req: FixtureRequest): FixtureResponse {
  // Exact fixed paths only: no arbitrary destination, echo, proxy, or query inputs.
  if (req.path === '/control/counters' || req.path === '/control/reset') {
   if (!authorized(req.headers.authorization, fixed.controlToken)) return reply(401, text('Unauthorized'));
   if (req.path === '/control/counters' && req.method === 'GET') return reply(200, text(JSON.stringify(counts)), {'Content-Type':'application/json'});
   if (req.path === '/control/reset' && req.method === 'POST') { for (const key of keys) counts[key] = 0; return reply(204, Buffer.alloc(0)); }
   return reply(405, text('Method not allowed'));
  }
  if (req.method !== 'GET') return reply(405, text('Method not allowed'));
  switch (req.path) {
   case '/health': return reply(200, text('fixture-only'));
   case '/cookie': hit('cookie'); return reply(200, text('cookie-set'), {'Set-Cookie':'fixture_session=synthetic; Secure; HttpOnly; SameSite=None; Path=/'});
   case '/cookie/check': return reply(200, text(JSON.stringify({present: typeof req.headers.cookie === 'string' && req.headers.cookie.split(';').some(c => c.trim() === 'fixture_session=synthetic')})), {'Content-Type':'application/json'});
   case '/cors': hit('cors'); return reply(200, text('cors-fixture'), req.headers.origin === fixed.peerOrigin ? {'Access-Control-Allow-Origin':fixed.peerOrigin,'Access-Control-Allow-Credentials':'true','Vary':'Origin'} : {'Vary':'Origin'});
   case '/gzip': hit('gzip'); return reply(200, compressedGzip, {'Content-Encoding':'gzip'});
   case '/br': hit('br'); return reply(200, compressedBrotli, {'Content-Encoding':'br'});
   case '/overflow': hit('overflow'); return reply(200, (async function*() { for(let n=0;n<33;n++) yield Buffer.alloc(65536, 97); })());
   case '/redirect': hit('redirect'); return reply(302, text('redirect'), {'Location':`${fixed.peerOrigin}/destination/redirect`});
   case '/destination/redirect': hit('redirectDestination'); return reply(200, text('redirect-destination'));
   case '/destination/iframe': hit('iframeDestination'); return reply(200, text(`<!doctype html><p>iframe destination</p><iframe src="${fixed.peerOrigin}/destination/nested-iframe"></iframe>`), {'Content-Type':'text/html; charset=utf-8'});
   case '/destination/nested-iframe': hit('iframeDestination'); return reply(200, text('<!doctype html><p>nested iframe destination</p>'), {'Content-Type':'text/html; charset=utf-8'});
   case '/destination/worker': hit('workerDestination'); return reply(200, text('worker-destination'));
   case '/worker.js': return reply(200, text(`fetch(${JSON.stringify(fixed.peerOrigin + '/destination/worker')}).catch(()=>{});`), {'Content-Type':'application/javascript'});
   case '/destination/popup': hit('popupDestination'); return reply(200,text('popup destination'));
   case '/harness/popup': return reply(200,text(`<!doctype html><title>Popup fixture</title><button>Open controlled popup</button><script>document.querySelector('button').onclick=()=>window.open(${JSON.stringify(fixed.peerOrigin+'/destination/popup')});</script>`),{'Content-Type':'text/html; charset=utf-8'});
   case '/harness/cors': return reply(200,text(`<!doctype html><p>pending-cors</p><script>fetch(${JSON.stringify(fixed.peerOrigin+'/cors')},{credentials:'include'}).then(r=>r.text()).then(t=>document.body.textContent=t).catch(()=>document.body.textContent='cors-failed');</script>`),{'Content-Type':'text/html; charset=utf-8'});
   case '/harness/inherited-websocket': {
    const snippets=['srcdoc','blank','blob','data'].map(name=>'<script>try{new WebSocket('+JSON.stringify(fixed.peerOrigin.replace('https:','wss:')+'/destination/websocket/'+name)+')}catch{}<'+ '/script>');
    const encoded=JSON.stringify(snippets).replaceAll('<','\\u003c');
    const html=`<!doctype html><title>Inherited policy fixture</title><body><script>const html=${encoded};const a=document.createElement('iframe');a.srcdoc=html[0];document.body.append(a);const b=document.createElement('iframe');document.body.append(b);b.contentDocument.write(html[1]);b.contentDocument.close();const c=document.createElement('iframe');c.src=URL.createObjectURL(new Blob([html[2]],{type:'text/html'}));document.body.append(c);const d=document.createElement('iframe');d.src='data:text/html,'+encodeURIComponent(html[3]);document.body.append(d);</script>`;
    return reply(200,text(html),{'Content-Type':'text/html; charset=utf-8'});
   }
   case '/harness/iframe': return reply(200, text(`<!doctype html><title>Iframe fixture</title><iframe src="${fixed.peerOrigin}/destination/iframe"></iframe>`), {'Content-Type':'text/html; charset=utf-8'});
   case '/harness/worker': return reply(200, text(`<!doctype html><title>Worker fixture</title><script>new Worker('/worker.js');</script>`), {'Content-Type':'text/html; charset=utf-8'});
   case '/harness/websocket': return reply(200, text(`<!doctype html><title>WebSocket fixture</title><script>const ws = new WebSocket(${JSON.stringify(fixed.peerOrigin.replace('https:', 'wss:') + '/destination/websocket')}); ws.onerror=()=>{};</script>`), {'Content-Type':'text/html; charset=utf-8'});
   default: return reply(404, text('Not found'));
  }
 }
 let activeResponses = 0;
 const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (activeResponses >= MAX_ACTIVE_RESPONSES) {
   res.writeHead(503, {'Connection':'close','Content-Length':'0'}); res.end(); return;
  }
  activeResponses++;
  let released = false;
  const deadline = setTimeout(() => res.destroy(), RESPONSE_DEADLINE_MS); deadline.unref();
  const release = () => {
   if (released) return; released = true; activeResponses--; clearTimeout(deadline);
   res.off('finish',release); res.off('close',release);
  };
  res.once('finish',release); res.once('close',release);
  res.setTimeout(IDLE_MS, () => res.destroy());
  void (async () => {
   const result = dispatch({method:req.method || '', path:req.url || '', headers:req.headers});
   res.writeHead(result.status, result.headers);
   if (Buffer.isBuffer(result.body)) { res.end(result.body); return; }
   for await (const chunk of result.body) {
    if (res.destroyed) break;
    if (!res.write(chunk)) await new Promise<void>(resolve => {
     const done = () => { res.off('drain',done); res.off('close',done); res.off('error',done); resolve(); };
     res.once('drain',done); res.once('close',done); res.once('error',done);
     if (res.destroyed) done();
    });
   }
   res.end();
  })().catch(() => res.destroy());
 });
 // Count actual Upgrade arrival then reject; never accept a socket or echo credentials.
 server.on('upgrade', (req, socket) => {
  if (req.method === 'GET') {const key=({'/destination/websocket':'websocketAttempt','/destination/websocket/srcdoc':'websocketSrcdoc','/destination/websocket/blank':'websocketBlank','/destination/websocket/blob':'websocketBlob','/destination/websocket/data':'websocketData'} as const)[req.url as '/destination/websocket'];if(key)hit(key);}
  socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
 });
 server.maxConnections = 8;
 server.setTimeout(IDLE_MS, socket => socket.destroy());
 server.keepAliveTimeout = 1000;
 server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxRequestsPerSocket = 100;
 return {dispatch, server};
}
