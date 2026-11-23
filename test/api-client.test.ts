import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api-client.ts';

const respond = (body: string | object, init: ResponseInit = {}) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' }, ...init });
const search = { matches: [], total: 0, workplace: { label: 'Rockefeller Center', latitude: 40.75, longitude: -73.97 } };

test('valid responses pass through with the retry time', async () => {
  const api = createApi('', respond(search, { headers: { 'X-Refresh-Retry-After': '30', 'Content-Type': 'application/json' } }));
  const result = await api('search');
  assert.equal(result.total, 0);
  assert.ok((result as unknown as { refreshRetryAt: number }).refreshRetryAt > Date.now());
});

test('an HTML error page becomes an ordinary error, not a JSON parse crash', async () => {
  const api = createApi('', respond('<html>502 Bad Gateway</html>', { status: 502 }));
  await assert.rejects(api('search'), { message: 'Could not reach the apartment search server.', status: 502 });
  await assert.rejects(createApi('', respond('<html>ok</html>'))('config'), /unreadable response/);
});

test('server error messages and commute errors are kept', async () => {
  const api = createApi('', respond({ error: 'TravelTime reached its request limit.', commuteError: true }, { status: 503 }));
  await assert.rejects(api('search'), { message: 'TravelTime reached its request limit.', commuteError: true });
});

test('malformed source statuses and search results are rejected before the UI renders them', async () => {
  await assert.rejects(createApi('', respond({ matches: [], total: 0 }))('refresh'), /unrecognized source status/);
  await assert.rejects(createApi('', respond({ checking: false, sources: [{ id: 'x' }] }))('refresh'), /unrecognized source status/);
  await assert.rejects(createApi('', respond({ matches: [], total: 0, mapPoints: [] }))('search'), /unrecognized search result/);
  assert.deepEqual((await createApi('', respond({ checking: false, sources: [] }))('refresh')).sources, []);
});

test('without a server origin, calls fail without a request', async () => {
  let called = false;
  await assert.rejects(createApi(null, async () => { called = true; return new Response('{}'); })('config'), /Could not reach/);
  assert.equal(called, false);
});
