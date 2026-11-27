import { test, expect, type Page } from './fixtures.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';
import { localSearch } from '../src/market.ts';

/** A visitor who has already said where they work (on this device). */
const knownCommute = (page: Page) =>
  page.addInitScript(() => localStorage.setItem('walkup.commute-place', JSON.stringify({ workplace: 'rockefeller', customWorkplace: '' })));

test('destination editing stays local until Apply and remains accessible without routing', async ({ page }) => {
  await knownCommute(page);
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
  await page.getByLabel('Destination', { exact: true }).fill('40.75, -73.98');
  await expect(page.getByText('Automatic transit and driving estimates are unavailable.', { exact: false })).toHaveCount(0);
  expect(requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(requests).toHaveLength(1);
  await expect(page.getByText('Custom workplace', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await page.getByLabel('Destination', { exact: true }).fill('40.75, -73.98');
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toEqual({ workplace: 'custom', customWorkplace: '40.75, -73.98' });
  await expect(page.getByText('Custom workplace', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await page.getByLabel('Destination', { exact: true }).fill('Unmatched test address');
  expect(requests).toHaveLength(2);
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect(page.getByText('Destination was not changed; previous results are still shown.', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('Custom workplace', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(3);
});

test('a typed destination suggests places from the map, and picking one fills it in', async ({ page }) => {
  await knownCommute(page);
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
  await expect(page.getByRole('button', { name: 'Check address', exact: true })).toHaveCount(0);
  await page.getByLabel('Destination', { exact: true }).fill('empire st');
  await page.getByRole('button', { name: 'Use Empire State Building, 350 5th Avenue, New York', exact: true }).click();
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('Empire State Building, 350 5th Avenue, New York');
  await expect(page.getByText('Commute times will be to Empire State Building, 350 5th Avenue, New York.', { exact: true })).toBeVisible();
  // Asked once typing paused, not once a letter.
  expect(asked).toEqual(['empire st']);
  // Nothing found says so, instead of showing nothing.
  await page.getByLabel('Destination', { exact: true }).fill('zzzz');
  await expect(page.getByText(/No places match “zzzz”/)).toBeVisible();
  // Enter takes the first suggestion.
  await page.getByLabel('Destination', { exact: true }).fill('empire');
  await expect(page.getByRole('button', { name: /^Use Empire State Building/ })).toBeVisible();
  await page.getByLabel('Destination', { exact: true }).press('Enter');
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('Empire State Building, 350 5th Avenue, New York');
});

test('a visitor sets a commute on the profile and is asked to sign in to save it; nothing says it was saved', async ({ page }) => {
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
  await expect(page.getByText(/Sign in to keep it on your account, on every device\./)).toBeVisible();
  await expect(page.getByText('Sign in to save apartments', { exact: true })).toBeVisible();
  await expect(page.getByText(/Kept on this device/)).toHaveCount(0);
  const destination = page.getByLabel('Destination', { exact: true });
  await destination.fill('penn');
  await page.getByRole('button', { name: 'Use Penn Station', exact: true }).click();
  // The button says what saving takes, and opens the sign-in page.
  await expect(page.getByRole('button', { name: 'Save commute', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign in to save', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Create a free account to keep your commute on every device', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your commute', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toHaveCount(0);
  // Their searches use the destination meanwhile.
  await page.goto('/search');
  await expect.poll(() => searched.at(-1)).toEqual({ workplace: 'penn', customWorkplace: '' });
});

test('the commute destination is set once on the profile, kept with the account, and used by the next search', async ({ page }) => {
  const searched: { workplace: string; customWorkplace: string }[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/config')
      return route.fulfill({ json: { sources: [], commuteConfigured: false, account: 'renter@example.test', plan: 'free' } });
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      searched.push({ workplace: filters.workplace, customWorkplace: filters.customWorkplace });
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live') });
    }
    return route.abort();
  });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Your commute', exact: true })).toBeVisible();
  // One search box, holding the destination in use; a well-known place is offered by name as it is typed.
  const destination = page.getByLabel('Destination', { exact: true });
  await expect(destination).toHaveValue('Rockefeller Center');
  await expect(page.getByText(/Kept on your account, on every device\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save commute', exact: true })).toHaveCount(0);
  await destination.fill('penn');
  await page.getByRole('button', { name: 'Use Penn Station', exact: true }).click();
  await expect(destination).toHaveValue('Penn Station');
  await page.getByRole('button', { name: 'Save commute', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Destination', { exact: true })).toHaveValue('Penn Station');
  await page.goto('/');
  await page.getByRole('button', { name: 'Search apartments', exact: true }).click();
  await expect.poll(() => searched.at(-1)).toEqual({ workplace: 'penn', customWorkplace: '' });
  // Opening search afresh shows commute times to the saved destination, with no change needed.
  searched.length = 0;
  await page.goto('/search');
  await expect.poll(() => searched.at(-1)).toEqual({ workplace: 'penn', customWorkplace: '' });
  await expect(page.getByText(/Commute times to/)).toContainText('Penn Station');
});

test('a commute limit is chosen with the destination and sent with the search; there is no ZIP field', async ({ page }) => {
  await knownCommute(page);
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

test('the commute limit is one tap from the results', async ({ page }) => {
  await knownCommute(page);
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
  await page.getByRole('button', { name: 'Commute: Any', exact: true }).click();
  await page.getByRole('menuitem', { name: '45 min', exact: true }).click();
  await expect.poll(() => searched.at(-1)?.maxCommuteMinutes).toBe(45);
  await expect(page.getByRole('button', { name: 'Commute: 45 min', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Commute: 45 min', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Any commute', exact: true }).click();
  await expect.poll(() => searched.at(-1)?.maxCommuteMinutes ?? null).toBeNull();
});

test('before saying where they work, a visitor sees "? min to your job" and is taken to set it', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/config') return route.fulfill({ json: { sources: [], commuteConfigured: false } });
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      return route.fulfill({ json: localSearch([], filters, localWorkplace(filters), 'live') });
    }
    return route.abort();
  });
  await page.goto('/search');
  await expect(page.getByText(/Commute times to Rockefeller Center/)).toHaveCount(0);
  // A visitor is taken to the search's own destination box, not to a profile setting that would seem to save.
  await page.getByRole('button', { name: 'Add where you work to see each commute', exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  const destination = page.getByLabel('Destination', { exact: true });
  await expect(destination).toHaveValue('Rockefeller Center');
  // The place first offered is theirs once applied, without having to change it.
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect(page.getByText(/Commute times to/)).toContainText('Rockefeller Center');
  await page.getByRole('button', { name: 'Change destination', exact: true }).click();
  await destination.fill('grand');
  await page.getByRole('button', { name: 'Use Grand Central Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Apply destination', exact: true }).click();
  await expect(page.getByText(/Commute times to/)).toContainText('Grand Central Terminal');
});
