import { test, expect, type Page } from 'playwright/test';
import { localSearch } from '../src/market.ts';
import { normalizeListing } from '../src/listings.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';

const fixture = normalizeListing({ id: 'fixture-1', addressLine1: '12 Grove Street', city: 'Jersey City', state: 'NJ', zipCode: '07302', latitude: 40.72, longitude: -74.04, bedrooms: 1, price: 1800, status: 'Active', url: 'https://streeteasy.com/building/test/1' }, { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' });
const now = '2026-11-13T12:00:00Z';
async function mockApp(page: Page, options: { initialRefresh?: boolean; failed?: boolean; searchError?: boolean } = {}) {
  const requests: { path: string; method: string; body: any }[] = [];
  const unexpected: string[] = [];
  const refresh = { checking: false, lastCheckedAt: now, sources: [{ id: 'streeteasy-live', name: 'StreetEasy', status: options.failed ? 'failed' : 'updated', checkedAt: now, updatedAt: now, listingCount: 1, ...(options.failed ? { error: 'StreetEasy returned HTTP 403. Verification required.' } : {}) }] };
  if (!options.initialRefresh) await page.addInitScript(() => sessionStorage.setItem('apartment-search:session-refresh', 'checked'));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    // No real provider, image, geocoder, map tile or analytics request leaves the browser.
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = request.postDataJSON();
    requests.push({ path: url.pathname, method: request.method(), body });
    let data: unknown;
    if (url.pathname === '/api/config') data = { mode: 'live', browserImportAllowed: false, commuteConfigured: false, sources: [{ id: 'streeteasy', name: 'StreetEasy' }], sourceCatalog: [{ id: 'streeteasy-live', marketplace: 'streeteasy', name: 'StreetEasy', coverage: 'Synthetic test feed', resyncable: true }], refresh };
    else if (url.pathname === '/api/refresh') data = refresh;
    else if (url.pathname === '/api/search') {
      if (options.searchError && requests.filter(r => r.path === '/api/search').length > 1) return route.fulfill({ status: 503, json: { error: 'Synthetic search unavailable' } });
      const filters = parseFilters(body); data = localSearch([fixture], filters, localWorkplace(filters), 'live');
    } else { unexpected.push(url.pathname); return route.fulfill({ status: 500, json: { error: 'Unexpected test endpoint' } }); }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect.poll(() => requests.filter(r => r.path === '/api/search').length).toBeGreaterThan(0);
  return { requests, unexpected };
}

test('homepage searches all regions and automatically checks once per browser session', async ({ page }) => {
  const { requests, unexpected } = await mockApp(page, { initialRefresh: true });
  await expect.poll(() => requests.filter(r => r.path === '/api/refresh' && r.method === 'POST').length).toBe(1);
  expect(requests.find(r => r.path === '/api/search')!.body.region).toBe('all');
  await page.reload(); await expect(page.getByRole('tab', { name: 'Sources', exact: true })).toBeVisible();
  expect(requests.filter(r => r.path === '/api/refresh' && r.method === 'POST')).toHaveLength(1);
  expect(unexpected).toEqual([]);
});

test('sources exposes blocked refresh honestly and retains cached rentals', async ({ page }) => {
  const { requests } = await mockApp(page, { failed: true });
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page.getByText('Last attempt failed', { exact: false })).toBeVisible();
  await expect(page.getByText('StreetEasy returned HTTP 403. Verification required.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resync StreetEasy', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not a fresh fetch' })).toBeVisible();
  expect(requests.find(r => r.path === '/api/refresh')!.body.source).toBe('streeteasy-live');
  await page.getByRole('tab', { name: 'Rent', exact: true }).click();
  const listOnly = page.getByRole('button', { name: 'List only', exact: true });
  if (await listOnly.isVisible()) await listOnly.click();
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
});

test('resync all uses the batch endpoint while browse-only sources stay disabled', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resync unavailable: not connected' }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Resync all connected providers', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path === '/api/refresh').length).toBe(1);
  expect(requests.find(r => r.path === '/api/refresh')!.body).toEqual({ check: 'now', sessionStart: false });
});

test('mouse navigation and browser back restore tabs', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page).toHaveURL(/#sources$/);
  await page.getByRole('tab', { name: 'Platforms', exact: true }).click();
  await expect(page).toHaveURL(/#marketplaces$/);
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Sources', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('add-listing form validates empty input and can be cancelled', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('button', { name: '+ Add listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a rental listing' })).toBeVisible();
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a rental listing' })).toHaveCount(0);
});

test('search failures are visible, not silently treated as zero matches', async ({ page }) => {
  await mockApp(page, { searchError: true });
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  await page.getByRole('button', { name: 'Search apartments →', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic search unavailable' })).toBeVisible();
});

test('saving survives reload and removal updates saved count', async ({ page }) => {
  await mockApp(page);
  const listOnly = page.getByRole('button', { name: 'List only', exact: true });
  if (await listOnly.isVisible()) await listOnly.click();
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved (1)', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Saved (1)', exact: true }).click();
  const listAfterReload = page.getByRole('button', { name: 'List only', exact: true });
  if (await listAfterReload.isVisible()) await listAfterReload.click();
  await page.getByRole('button', { name: 'Remove saved', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved (0)', exact: true })).toBeVisible();
});

test('rent filter sends user input and handles an empty result', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('button', { name: 'Price ▾', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Search apartments →', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path === '/api/search').at(-1)?.body.maxRent).toBe(1000);
  await expect(page.getByRole('button', { name: 'Save apartment', exact: true })).toHaveCount(0);
});

test('CSV import can be opened and cancelled without changing saved data', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved (0)', exact: true })).toBeVisible();
});

test('Sources tab is keyboard operable', async ({ page }) => {
  await mockApp(page);
  const sources = page.getByRole('tab', { name: 'Sources', exact: true });
  await sources.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#sources$/);
  await expect(page.getByRole('button', { name: 'Resync all connected providers' })).toBeVisible();
});


test('iPhone 17 portrait keeps primary controls inside the screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone17-portrait-chromium', 'Portrait-specific layout qualification');
  await mockApp(page, { failed: true });
  expect(page.viewportSize()).toEqual({ width: 402, height: 681 });
  async function checkLayout(label: string) {
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, contentWidth: document.documentElement.scrollWidth }));
    expect(dimensions.contentWidth, label + ' must not overflow horizontally').toBeLessThanOrEqual(dimensions.width + 1);
    const controls = page.getByRole('tab');
    for (const control of await controls.all()) {
      const box = await control.boundingBox();
      expect(box, label + ': navigation remains rendered').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(403);
    }
    await page.screenshot({ path: testInfo.outputPath(label + '.png'), fullPage: true });
  }
  await checkLayout('rent');
  await page.getByRole('button', { name: 'More filters', exact: true }).click();
  await checkLayout('filters');
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await checkLayout('sources');
  const resync = page.getByRole('button', { name: 'Resync all connected providers', exact: true });
  await expect(resync).toBeVisible();
  const box = await resync.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(402);
  await page.getByRole('tab', { name: 'Platforms', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browse rental platforms', exact: true })).toBeVisible();
  await checkLayout('platforms');
  await page.getByRole('tab', { name: 'Rent', exact: true }).click();
  await page.getByRole('button', { name: '+ Add listing', exact: true }).click();
  await checkLayout('add-listing');
});
