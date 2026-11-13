import assert from 'node:assert/strict';
import test from 'node:test';
import { relayRequest } from '../server/relay-policy.ts';
import { createRelay } from '../server/relay-service.ts';

test('relay accepts bounded public query and rejects arbitrary destinations', () => {
  assert.equal(relayRequest({ source: 'other', url: 'http://localhost' }), null);
  assert.equal(relayRequest({ source: 'streeteasy', page: 3 }), null);
  assert.equal(relayRequest({ source: 'streeteasy', page: 1, lower: -1, upper: 2 }), null);
  assert.equal(relayRequest({ source: 'streeteasy', page: 1, lower: 0, upper: '2' }), null);
  const request = relayRequest({ source: 'streeteasy', page: 2, lower: 1000, upper: 2000 });
  assert.equal(request?.url, 'https://api-v6.streeteasy.com/');
  assert.match(String(request?.init.body), /lowerBound: 1000/);
  assert.equal(relayRequest({ source: 'hotpads', market: 'stamford-ct' })?.url, 'https://hotpads.com/stamford-ct/condos-for-rent');
  assert.equal(relayRequest({ source: 'hotpads', market: '../admin' }), null);
  assert.throws(() => createRelay('short'));
});

test('relay HTTP requires auth and preserves source status without forwarding credentials', async () => {
  const token = 'test-only-key-that-is-long-enough-123456789';
  let calls = 0;
  const server = createRelay(token, async (url, options) => {
    calls++;
    assert.equal(url, 'https://api-v6.streeteasy.com/');
    assert.equal(new Headers(options?.headers).get('Authorization'), null);
    assert.equal(new Headers(options?.headers).get('Origin'), 'https://streeteasy.com');
    assert.equal(new Headers(options?.headers).get('Referer'), 'https://streeteasy.com/for-rent/nyc');
    assert.equal(new Headers(options?.headers).get('User-Agent'), null);
    assert.equal(options?.redirect, 'error');
    return new Response('{"denied":true}', { status: 403, headers: { 'Set-Cookie': 'bad', 'Retry-After': '120' } });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.equal((await fetch(base + '/fetch', { method: 'POST', body: '{}' })).status, 401);
    const response = await fetch(base + '/fetch', { method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ source: 'streeteasy', page: 1 }) });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('Set-Cookie'), null);
    assert.equal(response.headers.get('Retry-After'), '120');
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

import { relayConfig, sourceRelayPayload, withListingRelay, wakeListingRelay } from '../server/relay-client.ts';

test('Worker relay maps only known source requests and keeps auth server-side', async () => {
  assert.equal(relayConfig({}), null);
  assert.throws(() => relayConfig({ LISTING_RELAY_URL: 'https://evil.example', LISTING_RELAY_TOKEN: 'x'.repeat(40) }));
  const config = relayConfig({ LISTING_RELAY_URL: 'https://test.onrender.com', LISTING_RELAY_TOKEN: 'x'.repeat(40) });
  assert.ok(config);
  assert.deepEqual(sourceRelayPayload('https://api-v6.streeteasy.com/', { method: 'POST', body: JSON.stringify({ query: 'page: 1 price: { lowerBound: 0, upperBound: 2147483647 }' }) }), { source: 'streeteasy', page: 1, lower: 0, upper: 2147483647 });
  let calls = 0;
  const fetcher = withListingRelay(async (url, options) => {
    calls++;
    if (calls === 1) {
      assert.equal(url, 'https://test.onrender.com/fetch');
      assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer ' + 'x'.repeat(40));
      assert.equal(options?.redirect, 'error');
    } else { assert.equal(url, 'https://example.com'); assert.equal(options, undefined); }
    return new Response('ok');
  }, config);
  await fetcher('https://hotpads.com/stamford-ct/condos-for-rent');
  await fetcher('https://example.com');
  await wakeListingRelay(async (url) => { assert.equal(url, 'https://test.onrender.com/health'); return new Response('ok'); }, config);
});
