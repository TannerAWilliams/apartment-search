import { test, expect, type Page } from './fixtures.ts';
import { localSearch } from '../src/market.ts';
import { normalizeListing } from '../src/listings.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';
import type { ListingData } from '../src/domain.ts';
import type { HousingResponse } from '../server/contracts.ts';

const fixtures = (count = 1) =>
  Array.from({ length: count }, (_, index) =>
    normalizeListing(
      {
        id: `fixture-${index + 1}`,
        addressLine1: `${12 + index} Grove Street`,
        city: 'Jersey City',
        state: 'NJ',
        zipCode: '07302',
        latitude: 40.72 + index / 10000,
        longitude: -74.04,
        bedrooms: 1,
        price: 1800 + index * 25,
        status: 'Active',
        url: `https://streeteasy.com/building/test/${index + 1}`,
      },
      { id: 'streeteasy', name: 'StreetEasy', kind: 'feed' },
    ),
  ).filter((listing): listing is ListingData => listing !== null);
const now = '2026-11-13T12:00:00Z';
/** Source checks sent to the server. Opening the app sends none, so each one is a resync the user started. */
type MockRequest = { path: string; method: string; body: Record<string, unknown> | null };
const userRefreshes = (requests: MockRequest[]) => requests.filter((r) => r.path === '/api/refresh' && r.method === 'POST');
/** A one-pixel image for image requests. */
const PIXEL = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';

async function mockApp(
  page: Page,
  options: {
    failed?: boolean;
    searchError?: boolean;
    listingCount?: number;
    notices?: string[];
    priceHistory?: boolean;
    discovery?: boolean;
    commute?: boolean;
    nyc?: boolean;
    dashboardAvailable?: boolean;
    /** The server can show Street View images on cards. */
    streetView?: boolean;
    inventoryExpiresAt?: string;
    housing?: HousingResponse;
    /** The server asks for sign-in until the email-code sign-in succeeds. */
    signIn?: boolean;
    start?: string;
    /** The signed-in account, and whether it is an admin (the app's own token is). */
    account?: string;
    admin?: boolean;
  } = {},
) {
  const requests: MockRequest[] = [];
  const unexpected: string[] = [];
  let signedIn = false;
  let settings = { nightlyResync: true, lastNightly: { at: now, state: 'complete', updated: 12, failed: 1, background: true } };
  let savedOnAccount: unknown[] = [];
  const listings = fixtures(options.listingCount);
  if (options.nyc) Object.assign(listings[0], { city: 'Brooklyn', state: 'NY', county: 'Kings', zip: '11201', region: 'nyc' });
  if (options.commute)
    Object.assign(listings[0], {
      transitSeconds: 1801,
      drivingSeconds: 900,
      commuteEstimate: {
        provider: 'TravelTime',
        arrivalPeriod: 'weekday_morning',
        checkedAt: now,
        destination: { label: 'Synthetic test workplace', latitude: 40.75, longitude: -73.98 },
      },
    });
  if (options.discovery) Object.assign(listings[0], { bathrooms: 1.5, squareFeet: 900, petsAllowed: true, laundry: 'in_unit' });
  if (options.priceHistory)
    Object.assign(listings[0], {
      priceHistory: {
        sourceId: 'synthetic-fixture',
        firstObservedAt: '2026-11-01T12:00:00Z',
        lastObservedAt: now,
        truncated: true,
        observations: [
          { checkedAt: '2026-11-01T12:00:00Z', rent: 1900, priceIncludesFees: false },
          { checkedAt: now, rent: 1800, priceIncludesFees: true },
        ],
      },
    });
  const refresh = {
    checking: false,
    lastCheckedAt: now,
    sources: [
      {
        id: 'streeteasy-live',
        name: 'StreetEasy',
        status: options.failed ? 'failed' : 'updated',
        checkedAt: now,
        updatedAt: now,
        listingCount: listings.length,
        ...(options.failed ? { error: 'StreetEasy returned HTTP 403. Verification required.' } : {}),
      },
    ],
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    // No real provider, image, geocoder, map tile or analytics request leaves the browser.
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    const body = request.postDataJSON();
    requests.push({ path: url.pathname, method: request.method(), body });
    let data: unknown;
    // Street View has an image at the first listing (40.72, -74.04) and none elsewhere.
    if (options.streetView && url.pathname === '/api/street-view')
      return url.searchParams.get('lat') === '40.72000'
        ? route.fulfill({ contentType: 'image/svg+xml', body: PIXEL })
        : route.fulfill({ status: 404, json: { error: 'Street View has no image here.' } });
    if (options.signIn && url.pathname === '/api/auth/email-otp/send-verification-otp') data = { success: true };
    else if (options.signIn && url.pathname === '/api/auth/sign-in/email-otp') {
      if (body?.otp !== '123456') return route.fulfill({ status: 401, json: { message: 'Invalid code' } });
      signedIn = true;
      data = { token: 'session' };
    } else if (options.signIn && !signedIn) return route.fulfill({ status: 401, json: { error: 'Sign in to the private apartment app.' } });
    else if (url.pathname === '/api/config')
      data = {
        mode: 'live',
        storageMode: 'persistent',
        dashboardAvailable: options.dashboardAvailable === true,
        streetViewAvailable: options.streetView === true,
        admin: options.admin ?? true,
        ...(options.account ? { account: options.account } : {}),
        browserImportAllowed: false,
        commuteConfigured: false,
        sources: [{ id: 'streeteasy', name: 'StreetEasy' }],
        sourceCatalog: [
          { id: 'streeteasy-live', marketplace: 'streeteasy', name: 'StreetEasy', coverage: 'Synthetic test feed', resyncable: true },
        ],
        refresh,
      };
    else if (url.pathname === '/api/refresh') data = refresh;
    else if (url.pathname === '/api/settings') {
      if (body) settings = { ...settings, nightlyResync: body.nightlyResync };
      data = { ...settings, admin: options.admin ?? true };
    } else if (url.pathname === '/api/saved' && options.account) {
      if (body) savedOnAccount = body.listings;
      data = { listings: savedOnAccount };
    } else if (url.pathname === '/api/housing' && options.housing) data = options.housing;
    else if (url.pathname === '/api/building-report' && options.nyc)
      data = {
        status: 'matched',
        checkedAt: now,
        identity: { address: '12 Grove Street, 11201', borough: 'BROOKLYN', buildingId: '123', bin: '3000001', bbl: '3000120004' },
        openViolations: 2,
        complaintsLast365Days: 3,
        since: '2025-11-14',
        requests311: { total: 5, topProblems: [{ problem: 'Heat / hot water', count: 4 }] },
        taxLotOwner: { name: 'EXAMPLE PROPERTY LLC', bbl: '3000120004', edition: '26v2' },
        rentRegistration: { matched: true, latestYear: 2026, registeredUnits: 18 },
        bedbugs: null,
        dob: null,
        flood: null,
        errors: [],
      };
    else if (url.pathname === '/api/search') {
      if (options.searchError && requests.filter((r) => r.path === '/api/search').length > 1)
        return route.fulfill({ status: 503, json: { error: 'Synthetic search unavailable' } });
      const filters = parseFilters(body);
      data = {
        ...localSearch(listings, filters, localWorkplace(filters), 'live', [], options.notices ?? []),
        ...(options.inventoryExpiresAt ? { inventoryExpiresAt: options.inventoryExpiresAt } : {}),
      };
    } else {
      unexpected.push(url.pathname);
      return route.fulfill({ status: 500, json: { error: 'Unexpected test endpoint' } });
    }
    await route.fulfill({ json: data });
  });
  await page.goto(options.start ?? '/#results');
  // Signed out, the app searches only after sign-in.
  if (!options.signIn) await expect.poll(() => requests.filter((r) => r.path === '/api/search').length).toBeGreaterThan(0);
  return { requests, unexpected, listings };
}

