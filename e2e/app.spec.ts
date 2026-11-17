import { test, expect, type Page } from 'playwright/test';
import { localSearch } from '../src/market.ts';
import { normalizeListing } from '../src/listings.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';

const fixtures = (count = 1) => Array.from({ length: count }, (_, index) => normalizeListing({
  id: `fixture-${index + 1}`, addressLine1: `${12 + index} Grove Street`, city: 'Jersey City', state: 'NJ', zipCode: '07302',
  latitude: 40.72 + index / 10000, longitude: -74.04, bedrooms: 1, price: 1800 + index * 25,
  status: 'Active', url: `https://streeteasy.com/building/test/${index + 1}`,
}, { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' }));
const now = '2026-11-13T12:00:00Z';
async function mockApp(page: Page, options: { initialRefresh?: boolean; failed?: boolean; searchError?: boolean; listingCount?: number; notices?: string[]; priceHistory?: boolean; discovery?: boolean; commute?: boolean } = {}) {
  const requests: { path: string; method: string; body: any }[] = [];
  const unexpected: string[] = [];
  const listings = fixtures(options.listingCount);
  if (options.commute) Object.assign(listings[0], { transitSeconds: 1801, drivingSeconds: 900, commuteEstimate: { provider: 'TravelTime', arrivalPeriod: 'weekday_morning', checkedAt: now, destination: { label: 'Synthetic test workplace', latitude: 40.75, longitude: -73.98 } } });
  if (options.discovery) Object.assign(listings[0], { bathrooms: 1.5, squareFeet: 900, petsAllowed: true, laundry: 'in_unit' });
  if (options.priceHistory) Object.assign(listings[0], { priceHistory: { sourceId: 'synthetic-fixture', firstObservedAt: '2026-11-01T12:00:00Z', lastObservedAt: now, truncated: true,
    observations: [{ checkedAt: '2026-11-01T12:00:00Z', rent: 1900, priceIncludesFees: false }, { checkedAt: now, rent: 1800, priceIncludesFees: true }] } });
  const refresh = { checking: false, lastCheckedAt: now, sources: [{ id: 'streeteasy-live', name: 'StreetEasy', status: options.failed ? 'failed' : 'updated', checkedAt: now, updatedAt: now, listingCount: listings.length, ...(options.failed ? { error: 'StreetEasy returned HTTP 403. Verification required.' } : {}) }] };
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
      const filters = parseFilters(body); data = localSearch(listings, filters, localWorkplace(filters), 'live', [], options.notices ?? []);
    } else { unexpected.push(url.pathname); return route.fulfill({ status: 500, json: { error: 'Unexpected test endpoint' } }); }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await expect.poll(() => requests.filter(r => r.path === '/api/search').length).toBeGreaterThan(0);
  return { requests, unexpected, listings };
}

test('homepage searches saved all-region inventory without starting a refresh', async ({ page }) => {
  const { requests, unexpected } = await mockApp(page, { initialRefresh: true });
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  expect(requests.filter(r => r.path === '/api/refresh')).toHaveLength(0);
  expect(requests.find(r => r.path === '/api/search')!.body.region).toBe('all');
  const searchesBeforeReload = requests.filter(r => r.path === '/api/search').length;
  await page.reload();
  await expect.poll(() => requests.filter(r => r.path === '/api/search').length).toBeGreaterThan(searchesBeforeReload);
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  expect(requests.filter(r => r.path === '/api/refresh')).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

test('sources exposes blocked refresh honestly and retains cached rentals', async ({ page }) => {
  const { requests } = await mockApp(page, { failed: true });
  await expect(page.getByText('Partial coverage · Some sources unavailable · Details', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resync all connected providers', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await expect(page.getByText('Last attempt failed', { exact: false })).toBeVisible();
  await expect(page.getByText('StreetEasy returned HTTP 403. Verification required.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resync StreetEasy', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not a fresh fetch' })).toBeVisible();
  expect(requests.find(r => r.path === '/api/refresh')!.body.source).toBe('streeteasy-live');
  await page.getByRole('tab', { name: 'Search', exact: true }).click();
  const listOnly = page.getByRole('button', { name: 'List', exact: true });
  if (await listOnly.isVisible()) await listOnly.click();
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
});

test('resync all uses the batch endpoint while browse-only sources stay disabled', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resync unavailable: not connected' }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Resync all connected providers', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path === '/api/refresh').length).toBe(1);
  expect(requests.find(r => r.path === '/api/refresh')!.body).toEqual({ check: 'now', sessionStart: false });
});

test('mouse navigation and browser back restore tabs', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await expect(page).toHaveURL(/#sources$/);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Rental platforms', exact: true }).click();
  await expect(page).toHaveURL(/#marketplaces$/);
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'More', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sources & sync', exact: true })).toBeVisible();
});

test('add-listing form validates empty input and can be cancelled', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await page.getByRole('button', { name: '+ Add listing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a rental listing' })).toBeVisible();
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Add a rental listing' })).toHaveCount(0);
});

test('search failures are visible, not silently treated as zero matches', async ({ page }) => {
  await mockApp(page, { searchError: true });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Search apartments →', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic search unavailable' }).first()).toBeVisible();
});

test('saving survives reload and removal updates saved count', async ({ page }) => {
  await mockApp(page);
  const listOnly = page.getByRole('button', { name: 'List', exact: true });
  if (await listOnly.isVisible()) await listOnly.click();
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Saved (1)', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
  const listAfterReload = page.getByRole('button', { name: 'List', exact: true });
  if (await listAfterReload.isVisible()) await listAfterReload.click();
  await page.getByRole('button', { name: 'Remove saved apartment', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Saved (0)', exact: true })).toBeVisible();
});

test('rent filter sends user input and handles an empty result', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Search apartments →', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path === '/api/search').at(-1)?.body.maxRent).toBe(1000);
  await expect(page.getByRole('button', { name: 'Save apartment', exact: true })).toHaveCount(0);
});

test('search shows source coverage notices instead of hiding data caveats', async ({ page }) => {
  await mockApp(page, { notices: ['Synthetic provider returned partial inventory.'] });
  await expect(page.getByText('1 source coverage note. Review before relying on result completeness.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show coverage notes', exact: true }).click();
  await expect(page.getByText('• Synthetic provider returned partial inventory.', { exact: true })).toBeVisible();
});

test('CSV import can be opened and cancelled without changing saved data', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Saved (0)', exact: true })).toBeVisible();
});

test('Sources tab is keyboard operable', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  const sources = page.getByRole('button', { name: 'Sources & sync', exact: true });
  await sources.focus(); await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#sources$/);
  await expect(page.getByRole('button', { name: 'Resync all connected providers' })).toBeVisible();
});



