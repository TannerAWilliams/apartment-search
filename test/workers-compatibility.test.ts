import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkWorkersFetchInit } from './fixtures/workers-fetch.ts';

/** Every module that can run in the Worker: server code and the shared non-UI modules in src/. */
const root = new URL('../', import.meta.url);
const workerModules = ['server/*.ts', 'server/routes/*.ts', 'src/*.ts'].flatMap((pattern) => [...new Bun.Glob(pattern).scanSync(root.pathname)])
  .filter((path) => !path.endsWith('.d.ts'));

test('no Worker code asks fetch for an option Cloudflare Workers reject', () => {
  const offenders = workerModules.filter((path) => /redirect:\s*['"]error['"]/.test(readFileSync(new URL(path, root), 'utf8')));
  assert.deepEqual(offenders, [], 'use redirect: \'manual\' and check the response status instead');
  assert.ok(workerModules.length > 50);
});

test('test fetches refuse what Workers refuse', async () => {
  assert.throws(() => checkWorkersFetchInit({ redirect: 'error' }), /Cloudflare Workers/);
  checkWorkersFetchInit({ redirect: 'manual' });
  checkWorkersFetchInit(undefined);
  await assert.rejects(async () => fetch('http://127.0.0.1:9/', { redirect: 'error' }), /Cloudflare Workers/);
});