test('homepage searches saved all-region inventory without starting a refresh', async ({ page }) => {
  const { requests, unexpected } = await mockApp(page);
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
  expect(requests.find((r) => r.path === '/api/search')!.body?.region).toBe('all');
  const searchesBeforeReload = requests.filter((r) => r.path === '/api/search').length;
  await page.reload();
  await expect.poll(() => requests.filter((r) => r.path === '/api/search').length).toBeGreaterThan(searchesBeforeReload);
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

test('sources exposes blocked refresh honestly and retains cached rentals', async ({ page }) => {
  const { requests } = await mockApp(page, { failed: true });
  await expect(page.getByText('Partial coverage · Some sources unavailable · Details', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resync all connected providers', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await expect(page.getByText('Last attempt failed', { exact: false })).toBeVisible();
  await expect(page.getByText('StreetEasy returned HTTP 403. Verification required.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resync StreetEasy', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'not a fresh fetch' })).toBeVisible();
  expect(userRefreshes(requests)[0].body?.source).toBe('streeteasy-live');
  await page.getByRole('tab', { name: 'Search', exact: true }).click();
  const listOnly = page.getByRole('button', { name: 'List', exact: true });
  if (await listOnly.isVisible()) await listOnly.click();
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
});

test('resync all uses the batch endpoint while browse-only sources stay disabled', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  // Sites the app does not read are listed by name, not offered as disabled resync buttons.
  await expect(page.getByText(/aren’t read by the app; open them from Rental platforms/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resync unavailable: not connected' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Resync all connected providers', exact: true }).click();
  await expect.poll(() => userRefreshes(requests).length).toBe(1);
  expect(userRefreshes(requests)[0].body).toEqual({ check: 'now' });
});

test('mouse navigation and browser back restore tabs', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await expect(page).toHaveURL(/#sources$/);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Rental platforms', exact: true }).click();
  await expect(page).toHaveURL(/#marketplaces$/);
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Profile', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Sources & sync', exact: true })).toBeVisible();
});

test('search failures are visible, not silently treated as zero matches', async ({ page }) => {
  await mockApp(page, { searchError: true });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
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
  await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
  await expect.poll(() => requests.filter((r) => r.path === '/api/search').at(-1)?.body?.maxRent).toBe(1000);
  await expect(page.getByRole('button', { name: 'Save apartment', exact: true })).toHaveCount(0);
});

