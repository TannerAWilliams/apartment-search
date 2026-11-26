/**
 * Speed budgets a browser can count exactly, so they never flake: how many requests a page makes, what it
 * downloads before it shows, and what a tap costs. Times vary from machine to machine; these counts do not.
 * A change that adds a request to the first load, or pulls a library into the first download, fails here.
 */
import { test, expect, type Page } from './fixtures.ts';
import { localSearch } from '../src/market.ts';
import { normalizeListing } from '../src/listings.ts';
import { parseFilters, localWorkplace } from '../src/search.ts';
import { answerSearch, type Inventory } from '../src/answer.ts';
import { openingSearchBody } from '../src/early-requests.ts';
import { encodeInventory, INVENTORY_FORMAT } from '../src/inventory-format.ts';

const listings = Array.from({ length: 30 }, (_, index) => {
  const listing = normalizeListing(
    {
      id: 'perf-' + index,
      addressLine1: `${10 + index} Grove Street`,
      city: 'Jersey City',
      state: 'NJ',
      zipCode: '07302',
      bedrooms: 1,
      price: 2000 + index * 10,
      latitude: 40.72 + index / 10_000,
      longitude: -74.04,
      status: 'Active',
      url: 'https://www.zillow.com/homedetails/perf-' + index + '/',
    },
    { id: 'zillow', name: 'Zillow', kind: 'feed' },
  );
  if (!listing) throw new Error('Invalid fixture');
  return listing;
});

const INVENTORY: Inventory = {
  listings,
  stations: [],
  mode: 'live',
  sources: [{ id: 'zillow', name: 'Zillow', status: 'searched' }],
  notices: [],
};
const { listings: _rows, ...INVENTORY_HEADER } = INVENTORY;
const FILE = encodeInventory(INVENTORY_HEADER, listings as unknown as Record<string, unknown>[]);
const OPENING = parseFilters(JSON.parse(openingSearchBody()));
const HEAD = { format: INVENTORY_FORMAT, version: 'a'.repeat(24), opening: answerSearch(INVENTORY, OPENING, localWorkplace(OPENING)!) };

/** The app with a stand-in server; records every API request and every script the page downloads. */
async function open(page: Page, path: string, { holdConfig, inventory = false }: { holdConfig?: Promise<void>; inventory?: boolean } = {}) {
  const api: { path: string; body: Record<string, unknown> | null }[] = [];
  const scripts: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') return route.abort();
    if (url.pathname.endsWith('.js')) scripts.push(url.pathname.split('/').at(-1)!);
    if (!url.pathname.startsWith('/api/')) return route.continue();
    api.push({ path: url.pathname, body: route.request().postDataJSON() });
    if (url.pathname === '/api/config') {
      await holdConfig;
      return route.fulfill({ json: { sources: [], commuteConfigured: false } });
    }
    if (url.pathname === '/api/search') {
      const filters = parseFilters(route.request().postDataJSON());
      return route.fulfill({
        json: localSearch(listings, filters, localWorkplace(filters), 'live', [{ id: 'zillow', status: 'searched' }]),
      });
    }
    if (url.pathname === '/api/market') return route.fulfill({ json: { month: '2026-10', areas: [], history: [] } });
    // The inventory file and its head, as the server publishes them (server/inventory.ts).
    if (inventory && url.pathname === '/api/inventory') return route.fulfill({ json: HEAD });
    if (inventory && url.pathname === '/api/inventory/' + HEAD.version) return route.fulfill({ body: FILE, contentType: 'text/plain' });
    return route.fulfill({ status: 404, json: { error: 'Not found.' } });
  });
  await page.goto(path);
  const count = (pathname: string) => api.filter((request) => request.path === pathname).length;
  return { api, scripts, count };
}
/** Until the page has been quiet for a moment, so late requests are counted too. */
const settled = (page: Page) => page.waitForLoadState('networkidle');

test('the home page shows from one script, and asks the server for settings and one search, once each', async ({ page }) => {
  const { scripts, count, api } = await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Find your next New York apartment', exact: true })).toBeVisible();
  // The page showed from two scripts: the small one that starts the requests early, and the app's own.
  expect(scripts.slice(0, 2).toSorted()).toEqual(['boot.js', expect.stringMatching(/^index-/)]);
  await settled(page);
  // The map's code (MapLibre and Leaflet, larger than the rest of the app) is not part of opening the home page.
  expect(scripts.filter((name) => name.startsWith('ListingMap-'))).toEqual([]);
  expect(count('/api/config')).toBe(1);
  expect(count('/api/search')).toBe(1);
  // The opening search does not ask for the map's points, which are most of a response.
  expect(api.find(({ path }) => path === '/api/search')?.body?.includeMap).toBe(false);
  // Everything the first visit asks of the server, with the Market tab made ready in the background.
  expect(api.length).toBeLessThanOrEqual(8);
});

test('a page that opens on cards starts the map’s code with the app’s own, not after the first card', async ({ page }) => {
  const { scripts } = await open(page, '/search');
  await expect(page.getByText(/matching apartment/).first()).toBeVisible();
  // Each card's picture is drawn by the map's code: asked for by the early script, alongside the app.
  expect(scripts.slice(0, 3).some((name) => name.startsWith('ListingMap-'))).toBe(true);
  expect(await page.locator('link[rel="preconnect"][href="https://tiles.openfreemap.org"]').count()).toBe(1);
});

test('search results need one search, which does not wait for the settings', async ({ page }) => {
  let release = () => {};
  const holdConfig = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { count } = await open(page, '/search', { holdConfig });
  // The search is on its way while the settings are still being read.
  await expect.poll(() => count('/api/search')).toBe(1);
  expect(count('/api/config')).toBe(1);
  release();
  await expect(page.getByRole('heading', { name: '30 matching apartments', exact: true })).toBeVisible();
  await settled(page);
  expect(count('/api/search')).toBe(1);
  expect(count('/api/config')).toBe(1);
});

test('a tap costs at most one request: sorting searches once, opening filters and Rents ask for nothing', async ({ page }) => {
  const { count, api } = await open(page, '/search');
  await expect(page.getByRole('heading', { name: '30 matching apartments', exact: true })).toBeVisible();
  await settled(page);
  const before = api.length;
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show apartments', exact: true })).toBeVisible();
  expect(api.length).toBe(before);
  await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
  await expect.poll(() => count('/api/search')).toBe(2);
  // Rents is read in the background a moment after the app is ready, so opening it asks the server for nothing.
  await expect.poll(() => count('/api/market')).toBeGreaterThan(0);
  await settled(page);
  const beforeRents = api.length;
  await page.getByRole('tab', { name: 'Market', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rent prices', exact: true })).toBeVisible();
  await settled(page);
  expect(api.length).toBe(beforeRents);
});

test('with the inventory file, results and every filter after them cost no search request at all', async ({ page }) => {
  const { count, api } = await open(page, '/search', { inventory: true });
  // The opening results come with the file's head.
  await expect(page.getByRole('heading', { name: '30 matching apartments', exact: true })).toBeVisible();
  await expect.poll(() => count('/api/inventory/' + HEAD.version)).toBe(1);
  await settled(page);
  expect(count('/api/inventory')).toBe(1);
  const before = api.length;
  // A filter, applied: answered in the page from the file.
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('textbox', { name: 'Max rent per month ($)', exact: true }).fill('2100');
  await page.getByRole('button', { name: 'Show apartments', exact: true }).click();
  await expect(page.getByRole('heading', { name: '11 matching apartments', exact: true })).toBeVisible();
  await settled(page);
  expect(count('/api/search')).toBe(0);
  expect(api.length).toBe(before);
});
