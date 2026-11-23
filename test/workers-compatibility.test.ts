import { expect, test } from 'bun:test';
import { checkWorkersFetchInit } from './fixtures/workers-fetch.ts';

/** Every module that can run in the Worker: server code and the shared non-UI modules in src/. */
const root = new URL('../', import.meta.url);
const workerModules = ['server/*.ts', 'server/{refresh,routes,sources,storage}/*.ts', 'src/*.ts']
  .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync(root.pathname)])
  .filter((path) => !path.endsWith('.d.ts'));

test('no Worker code asks fetch for an option Cloudflare Workers reject', async () => {
  const sources = await Promise.all(workerModules.map((path) => Bun.file(new URL(path, root)).text()));
  const offenders = workerModules.filter((_, index) => /redirect:\s*['"]error['"]/.test(sources[index]));
  expect(offenders, "use redirect: 'manual' and check the response status instead").toStrictEqual([]);
  expect(workerModules.length).toBeGreaterThan(50);
});

test('test fetches refuse what Workers refuse', async () => {
  expect(() => checkWorkersFetchInit({ redirect: 'error' })).toThrow(/Cloudflare Workers/);
  checkWorkersFetchInit({ redirect: 'manual' });
  checkWorkersFetchInit(undefined);
  await expect((async () => fetch('http://127.0.0.1:9/', { redirect: 'error' }))()).rejects.toThrow(/Cloudflare Workers/);
});