test('search shows source coverage notices instead of hiding data caveats', async ({ page }) => {
  await mockApp(page, { notices: ['Synthetic provider returned partial inventory.'] });
  await expect(page.getByText('1 coverage note ▾', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show coverage notes', exact: true }).click();
  await expect(page.getByText('• Synthetic provider returned partial inventory.', { exact: true })).toBeVisible();
});

test('Sources tab is keyboard operable', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  const sources = page.getByRole('button', { name: 'Sources & sync', exact: true });
  await sources.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#sources$/);
  await expect(page.getByRole('button', { name: 'Resync all connected providers' })).toBeVisible();
});

test('the map view loads its tiles under the Content Security Policy', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  // A request event means the policy allowed the tile; the mock then aborts it so nothing leaves the browser.
  const tiles: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith('https://tile.openstreetmap.org/')) tiles.push(request.url());
  });
  await mockApp(page);
  // Listing cards show a map tile each; the map then asks for its own.
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  await expect.poll(() => tiles.length).toBeGreaterThan(0);
  const before = tiles.length;
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Map of matching apartments', exact: true })).toBeVisible();
  await expect.poll(() => tiles.length).toBeGreaterThan(before);
  // A pin's pop-up saves its listing, and its links open in a new tab.
  const popup = page.locator('.leaflet-popup-content');
  // The map may still be settling on its pins; click until the pop-up stays open.
  await expect(async () => {
    if (!(await popup.isVisible())) await page.locator('.leaflet-marker-icon').first().click();
    await expect(popup).toBeVisible({ timeout: 1000 });
  }).toPass();
  await expect(popup.getByRole('link').first()).toHaveAttribute('target', '_blank');
  await popup
    .getByRole('button', { name: /^Save / })
    .first()
    .click();
  await expect(popup.getByRole('button', { name: /^Saved: / }).first()).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'Saved (1)', exact: true })).toBeVisible();
});

test('cards show a Street View image where there is one, and the map elsewhere', async ({ page }) => {
  const { requests } = await mockApp(page, { streetView: true, listingCount: 2 });
  await expect(page.getByText('12 Grove Street', { exact: true }).first()).toBeVisible();
  // Both cards ask; the mock has an image only at the first listing's point.
  await expect.poll(() => requests.filter(({ path }) => path === '/api/street-view').length).toBeGreaterThanOrEqual(2);
  // One card shows its Street View image; the other, with none, went back to its map.
  await expect(page.locator('img[src*="/api/street-view"]')).toHaveCount(1);
});

test('without Street View set up, cards never ask for it', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/street-view')) asked.push(request.url());
  });
  await mockApp(page);
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  expect(asked).toEqual([]);
});

test('tapping a card opens its details, where the listing site opens in a new tab', async ({ page }) => {
  await mockApp(page);
  const card = page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true });
  await expect(page.getByRole('link', { name: /^Open on / })).toHaveCount(0);
  await card.click();
  await expect(card).toHaveAttribute('aria-expanded', 'true');
  const link = page.getByRole('link', { name: /^Open on / }).first();
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  // The heart saves without opening or closing the card.
  await page.getByRole('button', { name: 'Save apartment', exact: true }).click();
  await expect(card).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Hide details', exact: true }).click();
  await expect(page.getByRole('link', { name: /^Open on / })).toHaveCount(0);
});

test('portrait keeps first listing visible and filter cancellation does not search', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const { requests } = await mockApp(page);
  const first = page.getByText('12 Grove Street', { exact: true });
  await expect(first).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Map', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Map of matching apartments', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resync all connected providers', exact: true })).toHaveCount(0);
  const before = requests.filter((r) => r.path === '/api/search').length;
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(first).toBeInViewport();
  expect(requests.filter((r) => r.path === '/api/search')).toHaveLength(before);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true })).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Filters', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('portrait-393x852.png'), fullPage: true });
});

