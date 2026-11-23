import { expect, test } from 'bun:test';
import { createApi } from '../src/api-client.ts';

const respond = (body: string | object, init: ResponseInit = {}) => async () =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' }, ...init });
const search = { matches: [], total: 0, workplace: { label: 'Rockefeller Center', latitude: 40.75, longitude: -73.97 } };

test('valid responses pass through with the retry time', async () => {
  const api = createApi('', respond(search, { headers: { 'X-Refresh-Retry-After': '30', 'Content-Type': 'application/json' } }));
  const result = await api('search');
  expect(result.total).toBe(0);
  expect((result as unknown as { refreshRetryAt: number }).refreshRetryAt > Date.now()).toBeTruthy();
});

test('an HTML error page becomes an ordinary error, not a JSON parse crash', async () => {
  const api = createApi('', respond('<html>502 Bad Gateway</html>', { status: 502 }));
  await expect(api('search')).rejects.toMatchObject({ message: 'Could not reach the apartment search server.', status: 502 });
  await expect(createApi('', respond('<html>ok</html>'))('config')).rejects.toThrow(/unreadable response/);
});

test('server error messages and commute errors are kept', async () => {
  const api = createApi('', respond({ error: 'TravelTime reached its request limit.', commuteError: true }, { status: 503 }));
  await expect(api('search')).rejects.toMatchObject({ message: 'TravelTime reached its request limit.', commuteError: true });
});

test('malformed source statuses and search results are rejected before the UI renders them', async () => {
  await expect(createApi('', respond({ matches: [], total: 0 }))('refresh')).rejects.toThrow(/unrecognized source status/);
  await expect(createApi('', respond({ checking: false, sources: [{ id: 'x' }] }))('refresh')).rejects.toThrow(/unrecognized source status/);
  await expect(createApi('', respond({ matches: [], total: 0, mapPoints: [] }))('search')).rejects.toThrow(/unrecognized search result/);
  expect((await createApi('', respond({ checking: false, sources: [] }))('refresh')).sources).toStrictEqual([]);
});

test('without a server origin, calls fail without a request', async () => {
  let called = false;
  await expect(createApi(null, async () => { called = true; return new Response('{}'); })('config')).rejects.toThrow(/Could not reach/);
  expect(called).toBe(false);
});
