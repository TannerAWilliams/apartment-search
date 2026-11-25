import { expect, test } from 'bun:test';
import { earlyKey, type EarlyRequests } from '../src/early-key.ts';
import { openingSearchBody, WEB_SEARCH_DEFAULTS, withEarlyRequests } from '../src/early-requests.ts';

test('the app takes a request the page already started, once, and makes every other request itself', async () => {
  const made: string[] = [];
  const fetcher = async (input: string) => (made.push(input), Response.json({ from: 'app' }));
  const body = openingSearchBody();
  expect(JSON.parse(body)).toEqual({ ...WEB_SEARCH_DEFAULTS, includeCommute: true });
  const early: EarlyRequests = {
    [earlyKey('/api/config')]: Promise.resolve(Response.json({ from: 'page' })),
    [earlyKey('/api/search', body)]: Promise.resolve(Response.json({ from: 'page' })),
    [earlyKey('/api/failed')]: Promise.reject(new Error('offline')),
    [earlyKey('/api/refused')]: Promise.resolve(new Response('no', { status: 503 })),
  };
  const fetchEarly = withEarlyRequests(early, fetcher);
  const from = async (response: Promise<Response>) => ((await (await response).json()) as { from: string }).from;
  expect(await from(fetchEarly('/api/config'))).toBe('page');
  // The same request again is made afresh, as is one with another body or made with a token.
  expect(await from(fetchEarly('/api/config'))).toBe('app');
  expect(await from(fetchEarly('/api/search', { method: 'POST', body: '{"region":"nyc"}' }))).toBe('app');
  expect(await from(fetchEarly('/api/search', { method: 'POST', body, headers: { Authorization: 'Bearer token' } }))).toBe('app');
  expect(await from(fetchEarly('/api/search', { method: 'POST', body }))).toBe('page');
  // An early request that failed, or was refused, is made again.
  expect(await from(fetchEarly('/api/failed'))).toBe('app');
  expect(await from(fetchEarly('/api/refused'))).toBe('app');
  expect(made).toEqual(['/api/config', '/api/search', '/api/search', '/api/failed', '/api/refused']);
  // Without a page script (the phone app), every request is the app's own.
  expect(await from(withEarlyRequests(undefined, fetcher)('/api/config'))).toBe('app');
});
