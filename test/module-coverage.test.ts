import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { applicationModules } from '../scripts/coverage-scope.ts';

/**
 * Bun reports coverage only for files a test loads, so an untested module would silently drop
 * out of the totals. This loads every application module so each one is measured.
 */
mock.module('cloudflare:workers', () => ({ WorkflowEntrypoint: class { constructor(_ctx: unknown, public env: unknown) {} } }));

test('every application module loads, so coverage measures all of them', async () => {
  const { measured } = applicationModules(new URL('../', import.meta.url));
  for (const path of measured) await assert.doesNotReject(import(`../${path}`), path);
  assert.ok(measured.length > 50);
});
