import { test, expect } from './fixtures.ts';
import { localSearch } from '../src/market.ts';
import { normalizeListing } from '../src/listings.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';

for (const initial of ['checking', 'offline'] as const) {
  test(`a search made while ${initial} ${initial === 'checking' ? 'runs once connected' : 'can be retried'}`, async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let configurations = 0;
    const searches: unknown[] = [];
    const listing = normalizeListing(
      {
        id: 'connection-test',
        addressLine1: '12 Grove Street',
        city: 'Jersey City',
        state: 'NJ',
        zipCode: '07302',
        bedrooms: 1,
        price: 2000,
        status: 'Active',
        url: 'https://www.zillow.com/homedetails/connection-test/',
      },
      { id: 'zillow', name: 'Zillow', kind: 'feed' },
    );
    if (!listing) throw new Error('Invalid fixture');
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/config') {
        configurations++;
        if (configurations === 1 && initial === 'checking') await gate;
        if (configurations === 1 && initial === 'offline')
          return route.fulfill({ status: 503, json: { error: 'Synthetic offline server' } });
        return route.fulfill({ json: { sources: [], commuteConfigured: false } });
      }
      if (url.pathname === '/api/search') {
        searches.push(route.request().postDataJSON());
        const filters = parseFilters(route.request().postDataJSON());
        return route.fulfill({
          json: localSearch([listing], filters, localWorkplace(filters), 'live', [{ id: 'zillow', status: 'searched' }]),
        });
      }
      return route.abort();
    });
    await page.goto('/search');
    await page.getByRole('button', { name: 'Filters', exact: true }).click();
    if (initial === 'offline') await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
    if (initial === 'checking') {
      // Still connecting: the person's search is held, with no error, and runs by itself once connected.
      await expect(page.getByRole('alert').filter({ hasText: 'Still connecting' })).toHaveCount(0);
      expect(searches).toHaveLength(1);
      release();
      await expect.poll(() => searches.length).toBe(2);
    } else {
      await expect(page.getByRole('alert').filter({ hasText: 'Retry the connection' }).first()).toBeVisible();
      // Only the opening search, sent alongside the settings: the person's own search was not sent.
      expect(searches).toHaveLength(1);
      await page.getByRole('button', { name: 'Retry connection', exact: true }).click();
      await expect.poll(() => searches.length).toBe(2);
      await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
      await expect.poll(() => searches.length).toBe(3);
    }
    await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1 matching apartment', exact: true })).toBeVisible();
  });
}
