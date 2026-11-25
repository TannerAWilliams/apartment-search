import { test, expect } from './fixtures.ts';
import { localSearch } from '../src/market.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';

test('presets persist and whole-search checks include page101 without refresh or notifications', async ({ page }) => {
  let day = 1;
  const calls: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    calls.push(url.pathname);
    if (url.pathname === '/api/config')
      return route.fulfill({ json: { mode: 'live', sources: [], sourceCatalog: [], commuteConfigured: false, refresh: null } });
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live', [], []) });
    }
    if (url.pathname === '/api/search-check')
      return route.fulfill({
        json: {
          scope: 'all-cached-search-matches',
          total: 101,
          eligible: 101,
          checkedAt: `2026-01-0${day}T12:00:00Z`,
          notices: ['Synthetic partial source.'],
          observations: Array.from({ length: 101 }, (_, i) => ({
            key: String(i),
            label: `Apartment ${i}`,
            sourceId: 'synthetic',
            checkedAt: `2026-01-0${day}T12:00:00Z`,
            rent: i === 100 && day === 2 ? 1900 : 2000,
            includesFees: false,
          })),
        },
      });
    return route.fulfill({ status: 500, json: { error: 'Unexpected endpoint' } });
  });
  await page.goto('/search');
  await expect.poll(() => calls.includes('/api/search')).toBe(true);
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Saved searches', exact: true }).click();
  await page.getByLabel('Saved search name', { exact: true }).fill('Metro homes');
  await page.getByRole('button', { name: 'Save applied search', exact: true }).click();
  await page.getByRole('button', { name: 'Check all matches for Metro homes', exact: true }).click();
  await expect(page.getByText(/checked all 101 matching cached apartments; 101 have usable/)).toBeVisible();
  await expect(page.getByText(/Baseline saved; check again/)).toBeVisible();
  day = 2;
  await page.reload();
  await page.getByRole('button', { name: 'More tools', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Saved searches', exact: true }).click();
  await page.getByRole('button', { name: 'Check all matches for Metro homes', exact: true }).click();
  await expect(page.getByText(/Apartment 100: \$2,000 → \$1,900/)).toBeVisible();
  await page.getByRole('button', { name: 'Apply Metro homes', exact: true }).click();
  await expect.poll(() => calls.filter((path) => path === '/api/search').length).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Remove Metro homes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply Metro homes', exact: true })).toHaveCount(0);
  expect(calls.filter((path) => path === '/api/refresh')).toHaveLength(0);
});
