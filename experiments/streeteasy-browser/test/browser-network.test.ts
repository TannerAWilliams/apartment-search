import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route } from 'playwright';
import { BrowserNetworkGuard, MAX_RESOURCE_BYTES } from '../server/browser-network.ts';
function mockRoute(url = 'https://streeteasy.com/for-rent/nyc', body: Buffer | null = null) {
  const calls: Array<[string, unknown]> = [];
  const route = {
    request: () => ({ url: () => url, resourceType: () => 'document', method: () => body ? 'POST' : 'GET', postDataBuffer: () => body, allHeaders: async () => ({ cookie: 'session=test', host: 'streeteasy.com', connection: 'keep-alive, x-private-hop', 'x-private-hop': 'remove', te: 'trailers', 'accept-encoding': 'zstd' }) }),
    fulfill: async (options: unknown) => { calls.push(['fulfill', options]); },
    abort: async (reason: string) => { calls.push(['abort', reason]); },
  };
  return { route: route as unknown as Route, calls };
}
test('unapproved initial URL never reaches transport', async () => {
  const { route, calls } = mockRoute('https://169.254.169.254/latest/meta-data');
  await new BrowserNetworkGuard(async () => { throw new Error('must not fetch'); }).route(route);
  assert.deepEqual(calls, [['abort', 'blockedbyclient']]);
});
test('all redirects are manual and stopped before browser receives Location', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let fetched = 0;
    const { route, calls } = mockRoute();
    await new BrowserNetworkGuard(async (url, init) => {
      fetched++; assert.equal(url, 'https://streeteasy.com/for-rent/nyc'); assert.equal(init.redirect, 'manual');
      return new Response(null, { status, headers: { Location: 'https://evil.test/' } });
    }).route(route);
    assert.equal(fetched, 1);
    assert.deepEqual(calls, [['fulfill', { status: 502, contentType: 'text/plain', body: 'Browser redirect blocked by source policy' }]]);
  }
});
test('allowed response preserves internal cookies and correct decoded-byte headers', async () => {
  const { route, calls } = mockRoute();
  await new BrowserNetworkGuard(async (_, init) => {
    const headers = new Headers(init.headers); assert.equal(headers.get('cookie'), 'session=test'); assert.equal(headers.has('connection'), false); assert.equal(headers.has('host'), false); assert.equal(headers.has('x-private-hop'), false); assert.equal(headers.has('te'), false); assert.equal(headers.get('accept-encoding'), 'identity');
    const h = new Headers({ 'content-encoding': 'gzip', 'content-length': '2' }); h.append('set-cookie', 'a=1; Secure'); h.append('set-cookie', 'b=2; Secure');
    return new Response('ok', { headers: h });
  }).route(route);
  const result = calls[0][1] as { status: number; headers: Record<string,string>; body: Buffer };
  assert.equal(result.status, 200); assert.equal(result.body.toString(), 'ok');
  assert.equal(result.headers['content-encoding'], undefined); assert.equal(result.headers['content-length'], undefined);
  assert.equal(result.headers['set-cookie'], 'a=1; Secure\nb=2; Secure');
});
test('oversized advertised responses abort without reading body', async () => {
  let canceled = false;
  const {route, calls} = mockRoute();
  await new BrowserNetworkGuard(async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-length': String(MAX_RESOURCE_BYTES + 1) } })).route(route);
  assert.equal(canceled, true); assert.deepEqual(calls, [['abort', 'failed']]);
});
test('chunked response overflow cancels stream and never fulfills', async () => {
  let canceled = false; let supplied = 0;
  const {route, calls} = mockRoute();
  await new BrowserNetworkGuard(async () => new Response(new ReadableStream({ pull(c) { supplied++; c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } }))).route(route);
  assert.equal(canceled, true); assert.ok(supplied <= 10); assert.deepEqual(calls, [['abort', 'failed']]);
});
test('transport concurrency and queue are bounded, close aborts active and queued work', async () => {
  let active = 0, max = 0, started = 0;
  const guard = new BrowserNetworkGuard(async (_, init) => {
    started++; active++; max = Math.max(max, active);
    await new Promise<void>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    active--; return new Response('never');
  });
  const routes = Array.from({length: 13}, () => mockRoute());
  const tasks = routes.map(r => guard.route(r.route));
  await new Promise(r => setImmediate(r));
  assert.equal(started, 4); assert.equal(max, 4); assert.deepEqual(routes[12].calls, [['abort','blockedbyclient']]);
  guard.close(); await Promise.all(tasks);
  assert.equal(started, 4); assert.ok(routes.every(r => r.calls.every(([name]) => name === 'abort')));
});
test('oversized request body never reaches transport', async () => {
  const {route, calls} = mockRoute(undefined, Buffer.alloc(65537));
  let fetched = false;
  await new BrowserNetworkGuard(async () => { fetched = true; return new Response(''); }).route(route);
  assert.equal(fetched, false); assert.deepEqual(calls, [['abort','failed']]);
});

test('aggregate resource budget closes network and prevents later upstream calls', async () => {
  let fetched = 0;
  const bytes = new Uint8Array(MAX_RESOURCE_BYTES);
  const guard = new BrowserNetworkGuard(async () => { fetched++; return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } })); });
  for (let i = 0; i < 16; i++) { const r = mockRoute(); await guard.route(r.route); assert.equal(r.calls[0][0], 'fulfill'); }
  const overflow = mockRoute(); await guard.route(overflow.route); assert.deepEqual(overflow.calls, [['abort','failed']]);
  const later = mockRoute(); await guard.route(later.route); assert.deepEqual(later.calls, [['abort','blockedbyclient']]);
  assert.equal(fetched, 17);
});

test('unknown content encodings fail closed instead of serving encoded bytes as decoded', async () => {
  const {route,calls} = mockRoute(); let canceled = false;
  await new BrowserNetworkGuard(async () => new Response(new ReadableStream({ cancel() { canceled = true; } }), {headers:{'content-encoding':'zstd'}})).route(route);
  assert.equal(canceled,true); assert.deepEqual(calls,[['abort','failed']]);
});