test('applied filters, expanded results and search scroll survive navigation', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const { requests } = await mockApp(page, { listingCount: 20 });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: '1 BR', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('5000');
  await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
  await expect.poll(() => requests.filter((r) => r.path === '/api/search').at(-1)?.body?.maxRent).toBe(5000);
  expect(requests.filter((r) => r.path === '/api/search').at(-1)?.body?.bedrooms).toBe(1);
  await expect(page.getByText('1 bedroom · Up to $5,000', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show more (12 of 20)', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Details for / })).toHaveCount(20);

  const scroller = page.getByTestId('main-scroll');
  // React Native Web replaces this element's scrollTo with its own ({ x, y, animated }) version, so set
  // the DOM position directly for an instant scroll.
  await scroller.evaluate((element) => {
    element.scrollTop = 500;
  });
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(500);
  const searchScroll = 500;
  const searchesBeforeNavigation = requests.filter((r) => r.path === '/api/search').length;
  await page.getByRole('tab', { name: 'Saved (0)', exact: true }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await expect(page.getByText('1 bedroom · Up to $5,000', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('tab', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('button', { name: /^Details for / })).toHaveCount(20);
  await expect.poll(async () => Math.abs((await scroller.evaluate((element) => element.scrollTop)) - searchScroll)).toBeLessThan(5);
  expect(requests.filter((r) => r.path === '/api/search')).toHaveLength(searchesBeforeNavigation);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('button', { name: '1 BR', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true })).toHaveValue('5000');
});

test('housing cost inputs require known amounts, calculate, reject invalid input and reset', async ({ page }) => {
  await mockApp(page);
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await page.getByRole('button', { name: 'Estimate the full cost of renting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Housing cost estimate', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Gross monthly rent', exact: true }).fill('2400');
  await expect(
    page.getByText('Complete all eight amounts to compare costs; unknown costs are not treated as free.', { exact: true }),
  ).toBeVisible();
  const inputs = [
    ['Lease length in months', '12'],
    ['Total rent concessions over lease', '2400'],
    ['Recurring monthly fees', '100'],
    ['Nonrefundable upfront fees', '600'],
    ['Refundable deposit', '2400'],
    ['Rent due at signing', '2400'],
    ['Recurring fees due at signing', '100'],
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
  await expect(page.getByRole('button', { name: 'Toured', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(requests.some((request) => JSON.stringify(request.body ?? null).includes('Ask about utilities'))).toBe(false);
});

test('observed timeline distinguishes historical checks from live availability and fee bases', async ({ page }) => {
  const { requests } = await mockApp(page, { priceHistory: true });
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Observed price history', exact: true })).toBeVisible();
  await expect(page.getByText(/Seen on synthetic-fixture.*not proof/)).toBeVisible();
  await expect(page.getByText(/\$1,900\/mo · asking rent; fees not confirmed/)).toBeVisible();
  await expect(page.getByText(/\$1,800\/mo · includes reported fees/)).toBeVisible();
  await expect(page.getByText('Older changes were trimmed; showing the most recent 24 observations.', { exact: true })).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
});

test('feature filters require reported facts rather than matching unknown details', async ({ page }) => {
  const { requests } = await mockApp(page, { listingCount: 2, discovery: true });
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: /^More filters/ }).click();
  await page.getByRole('textbox', { name: 'Minimum bathrooms', exact: true }).fill('1.5');
  await page.getByRole('textbox', { name: 'Minimum square feet', exact: true }).fill('900');
  await page.getByRole('button', { name: 'Require pets allowed', exact: true }).click();
  await page.getByRole('button', { name: 'In-unit laundry', exact: true }).click();
  await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  await expect(page.getByText('13 Grove Street', { exact: true })).toHaveCount(0);
  const search = requests.filter((request) => request.path === '/api/search').at(-1)!;
  expect(search.body?.minBathrooms).toBe(1.5);
  expect(search.body?.minSquareFeet).toBe(900);
  expect(search.body?.petsRequired).toBe(true);
  expect(search.body?.laundry).toBe('in_unit');
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByText(/Source-reported details: 1.5 baths · 900 sq ft/)).toBeVisible();
});

test('saved comparison caps four, enables replacements and clears without removing saved apartments', async ({ page }) => {
  const { requests } = await mockApp(page, { listingCount: 5, discovery: true });
  for (let index = 0; index < 5; index++) await page.getByRole('button', { name: 'Save apartment', exact: true }).first().click();
  await page.getByRole('tab', { name: 'Saved (5)', exact: true }).click();
  await page.getByRole('button', { name: 'Compare saved apartments', exact: true }).click();
  for (let index = 0; index < 4; index++)
    await page.getByRole('checkbox', { name: `Compare ${12 + index} Grove Street, Jersey City`, exact: true }).click();
  const fifth = page.getByRole('checkbox', { name: 'Compare 16 Grove Street, Jersey City', exact: true });
  await expect(fifth).toBeDisabled();
  await expect(page.getByText('4 of 4 selected. Remove a selection to choose another.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Compare 12 Grove Street, Jersey City', exact: true }).click();
  await expect(fifth).toBeEnabled();
  await fifth.click();
  await page.getByRole('button', { name: 'Clear comparison', exact: true }).click();
  await expect(page.getByText('0 of 4 selected', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Saved (5)', exact: true })).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
});

test('saved route context identifies destination, period and estimate rather than live traffic', async ({ page }) => {
  const { requests } = await mockApp(page, { commute: true });
  await page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commute context', exact: true })).toBeVisible();
  await expect(page.getByText('To Synthetic test workplace · weekday-morning arrival', { exact: true })).toBeVisible();
  await expect(page.getByText('Transit: 31 min · Driving: 15 min', { exact: true })).toBeVisible();
  await expect(page.getByText(/This is a saved estimate, not current traffic or a guarantee/)).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
});

test('local change checks opt in, seed baseline and show newer observed price changes without refreshing', async ({ page }) => {
  const { requests, listings } = await mockApp(page, { priceHistory: true });
  Object.assign(listings[0], { priceIncludesFees: true });
  await page.reload();
  await page.getByRole('button', { name: 'Price changes found by a local check', exact: true }).click();
  await page.getByRole('button', { name: 'Check for changes', exact: true }).click();
  await expect(page.getByText(/Baseline saved. Check again after a later source observation/)).toBeVisible();
  Object.assign(listings[0], {
    rent: 1700,
    priceIncludesFees: true,
    priceHistory: {
      sourceId: 'synthetic-fixture',
      firstObservedAt: '2026-11-14T12:00:00Z',
      lastObservedAt: '2026-11-14T12:00:00Z',
      truncated: false,
      observations: [{ checkedAt: '2026-11-14T12:00:00Z', rent: 1700, priceIncludesFees: true }],
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Price changes found by a local check', exact: true }).click();
  await page.getByRole('button', { name: 'Check for changes', exact: true }).click();
  await expect(page.getByText('Observed price decrease: $1,800 → $1,700/mo', { exact: true })).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
});

test('NYC building records load when opened in Details and reuse the completed session cache', async ({ page }) => {
  const { requests, unexpected } = await mockApp(page, { nyc: true });
  const details = page.getByRole('button', { name: 'Details for 12 Grove Street', exact: true });
  const records = page.getByRole('button', { name: 'NYC building records', exact: true });
  expect(requests.filter((item) => item.path === '/api/building-report')).toHaveLength(0);
  await details.click();
  // Details alone asks for nothing; the records load when opened.
  expect(requests.filter((item) => item.path === '/api/building-report')).toHaveLength(0);
  await records.click();
  await expect(page.getByText('Official building report: matched', { exact: true })).toBeVisible();
  await expect(page.getByText('311 service requests on this tax lot in the last 365 days: 5.', { exact: true })).toBeVisible();
  await expect(page.getByText('EXAMPLE PROPERTY LLC · NYC PLUTO tax-lot owner · 26v2', { exact: true })).toBeVisible();
  await expect(
    page.getByText('State rent registration on this tax lot · latest filing year 2026 · 18 registered units reported.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Apartment-level stabilization status: unverified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check official HPD records', exact: true })).toHaveCount(0);
  expect(requests.filter((item) => item.path === '/api/building-report')).toHaveLength(1);
  await details.click();
  await details.click();
  await records.click();
  await expect(page.getByText('Official building report: matched', { exact: true })).toBeVisible();
  expect(requests.filter((item) => item.path === '/api/building-report')).toHaveLength(1);
  expect(userRefreshes(requests)).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

test('market history charts one area, compares another, and says when figures cannot be loaded', async ({ page }) => {
  await mockApp(page, { dashboardAvailable: true });
  const months = Array.from({ length: 34 }, (_, index) => {
    const month = index + 8; // 2024-09 .. 2027-06 clipped below
    return `${2024 + Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`;
  }).filter((month) => month <= '2026-10');
  const series = (name: string, metric: string, segment: string, label: string, unit: string) => ({
    name,
    metric,
    segment,
    label,
    unit,
    market: 'Rentals',
    firstMonth: '2010-01',
    lastMonth: '2026-10',
  });
  const catalog = {
    provenance: {
      source: 'StreetEasy Data Dashboard',
      url: 'https://streeteasy.com/blog/data-dashboard/',
      downloadedAt: '2026-11-17',
      note: '',
    },
    latestMonth: '2026-10',
    series: [
      series('medianAskingRent_All.csv', 'medianAskingRent', 'All', 'Median asking rent', 'USD'),
      series('medianAskingRent_OneBd.csv', 'medianAskingRent', 'OneBd', 'Median asking rent', 'USD'),
      series('rentalInventory_All.csv', 'rentalInventory', 'All', 'Rental inventory', 'count'),
      series('discountShare_All.csv', 'discountShare', 'All', 'Rental price-cut share', 'share'),
    ],
    areas: [
      { id: 1, name: 'NYC', borough: '', type: 'city' },
      { id: 2, name: 'Brooklyn', borough: 'Brooklyn', type: 'borough' },
      { id: 3, name: 'Park Slope', borough: 'Brooklyn', type: 'neighborhood' },
      { id: 4, name: 'DUMBO', borough: 'Brooklyn', type: 'neighborhood' },
    ],
  };
  const level = (name: string, area: number) =>
    name.startsWith('discountShare') ? 0.12 + area / 100 : name.startsWith('rentalInventory') ? 1000 * area : 3000 + 100 * area;
  let failValues = true;
  await page.route('**/api/history**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/history') return route.fulfill({ json: catalog });
    if (url.pathname === '/api/history/values') {
      if (failValues) return route.fulfill({ status: 503, json: { error: 'Synthetic outage' } });
      const names = url.searchParams.get('series')!.split(',');
      const areas = url.searchParams.get('areas')!.split(',');
      const shown = months.filter((month) => month >= url.searchParams.get('from')! && month <= url.searchParams.get('to')!);
      const values = Object.fromEntries(
        names.map((name) => [
          name,
          Object.fromEntries(
            areas.map((area) => [area, shown.map((month, index) => (month === '2026-03' ? null : level(name, Number(area)) + index * 10))]),
          ),
        ]),
      );
      return route.fulfill({ json: { months: shown, values } });
    }
    const name = url.searchParams.get('series')!;
    return route.fulfill({
      json: {
        series: name,
        month: '2026-10',
        yearAgo: '2025-10',
        rows: [3, 4].map((area) => ({ area, value: level(name, area) + 250, yearAgo: level(name, area) })),
      },
    });
  });
  // The snapshot's own figures: a state's boroughs and cities, a borough's neighborhoods, or ZIP codes.
  const sizes = [3000, 3500, 4200, 5000, 6000].map((median) => ({ median, count: 4 }));
  const marketRequests: string[] = [];
  await page.route('**/api/market**', async (route) => {
    const url = new URL(route.request().url());
    const region = url.searchParams.get('region')!;
    const grouping = url.searchParams.get('grouping')!;
    marketRequests.push(region + '|' + grouping);
    const area = (id: string, label: string, detail: string) => ({ id, label, detail, count: 20, sizes });
    const nj = region !== 'nyc';
    const areas = [
      area('overall', 'All covered areas', ''),
      ...(grouping === 'city'
        ? [area('Brooklyn, NY', 'Brooklyn, NY', ''), ...(nj ? [area('Jersey City, NJ', 'Jersey City, NJ', '')] : [])]
        : grouping === 'neighborhood'
          ? [area('Brooklyn, NY|Park Slope', 'Park Slope', 'Brooklyn, NY'), area('Brooklyn, NY|DUMBO', 'DUMBO', 'Brooklyn, NY')]
          : [area('11215', '11215', 'NY'), area('11101', '11101', 'NY')]),
    ];
    return route.fulfill({ json: { month: '2026-10', areas, history: [] } });
  });
  await page.getByRole('tab', { name: 'Market', exact: true }).click();
  await page.getByRole('button', { name: 'Market history 2010–2026', exact: true }).click();
  await expect(page.getByText('These figures could not be loaded. No values have been substituted; try again shortly.')).toBeVisible();

  failValues = false;
  await page.getByPlaceholder('Neighborhood or borough').first().fill('park');
  await page.getByRole('button', { name: 'Park Slope · Brooklyn', exact: true }).click();
  await expect(page.getByText('Area: Park Slope (Brooklyn)', { exact: true })).toBeVisible();
  // The headline sentence, the tiles and the ranking agree on one month and one set of figures.
  await expect(page.getByText(/Median asking rent in Park Slope was/)).toContainText('$3,550');
  await expect(page.getByText('Park Slope is number 2 of 2 in Brooklyn, highlighted.', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Neighborhood or borough').nth(1).fill('dumbo');
  await page.getByRole('button', { name: 'DUMBO · Brooklyn', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop comparing DUMBO', exact: true })).toBeVisible();
  // Every chart has its table; a month StreetEasy left blank reads as such, never as zero.
  const trend = page.getByRole('button', { name: 'Show table', exact: true }).first();
  await trend.click();
  await expect(page.getByText('Mar 2026', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Since 2010', exact: true }).click();
  await page.getByRole('button', { name: 'Stop comparing DUMBO', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop comparing DUMBO', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to rent trends', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Market history', exact: true })).toHaveCount(0);

  // State, then borough, then neighborhood: each choice is what the chart shows.
  await page.getByRole('button', { name: 'New York', exact: true }).click();
  await expect.poll(() => marketRequests).toContain('nyc|city');
  await expect(page.getByText('Median asking rent over time: New York', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Borough Brooklyn, NY', exact: true }).click();
  await expect(page.getByText('Median asking rent over time: Brooklyn, NY', { exact: true })).toBeVisible();
  await expect.poll(() => marketRequests).toContain('nyc|neighborhood');
  await page.getByRole('button', { name: 'Neighborhood Park Slope', exact: true }).click();
  await expect(page.getByText('Median asking rent over time: Park Slope', { exact: true })).toBeVisible();
  // The table lists the neighborhood's neighbors; a row charts it.
  await page.getByRole('button', { name: 'Show chart for DUMBO Brooklyn, NY', exact: true }).click();
  await expect(page.getByText('Median asking rent over time: DUMBO', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Neighborhood Park Slope', exact: true }).click();

  // A neighborhood links to the same neighborhood's StreetEasy history since 2010.
  await page.getByRole('link', { name: 'Park Slope since 2010 (StreetEasy) →', exact: true }).click();
  await expect(page.getByText('Area: Park Slope (Brooklyn)', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to rent trends', exact: true }).click();

  // A ZIP code charts that ZIP; one outside New York looks in both states, and an empty one says so.
  const zip = page.getByLabel('ZIP code', { exact: true });
  await zip.fill('11215');
  await expect(page.getByText('Median asking rent over time: 11215', { exact: true })).toBeVisible();
  await expect.poll(() => marketRequests).toContain('nyc|zip');
  await expect(page.getByRole('link', { name: /since 2010/ })).toHaveCount(0);
  await zip.fill('07302');
  await expect.poll(() => marketRequests).toContain('all|zip');
  await expect(page.getByText('No listings in 07302', { exact: true })).toBeVisible();

  // New Jersey: its cities, and no StreetEasy link (StreetEasy covers New York City only).
  await page.getByRole('button', { name: 'New Jersey', exact: true }).click();
  await page.getByRole('button', { name: 'City Jersey City, NJ', exact: true }).click();
  await expect(page.getByText('Median asking rent over time: Jersey City, NJ', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /since 2010/ })).toHaveCount(0);

  // The logo and title go home, to Market, from anywhere.
  await page.getByRole('tab', { name: /^Saved/ }).click();
  await page.getByRole('link', { name: 'Walkup, home', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Market', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('iPhone 17 portrait keeps primary controls inside the screen', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone17-portrait-chromium', 'Portrait-specific layout qualification');
  await mockApp(page, { failed: true });
  expect(page.viewportSize()).toEqual({ width: 402, height: 681 });
  async function checkLayout(label: string, checkNavigation = true) {
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      contentWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.contentWidth, label + ' must not overflow horizontally').toBeLessThanOrEqual(dimensions.width + 1);
    if (checkNavigation) {
      const controls = page.getByRole('tab');
      await expect(controls).toHaveCount(4);
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        expect(box, label + ': navigation remains rendered').not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(-1);
        expect(box!.x + box!.width).toBeLessThanOrEqual(403);
      }
    }
    await page.screenshot({ path: testInfo.outputPath(label + '.png'), fullPage: true });
  }
  await checkLayout('search');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Filters', exact: true })).toBeVisible();
  await checkLayout('filters', false); // Modal hides background navigation from accessibility tree.
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Filters', exact: true })).toBeHidden();
  await checkLayout('filters-dismissed');
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Sources & sync', exact: true }).click();
  await checkLayout('sources');
  const resync = page.getByRole('button', { name: 'Resync all connected providers', exact: true });
  await expect(resync).toBeVisible();
  const box = await resync.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(402);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Rental platforms', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browse rental platforms', exact: true })).toBeVisible();
  await checkLayout('platforms');
  await page.getByRole('tab', { name: 'Search', exact: true }).click();
  await checkLayout('search-return');
});

test('unavailable dashboard capability explains access without requesting source bytes', async ({ page }) => {
  const { requests } = await mockApp(page);
  await page.getByRole('tab', { name: 'Market', exact: true }).click();
  await page.getByRole('button', { name: 'Market history 2010–2026', exact: true }).click();
  await expect(
    page.getByText(
      'Market history is unavailable on this server. Connect to a server with dashboard access; a private server requires authentication.',
      { exact: true },
    ),
  ).toBeVisible();
  expect(requests.filter((request) => request.path.startsWith('/api/history'))).toHaveLength(0);
});

test('signing in with an email code opens the app', async ({ page }) => {
  const { requests, unexpected } = await mockApp(page, { signIn: true, start: '/' });
  await page.getByLabel('Email', { exact: true }).fill('Renter@Example.test');
  await page.getByRole('button', { name: 'Email me a sign-in code', exact: true }).click();
  await expect(page.getByText('If renter@example.test can sign in, a code is on its way.', { exact: false })).toBeVisible();
  await page.getByLabel('Sign-in code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Check the code and try again.' })).toBeVisible();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Signing in opens the market overview, not the search filters.
  await expect(page.getByRole('tab', { name: 'Market', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Filters', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Search', exact: true }).click();
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  expect(requests.find((r) => r.path === '/api/auth/email-otp/send-verification-otp')?.body).toEqual({
    email: 'renter@example.test',
    type: 'sign-in',
  });
  expect(unexpected.filter((path) => path !== '/api/market')).toEqual([]);
});

test('Jersey City affordable notices show with official links and stay out of apartment search', async ({ page }) => {
  const { requests, unexpected } = await mockApp(page, {
    housing: {
      publishedAt: null,
      checkedAt: null,
      opportunities: [],
      rerentals: null,
      jersey: {
        revision: '2026-11-16',
        checkedAt: now,
        total: 3,
        sourceUrl: 'https://www.jerseycitynj.gov/CityHall/HousingAndDevelopment/affordable_housing/recent_affordable_housing_postings',
        applicationUrl: 'https://affordablehousingjc.com/',
        notices: [
          {
            id: 'fixture',
            name: 'Example affordable building',
            address: '10 Example St, Jersey City, NJ 07302',
            sizes: [1, 2, 0, 0, 0],
            total: 3,
          },
        ],
      },
    },
  });
  await expect(page.getByText('Example affordable building', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Affordable housing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jersey City affordable housing applications' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Example affordable building', exact: true })).toBeVisible();
  await expect(page.getByText('1 BR · 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Jersey City application portal' })).toHaveAttribute(
    'href',
    'https://affordablehousingjc.com/',
  );
  await page.getByRole('tab', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Example affordable building', { exact: true })).toHaveCount(0);
  expect(userRefreshes(requests)).toHaveLength(0);
  expect(unexpected).toEqual([]);
});

for (const width of [320, 375, 390]) {
  test(`narrow ${width}px navigation keeps Affordable housing fully reachable`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 740 });
    await mockApp(page);
    await expect(page.getByRole('tab')).toHaveCount(4);
    await page.getByRole('tab', { name: 'Profile', exact: true }).click();
    const affordable = page.getByRole('button', { name: 'Affordable housing', exact: true });
    await expect(affordable).toBeVisible();
    const measure = await affordable.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      const text = range.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        textLeft: text.left,
        textRight: text.right,
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      };
    });
    expect(measure.left).toBeGreaterThanOrEqual(0);
    expect(measure.right).toBeLessThanOrEqual(width);
    expect(measure.textLeft).toBeGreaterThanOrEqual(measure.left);
    expect(measure.textRight).toBeLessThanOrEqual(measure.right);
    expect(measure.content).toBeLessThanOrEqual(measure.viewport + 1);
    await affordable.click();
    await expect(page.getByRole('heading', { name: 'Affordable housing', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`affordable-${width}.png`), fullPage: true });
    await page.getByRole('tab', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  });
}

test('empty active inventory is not presented as no apartments matching the filters', async ({ page }) => {
  await mockApp(page, { listingCount: 0 });
  await expect(page.getByRole('heading', { name: 'Active inventory unavailable', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '0 matching apartments', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check source status', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sources & sync', exact: true })).toBeVisible();
});

test('an open result expires without a provider request and saved apartments remain available', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-17T11:59:00Z') });
  const { requests } = await mockApp(page, { inventoryExpiresAt: '2026-11-17T12:00:00Z' });
  await expect(page.getByText('12 Grove Street', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save apartment', exact: true }).first().click();
  const count = requests.length;
  await page.clock.fastForward(60_001);
  await expect(page.getByRole('heading', { name: 'These results need a fresh check', exact: true })).toBeVisible();
  await expect(page.getByText('12 Grove Street', { exact: true })).toHaveCount(0);
  expect(requests).toHaveLength(count);
  await page.getByRole('tab', { name: 'Saved (1)', exact: true }).click();
  await expect(page.getByText('12 Grove Street', { exact: true }).first()).toBeVisible();
  expect(userRefreshes(requests)).toHaveLength(0);
});

test('alerts: build one from an area, neighborhoods, bedroom counts and a rent, send a test, and remove it', async ({ page }) => {
  await mockApp(page);
  const posts: { action: string; rule?: { name: string; filters: Record<string, unknown>; criteria?: unknown } }[] = [];
  let state = {
    rules: [] as { id: string; name: string; createdAt: string }[],
    devices: [],
    recent: [],
    channels: { email: true, push: null },
  };
  await page.route('**/api/alerts', async (route) => {
    const body = route.request().postDataJSON();
    if (body) {
      posts.push(body);
      if (body.action === 'add-rule') state = { ...state, rules: [{ id: 'rule-1', name: body.rule.name, createdAt: now }] };
      if (body.action === 'delete-rule') state = { ...state, rules: [] };
      if (body.action === 'test') return route.fulfill({ json: { ...state, delivered: { email: true, devices: 0 } } });
    }
    return route.fulfill({ json: state });
  });
  await page.route('**/api/market?*', (route) =>
    route.fulfill({
      json: {
        month: '2026-11',
        history: [],
        areas: [
          { id: 'Manhattan|West Village', label: 'West Village', detail: 'Manhattan', count: 40, sizes: [] },
          { id: 'Manhattan|Chelsea', label: 'Chelsea', detail: 'Manhattan', count: 30, sizes: [] },
          { id: 'Brooklyn|Park Slope', label: 'Park Slope', detail: 'Brooklyn', count: 50, sizes: [] },
        ],
      },
    }),
  );
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Email alerts', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Alerts', exact: true })).toBeVisible();
  await expect(page.getByText('Email: to the address you sign in with.', { exact: true })).toBeVisible();
  await expect(page.getByText('Phone and browser notifications aren’t set up yet.', { exact: true })).toBeVisible();
  // West Village, two bedrooms, under $5,000.
  await page.getByRole('button', { name: 'Manhattan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Park Slope', exact: true }), 'only the borough’s neighborhoods').toHaveCount(0);
  await page.getByRole('button', { name: 'West Village', exact: true }).click();
  await page.getByRole('button', { name: '2 BR', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month', exact: true }).fill('5000');
  const name = page.getByRole('textbox', { name: 'Alert name', exact: true });
  await expect(name).toHaveAttribute('placeholder', 'West Village · 2 BR · under $5,000');
  await page.getByRole('button', { name: 'Save alert', exact: true }).click();
  await expect(page.getByText(/Alert saved: West Village · 2 BR · under \$5,000/)).toBeVisible();
  expect(posts[0]).toMatchObject({
    action: 'add-rule',
    rule: {
      name: 'West Village · 2 BR · under $5,000',
      filters: { region: 'manhattan', maxRent: 5000, bedrooms: null },
      criteria: { bedrooms: [2], neighborhoods: ['West Village'] },
    },
  });
  // All of Brooklyn, one to three bedrooms, under $2,500, with a name of its own.
  await page.getByRole('button', { name: 'Brooklyn', exact: true }).click();
  await page.getByRole('button', { name: '2 BR', exact: true }).click();
  for (const beds of ['1 BR', '2 BR', '3 BR']) await page.getByRole('button', { name: beds, exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month', exact: true }).fill('2500');
  await expect(name).toHaveAttribute('placeholder', 'Brooklyn · 1, 2, 3 BR · under $2,500');
  await name.fill('Everything');
  await page.getByRole('button', { name: 'Save alert', exact: true }).click();
  expect(posts[1]).toMatchObject({
    rule: { name: 'Everything', filters: { region: 'brooklyn', maxRent: 2500 }, criteria: { bedrooms: [1, 2, 3], neighborhoods: [] } },
  });
  await page.getByRole('button', { name: 'Send a test alert', exact: true }).click();
  await expect(page.getByText('Test alert sent.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Everything', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Everything', exact: true })).toHaveCount(0);
  expect(posts.map(({ action }) => action)).toEqual(['add-rule', 'add-rule', 'test', 'delete-rule']);
});

test('profile: an admin sees their role, the nightly resync switch and the sources page', async ({ page }) => {
  const { requests } = await mockApp(page, { account: 'owner@example.test', admin: true });
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expect(page.getByText('owner@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Admin account', { exact: true })).toBeVisible();
  await expect(page.getByText(/Last run .*: 12 sources updated, 1 failed; the slower sources continued/)).toBeVisible();
  const nightly = page.getByRole('switch', { name: 'Nightly resync' });
  await expect(nightly).toBeChecked();
  await nightly.click();
  await expect(nightly).not.toBeChecked();
  expect(requests.find(({ path, method }) => path === '/api/settings' && method === 'POST')?.body).toEqual({ nightlyResync: false });
  await expect(page.getByRole('button', { name: 'Sources & sync', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved listings (0)', exact: true })).toBeVisible();
});

test('profile: a member’s saved listings are kept on the account', async ({ page }) => {
  const { requests } = await mockApp(page, { account: 'renter@example.test', admin: false });
  await page.getByRole('button', { name: 'Save apartment', exact: true }).first().click();
  await expect.poll(() => requests.filter(({ path, method }) => path === '/api/saved' && method === 'POST').length).toBeGreaterThan(0);
  const stored = requests.filter(({ path, method }) => path === '/api/saved' && method === 'POST').at(-1)?.body as {
    listings: { address: string }[];
  };
  expect(stored.listings.map(({ address }) => address)).toEqual(['12 Grove Street']);
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  await expect(page.getByText('Member account', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved listings (1)', exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Nightly resync' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sources & sync', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Email alerts', exact: true })).toBeVisible();
});
