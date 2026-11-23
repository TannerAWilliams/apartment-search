import { expect, test } from 'bun:test';
import { applicationModules } from '../scripts/coverage-scope.ts';

/**
 * Bun reports coverage only for files a test loads, so an untested module would silently drop
 * out of the totals. This loads every application module so each one is measured.
 */

test('every application module loads, so coverage measures all of them', async () => {
  const { measured } = await applicationModules(new URL('../', import.meta.url));
  for (const path of measured) await expect(import(`../${path}`), path).resolves.toBeDefined();
  expect(measured.length > 50).toBeTruthy();
});