test('portrait keeps first listing visible and filter cancellation does not search', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const { requests } = await mockApp(page);
  const first = page.getByText('12 Grove Street', { exact: true });
  await expect(first).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Map of matching apartments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resync all connected providers', exact: true })).toHaveCount(0);
  const before = requests.filter(r => r.path === '/api/search').length;
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(first).toBeInViewport();
  expect(requests.filter(r => r.path === '/api/search')).toHaveLength(before);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Search filters', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('portrait-393x852.png'), fullPage: true });
});

test('applied filters, expanded results and search scroll survive navigation', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const { requests } = await mockApp(page, { listingCount: 20 });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: '1 BR', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('5000');
  await page.getByRole('button', { name: 'Search apartments →', exact: true }).click();
  await expect.poll(() => requests.filter(r => r.path === '/api/search').at(-1)?.body.maxRent).toBe(5000);
  expect(requests.filter(r => r.path === '/api/search').at(-1)?.body.bedrooms).toBe(1);
  await expect(page.getByText('1 bedroom · Up to $5,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show more (12 of 20)', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Details for / })).toHaveCount(20);

  const scroller = page.getByTestId('main-scroll');
  await scroller.evaluate((element) => element.scrollTo({ top: 500 }));
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  const searchScroll = await scroller.evaluate((element) => element.scrollTop);
  const searchesBeforeNavigation = requests.filter(r => r.path === '/api/search').length;
  await page.getByRole('tab', { name: 'Saved (0)', exact: true }).click();
  await expect(page.getByText('All apartment sizes · Any price', { exact: true })).toBeVisible();
  await expect(page.getByText('1 bedroom · Up to $5,000', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('tab', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('button', { name: /^Details for / })).toHaveCount(20);
  await expect.poll(async () => Math.abs(await scroller.evaluate((element) => element.scrollTop) - searchScroll)).toBeLessThan(5);
  expect(requests.filter(r => r.path === '/api/search')).toHaveLength(searchesBeforeNavigation);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('button', { name: '1 BR', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true })).toHaveValue('5000');
});


