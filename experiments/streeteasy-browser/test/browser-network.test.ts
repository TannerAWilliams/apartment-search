import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route } from 'playwright';
import { guardBrowserRoute } from '../server/browser-network.ts';
function mockRoute(url: string, status = 200) {
  const calls: Array<[string, unknown]> = [];
  const response = { status: () => status, dispose: async () => { calls.push(['dispose', null]); } };
  const route = {
    request: () => ({ url: () => url, resourceType: () => 'document' }),
    fetch: async (options: unknown) => { calls.push(['fetch', options]); return response; },
    fulfill: async (options: unknown) => { calls.push(['fulfill', options]); },
    abort: async (reason: string) => { calls.push(['abort', reason]); },
  };
  return { route: route as unknown as Route, calls, response };
}
test('unapproved initial URL never reaches transport', async () => {
  const { route, calls } = mockRoute('https://169.254.169.254/latest/meta-data');
  await guardBrowserRoute(route);
  assert.deepEqual(calls, [['abort', 'blockedbyclient']]);
});
test('all redirect statuses are stopped before browser receives Location', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const { route, calls } = mockRoute('https://streeteasy.com/for-rent/nyc', status);
    await guardBrowserRoute(route);
    assert.deepEqual(calls[0], ['fetch', { maxRedirects: 0, maxRetries: 0, timeout: 12000 }]);
    assert.deepEqual(calls[1], ['fulfill', { status: 502, contentType: 'text/plain', body: 'Browser redirect blocked by source policy' }]);
    assert.deepEqual(calls[2], ['dispose', null]);
    assert.equal(calls.length, 3);
  }
});
test('successful allowed response is fulfilled and transport buffer released', async () => {
  const { route, calls, response } = mockRoute('https://streeteasy.com/for-rent/nyc');
  await guardBrowserRoute(route);
  assert.deepEqual(calls[1], ['fulfill', { response }]);
  assert.deepEqual(calls[2], ['dispose', null]);
});
