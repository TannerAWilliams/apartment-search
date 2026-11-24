import { test, expect } from './fixtures.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';
import { localSearch } from '../src/market.ts';

test('destination editing stays local until Apply and remains accessible without routing', async ({ page }) => {
  const requests: { workplace: string; customWorkplace: string }[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/config')
      return route.fulfill({ json: { sources: [], commuteConfigured: false, browserImportAllowed: false } });
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      requests.push({ workplace: filters.workplace, customWorkplace: filters.customWorkplace });
      if (filters.customWorkplace === 'Unmatched test address')
        return route.fulfill({
          status: 422,
          json: { error: 'Use a full street address with city, state, and ZIP, or enter coordinates.' },
        });
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live') });
    }
    return route.abort();
  });
  await page.goto('/search');
  await expect(page.getByRole('button', { name: 'Change destination', exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Destination address or place').fill('40.75, -73.98');
  await expect(page.getByText('Automatic transit and driving estimates are unavailable.', { exact: false })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests).toHaveLength(1);
  await expect(page.getByText('Custom workplace', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Destination address or place').fill('40.75, -73.98');
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ workplace: 'custom', customWorkplace: '40.75, -73.98' });
  await expect(page.getByText('Custom workplace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await page.getByLabel('Destination address or place').fill('Unmatched test address');
  expect(requests).toHaveLength(2);
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect(page.getByText('Destination was not changed; previous results are still shown.', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Custom workplace', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
});