async function openImport(page: Page) {
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import rental listings' })).toBeVisible();
}
const importHeader = 'url,address,unit,city,state,zip,bedrooms,rent';
const importRow = 'https://example.com/apartments/1,100 Test Street,2A,Brooklyn,NY,11201,1,2400';

test('manual entry corrects invalid coordinates then saves and survives reload', async ({ page }) => {
  const { unexpected } = await mockApp(page);
  await page.getByRole('tab', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await page.getByRole('button', { name: '+ Add listing', exact: true }).click();
  await page.getByRole('textbox', { name: 'Listing URL', exact: true }).fill('https://example.com/apartments/manual');
  await page.getByRole('textbox', { name: 'Street address', exact: true }).fill('101 Test Street');
  await page.getByRole('textbox', { name: 'ZIP code', exact: true }).fill('11201');
  await page.getByRole('button', { name: 'Brooklyn', exact: true }).click();
  await page.getByRole('textbox', { name: 'Monthly asking rent ($)', exact: true }).fill('2300');
  await page.getByRole('textbox', { name: 'Latitude, longitude (optional)', exact: true }).fill('91, -73.99');
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Enter valid latitude' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved (0)', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Latitude, longitude (optional)', exact: true }).fill('40.7, -73.99');
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
  await expect(page.getByText('101 Test Street', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('101 Test Street', { exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test('CSV validation is atomic and correcting the bad row recovers', async ({ page }) => {
  await mockApp(page);
  await openImport(page);
  const save = page.getByRole('button', { name: 'Save listings', exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole('textbox', { name: 'Listing CSV', exact: true }).fill(`${importHeader}\n${importRow}\nhttps://example.com/bad,102 Test Street,,Brooklyn,NY,11201,1,invalid`);
  await save.click();
  await expect(page.getByRole('alert').filter({ hasText: 'line 3' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved (0)', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Listing CSV', exact: true }).fill(`${importHeader}\n${importRow}`);
  await save.click();
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
  await expect(page.getByText('100 Test Street, Unit 2A', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('100 Test Street, Unit 2A', { exact: true })).toBeVisible();
});

test('reimporting the same apartment does not duplicate saved inventory', async ({ page }) => {
  await mockApp(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    await openImport(page);
    await page.getByRole('textbox', { name: 'Listing CSV', exact: true }).fill(`${importHeader}\n${importRow}`);
    await page.getByRole('button', { name: 'Save listings', exact: true }).click();
    await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
    await expect(page.getByText('100 Test Street, Unit 2A', { exact: true })).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Remove saved apartment', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Saved (0)', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('100 Test Street, Unit 2A', { exact: true })).toHaveCount(0);
});

test('oversized CSV file rejects safely and a valid file can be selected next', async ({ page }) => {
  await mockApp(page);
  await openImport(page);
  const upload = page.getByLabel('Upload listing CSV', { exact: true });
  await upload.setInputFiles({ name: 'too-large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(256001, 'a') });
  await expect(page.getByRole('alert').filter({ hasText: 'under 256 KB' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save listings', exact: true })).toBeDisabled();
  await upload.setInputFiles({ name: 'valid.csv', mimeType: 'text/csv', buffer: Buffer.from(`${importHeader}\n${importRow}`) });
  await expect(page.getByRole('textbox', { name: 'Listing CSV', exact: true })).toHaveValue(`${importHeader}\n${importRow}`);
  await page.getByRole('button', { name: 'Save listings', exact: true }).click();
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
  await expect(page.getByText('100 Test Street, Unit 2A', { exact: true })).toBeVisible();
});

test('CSV outside supported boroughs reports the restriction without saving', async ({ page }) => {
  await mockApp(page);
  await openImport(page);
  await page.getByRole('textbox', { name: 'Listing CSV', exact: true }).fill(`${importHeader}\nhttps://example.com/nj,12 Grove Street,,Jersey City,NJ,07302,1,1800`);
  await page.getByRole('button', { name: 'Save listings', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Manhattan or Brooklyn ZIP codes' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved (0)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import rental listings' })).toHaveCount(0);
});

test('housing cost inputs require known amounts, calculate, reject invalid input and reset', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Housing cost estimate', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Gross monthly rent', exact: true }).fill('2400');
  await expect(page.getByText('Complete all eight amounts to compare costs; unknown costs are not treated as free.', { exact: true })).toBeVisible();
  const inputs = [
    ['Lease length in months', '12'], ['Total rent concessions over lease', '2400'],
    ['Recurring monthly fees', '100'], ['Nonrefundable upfront fees', '600'],
    ['Refundable deposit', '2400'], ['Rent due at signing', '2400'], ['Recurring fees due at signing', '100'],
  ];
  for (const [name, value] of inputs) await page.getByRole('textbox', { name, exact: true }).fill(value);
  await expect(page.getByText('Average lease cost: $2,350.00/mo', { exact: true })).toBeVisible();
  await expect(page.getByText('Estimated cash at signing: $5,500.00', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Lease length in months', exact: true }).fill('0');
  await expect(page.getByRole('alert').filter({ hasText: '1–120 months' })).toBeVisible();
  await expect(page.getByText('Average lease cost: $2,350.00/mo', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reset housing cost estimate', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Gross monthly rent', exact: true })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Lease length in months', exact: true })).toHaveValue('');
  await expect(page.getByRole('alert').filter({ hasText: '1–120 months' })).toHaveCount(0);
});

test('saved notes and viewing status persist on this device without network writes', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  const notes = page.getByRole('textbox', { name: 'Private apartment notes', exact: true });
  await expect(notes).toBeVisible();
  await notes.fill('Ask about utilities');
  await page.getByRole('button', { name: 'Toured', exact: true }).click();
  await page.getByRole('button', { name: 'Save notes', exact: true }).click();
  await expect(page.getByText('Notes saved on this device.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(notes).toHaveValue('Ask about utilities');
  await expect(page.getByRole('button', { name: 'Toured', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(requests.some(request => JSON.stringify(request.body ?? null).includes('Ask about utilities'))).toBe(false);
});


test('observed timeline distinguishes historical checks from live availability and fee bases', async ({ page }) => {
  const { requests } = await mockApp(page, { priceHistory: true });
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Observed price history', exact: true })).toBeVisible();
  await expect(page.getByText(/Source: synthetic-fixture.*not proof/)).toBeVisible();
  await expect(page.getByText(/\$1,900\/mo · asking rent; fees not confirmed/)).toBeVisible();
  await expect(page.getByText(/\$1,800\/mo · includes reported fees/)).toBeVisible();
  await expect(page.getByText('Older changes were trimmed; showing the most recent 24 observations.', { exact: true })).toBeVisible();
  expect(requests.filter(request => request.path === '/api/refresh')).toHaveLength(0);
});


test('feature filters require reported facts rather than matching unknown details', async ({ page }) => {
  const { requests } = await mockApp(page, { listingCount: 2, discovery: true });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Minimum bathrooms', exact: true }).fill('1.5');
  await page.getByRole('textbox', { name: 'Minimum square feet', exact: true }).fill('900');
  await page.getByRole('button', { name: 'Require pets allowed', exact: true }).click();
  await page.getByRole('button', { name: 'In-unit laundry', exact: true }).click();
  await page.getByRole('button', { name: 'Search apartments →', exact: true }).click();
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  await expect(page.getByText('13 Grove Street', { exact: true })).toHaveCount(0);
  const search = requests.filter(request => request.path === '/api/search').at(-1)!;
  expect(search.body.minBathrooms).toBe(1.5);
  expect(search.body.minSquareFeet).toBe(900);
  expect(search.body.petsRequired).toBe(true);
  expect(search.body.laundry).toBe('in_unit');
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByText(/Source-reported details: 1.5 baths · 900 sq ft/)).toBeVisible();
});

test('saved comparison caps four, enables replacements and clears without removing saved apartments', async ({ page }) => {
  const { requests } = await mockApp(page, { listingCount: 5, discovery: true });
  for (let index = 0; index < 5; index++) await page.getByRole('button', { name: 'Save apartment', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Saved (5)', exact: true }).click();
  await page.getByRole('button', { name: 'Compare saved apartments', exact: true }).click();
  for (let index = 0; index < 4; index++) await page.getByRole('checkbox', { name: `Compare ${12 + index} Grove Street, Jersey City`, exact: true }).click();
  const fifth = page.getByRole('checkbox', { name: 'Compare 16 Grove Street, Jersey City', exact: true });
  await expect(fifth).toBeDisabled();
  await expect(page.getByText('4 of 4 selected. Remove a selection to choose another.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Compare 12 Grove Street, Jersey City', exact: true }).click();
  await expect(fifth).toBeEnabled();
  await fifth.click();
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  await expect(page.getByText('0 of 4 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved (5)', exact: true })).toBeVisible();
  expect(requests.filter(request => request.path === '/api/refresh')).toHaveLength(0);
});


test('saved route context identifies destination, period and estimate rather than live traffic', async ({ page }) => {
  const { requests } = await mockApp(page, { commute: true });
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commute context', exact: true })).toBeVisible();
  await expect(page.getByText('To Synthetic test workplace · weekday-morning arrival', { exact: true })).toBeVisible();
  await expect(page.getByText('Transit: 31 min · Driving: 15 min', { exact: true })).toBeVisible();
  await expect(page.getByText(/This is a saved estimate, not current traffic or a guarantee/)).toBeVisible();
  expect(requests.filter(request => request.path === '/api/refresh')).toHaveLength(0);
});


test('local change checks opt in, seed baseline and show newer observed price changes without refreshing', async ({ page }) => {
  const { requests, listings } = await mockApp(page, { priceHistory: true });
  Object.assign(listings[0], { priceIncludesFees: true });
  await page.reload();
  await page.getByRole('button', { name: 'Local price and discovery changes', exact: true }).click();
  await page.getByRole('button', { name: 'Check this page and save local baseline', exact: true }).click();
  await expect(page.getByText(/Baseline saved. Check again after a later source observation/)).toBeVisible();
  Object.assign(listings[0], { rent: 1700, priceIncludesFees: true, priceHistory: { sourceId: 'synthetic-fixture', firstObservedAt: '2026-11-14T12:00:00Z', lastObservedAt: '2026-11-14T12:00:00Z', truncated: false,
    observations: [{ checkedAt: '2026-11-14T12:00:00Z', rent: 1700, priceIncludesFees: true }] } });
  await page.reload();
  await page.getByRole('button', { name: 'Local price and discovery changes', exact: true }).click();
  await page.getByRole('button', { name: 'Check this page and save local baseline', exact: true }).click();
  await expect(page.getByText('Observed price decrease: $1,800 → $1,700/mo', { exact: true })).toBeVisible();
  expect(requests.filter(request => request.path === '/api/refresh')).toHaveLength(0);
});
