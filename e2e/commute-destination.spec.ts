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

test('a typed destination suggests places from the map, and picking one fills it in', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/config') return route.fulfill({ json: { sources: [], commuteConfigured: false } });
    if (url.pathname === '/api/places') {
      const query: string = route.request().postDataJSON().query;
      asked.push(query);
      if (query.startsWith('zzz')) return route.fulfill({ json: { places: [] } });
      return route.fulfill({
        json: { places: [{ label: 'Empire State Building, 350 5th Avenue, New York', latitude: 40.7484, longitude: -73.9857 }] },
      });
    }
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live') });
    }
    return route.abort();
  });
  await page.goto('/search');
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await page.getByRole('button', { name: 'Custom', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Check address', exact: true })).toHaveCount(0);
  await page.getByLabel('Destination address or place').fill('empire st');
  await page.getByRole('button', { name: 'Use Empire State Building, 350 5th Avenue, New York', exact: true }).click();
  await expect(page.getByLabel('Destination address or place')).toHaveValue('Empire State Building, 350 5th Avenue, New York');
  await expect(page.getByText('Commute times will be to Empire State Building, 350 5th Avenue, New York.', { exact: true })).toBeVisible();
  // Asked once typing paused, not once a letter.
  expect(asked).toEqual(['empire st']);
  // Nothing found says so, instead of showing nothing.
  await page.getByLabel('Destination address or place').fill('zzzz');
  await expect(page.getByText(/No places match “zzzz”/)).toBeVisible();
  // Enter takes the first suggestion.
  await page.getByLabel('Destination address or place').fill('empire');
  await expect(page.getByRole('button', { name: /^Use Empire State Building/ })).toBeVisible();
  await page.getByLabel('Destination address or place').press('Enter');
  await expect(page.getByLabel('Destination address or place')).toHaveValue('Empire State Building, 350 5th Avenue, New York');
});

test('the commute destination is set once on the profile, kept on the device, and used by the next search', async ({ page }) => {
  const searched: { workplace: string; customWorkplace: string }[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/config') return route.fulfill({ json: { sources: [], commuteConfigured: false } });
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      searched.push({ workplace: filters.workplace, customWorkplace: filters.customWorkplace });
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live') });
    }
    return route.abort();
  });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Your commute', exact: true })).toBeVisible();
  await expect(page.getByText(/Commute times on every apartment are to Rockefeller Center\. Kept on this device/)).toBeVisible();
  await page.getByRole('button', { name: 'Penn Station', exact: true }).click();
  await page.getByRole('button', { name: 'Save commute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Commute times on every apartment are to Penn Station\./)).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'Search apartments', exact: true }).click();
  await expect.poll(() => searched.at(-1)).toEqual({ workplace: 'penn', customWorkplace: '' });
});

test('a commute limit is chosen with the destination and sent with the search; there is no ZIP field', async ({ page }) => {
  const searched: Record<string, unknown>[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/config') return route.fulfill({ json: { sources: [], commuteConfigured: false } });
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      searched.push(filters as unknown as Record<string, unknown>);
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live') });
    }
    return route.abort();
  });
  await page.goto('/search');
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await expect(page.getByText('By subway or PATH to Rockefeller Center, estimated.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '30 min', exact: true }).click();
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect.poll(() => searched.at(-1)?.maxCommuteMinutes).toBe(30);
  await expect(page.getByText(/Commute ≤ 30 min/)).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByLabel('ZIP code (optional)')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '30 min', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
