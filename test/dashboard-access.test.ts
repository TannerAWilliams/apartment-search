import { test, expect } from 'bun:test';
import { appConfig, handleApi } from '../server/api.ts';
test('dashboard capability supports public aggregates but fails closed on unconfigured private servers', () => {
  expect(appConfig({ PUBLIC_APP: 'true', APP_ACCESS_TOKEN: 'synthetic-test-only' }).dashboardAvailable).toBe(true);
  expect(appConfig({}).dashboardAvailable).toBe(false);
  expect(appConfig({ APP_ACCESS_TOKEN: '' }).dashboardAvailable).toBe(false);
  expect(appConfig({ APP_ACCESS_TOKEN: 'synthetic-test-only' }).dashboardAvailable).toBe(true);
});

test('public dashboard exposes only allowlisted stored aggregates with no writes or provider requests', async () => {
  let calls = 0;
  const options = { fetcher: async () => { calls++; throw new Error('No provider access allowed'); } };
  const env = { PUBLIC_APP: 'true' };
  const request = (suffix = '', method = 'GET') => new Request('https://app.test/api/dashboard' + suffix, { method });
  const catalog = await handleApi(request(), env, options);
  expect(catalog.status).toBe(200);
  expect((await catalog.json()).files).toHaveLength(45);
  const response = await handleApi(request('?file=rentalIndex_All.csv'), env, options);
  const data = await response.json();
  expect(Object.keys(data).sort()).toEqual(['file', 'provenance']);
  expect(data.provenance.source).toBe('StreetEasy Data Dashboard');
  expect(data.file.months[0]).toBe('2007-01');
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) expect((await handleApi(request('', method), env, options)).status).toBe(405);
  expect((await handleApi(request('?file=../../private-notes'), env, options)).status).toBe(404);
  expect(calls).toBe(0);
});
