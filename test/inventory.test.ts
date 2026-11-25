import { expect, test } from 'bun:test';
import { coldBucket, seededDatabase } from '../perf/fixtures.ts';
import { handleApi } from './fixtures/api.ts';
import './fixtures/quiet-logs.ts';
import { type InventoryHead, type InventoryStore, composeInventory, readInventory, refreshInventory } from '../server/inventory.ts';
import { runScheduled } from '../server/nightly.ts';
import { offline, search } from '../server/search.ts';
import { answerSearch, type Inventory } from '../src/answer.ts';
import type { ListingData, SearchResult } from '../src/domain.ts';
import { openingSearchBody } from '../src/early-requests.ts';
import { createInventorySearch } from '../src/inventory-client.ts';
import { decodeGroup, decodeInventory, encodeInventory } from '../src/inventory-format.ts';
import { localWorkplace, parseFilters } from '../src/search.ts';

/** Workers KV, as far as the inventory uses it. */
function memoryStore() {
  const values = new Map<string, string | ArrayBuffer>();
  const store = {
    get: async (key: string) => values.get(key) ?? null,
    put: async (key: string, value: string | ArrayBuffer) => void values.set(key, value),
  } as unknown as InventoryStore;
  return { store, values };
}
const gunzip = async (bytes: ArrayBuffer) => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const database = await seededDatabase(1500);
const env = () => ({ BUCKET: coldBucket(database) });
/** A listing as the file carries it: without what only an apartment's own page shows. */
const inFile = (listing: object) => {
  const { priceHistory: _history, county: _county, seenAt: _seen, ...kept } = listing as Record<string, unknown>;
  return kept;
};
const ALL = { region: 'all', bedrooms: null, maxRent: null, liveOnly: true, includeCached: true } as const;

test('the file format returns exactly the rows it was given, absent fields and repeated text included', async () => {
  const rows = [
    {
      id: 'a',
      city: 'Brooklyn',
      unit: '',
      bathrooms: null,
      sources: [{ id: 'zumper', url: 'https://example.test/a' }],
      insights: { warnings: [] },
    },
    { id: 'b', city: 'Brooklyn', unit: '2', rent: 3000, listedAt: '2026-11-01T00:00:00Z' },
    { id: 'c', city: 'Brooklyn', neighborhood: null },
    { id: 'd', city: 'Brooklyn' },
  ];
  const text = encodeInventory({ mode: 'live', notices: ['one'] }, rows);
  const { header, rows: decoded } = await decodeInventory(text);
  expect(decoded).toEqual(rows);
  expect('rent' in decoded[0]!, 'a field a row did not have stays absent').toBe(false);
  expect(header).toMatchObject({ mode: 'live', notices: ['one'], rows: 4, groups: 1 });
  // Repeated text is stored once.
  expect(text.match(/Brooklyn/g)).toHaveLength(1);
  // Many rows go in groups, decoded a piece at a time with a pause for the page between them.
  const many = Array.from({ length: 4500 }, (_, index) => ({ id: 'row-' + index, value: index }));
  let pauses = 0;
  const large = await decodeInventory(encodeInventory({}, many), async () => void pauses++);
  expect(large.rows).toEqual(many);
  expect(pauses).toBe(3);
  expect(decodeGroup(encodeInventory({}, many).split('\n')[1]!)).toHaveLength(2000);
  // A file from another version of the format, or cut short, is refused rather than half-read.
  await expect(decodeInventory(text.replace('"format":1', '"format":99'))).rejects.toThrow('not one this app reads');
  await expect(decodeInventory(text.replace('"rows":4,"groups"', '"rows":5,"groups"'))).rejects.toThrow('incomplete');
});

test('a search answered from the file is the search the server answers', async () => {
  const { text } = await composeInventory(await readInventory(env()), 'build-1');
  const { header, rows } = await decodeInventory<Omit<Inventory, 'listings'>, Record<string, unknown>>(text);
  const inventory: Inventory = { ...header, listings: rows as unknown as ListingData[] };
  const server = env();
  const searches = [
    {},
    { region: 'brooklyn' },
    { region: 'nyc', bedroomOptions: [1, 2], maxRent: 4200 },
    { belowMarket: true, sort: 'value' },
    { sort: 'newest', newWithinDays: 7 },
    { maxCommuteMinutes: 30, workplace: 'penn' },
    { subwayLines: ['Q', '6'] },
    { includeMap: true, region: 'nj' },
    { offset: 100 },
    { stabilizedOnly: true },
    { petsRequired: true, minSquareFeet: 700 },
  ];
  for (const extra of searches) {
    const filters = parseFilters({ ...ALL, ...extra });
    const expected = await search(filters, server, offline);
    const answered = answerSearch(inventory, filters, localWorkplace(filters)!);
    expect(answered.total, JSON.stringify(extra)).toBe(expected.total);
    expect(JSON.parse(JSON.stringify(answered)), JSON.stringify(extra)).toEqual(
      JSON.parse(JSON.stringify({ ...expected, matches: expected.matches.map(inFile) })),
    );
  }
  expect((await search(parseFilters(ALL), server, offline)).total).toBeGreaterThan(1000);
});

test('the inventory is built after a sync, stored once per version, and rebuilt by a new deploy', async () => {
  const { store, values } = memoryStore();
  const settings = { ...env(), INVENTORY: store };
  expect(await refreshInventory({ ...env() })).toBe('no-store');
  expect(await refreshInventory(settings, new Date('2026-11-25T12:00:00Z'))).toBe('built');
  const head = JSON.parse(values.get('head') as string) as InventoryHead;
  expect(head).toMatchObject({ format: 1, listings: head.opening.total, build: '' });
  expect(head.version).toMatch(/^[0-9a-f]{24}$/);
  expect(head.opening.matches.length).toBeGreaterThan(0);
  // The stored file is gzipped, and is the file the head describes.
  const text = await gunzip(values.get('file:' + head.version) as ArrayBuffer);
  expect(text.length).toBe(head.bytes);
  expect((await decodeInventory(text)).rows).toHaveLength(head.listings);
  expect(text, 'what only an apartment’s page shows is left out').not.toContain('priceHistory');
  // Nothing changed: nothing written. A new deploy keeps the file and stamps the head.
  expect(await refreshInventory(settings)).toBe('unchanged');
  expect(await refreshInventory({ ...settings, CF_VERSION_METADATA: { id: 'deploy-2' } })).toBe('built');
  expect(values.size).toBe(2);
  expect(JSON.parse(values.get('head') as string)).toMatchObject({ version: head.version, build: 'deploy-2' });
  // The hourly run keeps it current, and a failure to build does not fail the hour.
  const quiet = new Date('2026-11-25T08:10:00Z');
  const fresh = memoryStore();
  await runScheduled({ ...env(), INVENTORY: fresh.store }, { fetcher: offline, now: quiet });
  expect(fresh.values.has('head')).toBe(true);
  const broken = { get: async () => Promise.reject(new Error('KV is down')), put: async () => {} } as unknown as InventoryStore;
  expect(typeof (await runScheduled({ ...env(), INVENTORY: broken }, { fetcher: offline, now: quiet }))).toBe('string');
});

test('the API serves the head and each version’s file, and builds the file when there is none', async () => {
  const { store, values } = memoryStore();
  const settings = { ...env(), INVENTORY: store };
  const get = (path: string, environment: object = settings, services = {}) =>
    handleApi(new Request('https://walkup.test/api/' + path), environment, services);
  expect((await get('inventory', env())).status).toBe(404);
  // No file yet: the app is told so, and the file is built (here before the reply, in a Worker after it).
  const none = await get('inventory');
  expect(none.status).toBe(404);
  expect(values.has('head')).toBe(true);
  const reply = await get('inventory');
  expect(reply.status).toBe(200);
  expect(reply.headers.get('Cache-Control')).toBe('public, max-age=30');
  const head = (await reply.json()) as InventoryHead;
  const file = await get('inventory/' + head.version);
  expect(file.headers.get('Content-Encoding')).toBe('gzip');
  expect(file.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  expect((await decodeInventory(await gunzip(await file.arrayBuffer()))).rows).toHaveLength(head.listings);
  expect((await get('inventory/' + '0'.repeat(24))).status).toBe(404);
  expect((await get('inventory/not-a-version')).status).toBe(404);
  // A deploy since it was built: served as it is, and rebuilt after the response.
  const later: Promise<unknown>[] = [];
  const stale = await get(
    'inventory',
    { ...settings, CF_VERSION_METADATA: { id: 'deploy-3' } },
    { waitUntil: (work: Promise<unknown>) => later.push(work) },
  );
  expect(stale.status).toBe(200);
  await Promise.all(later);
  expect((JSON.parse(values.get('head') as string) as InventoryHead).build).toBe('deploy-3');
});

test('the app answers searches from the file, and from the server whenever the file cannot', async () => {
  const { text, head } = await composeInventory(await readInventory(env()), 'build-1');
  const asked: string[] = [];
  let headAnswer: object | null = head;
  let fileStatus = 200;
  const api = (async (path: string, options: { body?: object } = {}) => {
    asked.push(path);
    if (path === 'inventory') return headAnswer ?? Promise.reject(new Error('Not found.'));
    if (path === 'geocode') return { label: '350 Fifth Avenue', latitude: 40.7484, longitude: -73.9857 };
    return { total: -1, matches: [], from: 'server', body: options.body };
  }) as Parameters<typeof createInventorySearch>[0]['api'];
  let clock = 0;
  const client = (enabled = true) =>
    createInventorySearch({
      api,
      origin: '',
      enabled,
      now: () => clock,
      fetcher: async (url) => (asked.push(url), new Response(text, { status: fileStatus })),
    });
  const opening = JSON.parse(openingSearchBody()) as object;
  const web = { ...opening };
  const total = (result: SearchResult) => result.total;

  // Off (the phone app): the server.
  expect(total(await client(false).search(web))).toBe(-1);
  // The opening search is answered from the head at once, while the file downloads.
  const app = client();
  asked.length = 0;
  expect(await app.search(web)).toEqual(head.opening);
  expect(asked).toEqual(['inventory', '/api/inventory/' + head.version]);
  // Every other search waits for the file, then costs no request: a filter, a page, the map.
  const brooklyn = await app.search({ ...web, region: 'brooklyn' });
  expect(brooklyn.total).toBeGreaterThan(0);
  expect(brooklyn.total).toBeLessThan(head.opening.total);
  expect((await app.search({ ...web, offset: 100 })).offset).toBe(100);
  expect((await app.search({ ...web, includeMap: true })).mapPoints?.length).toBeGreaterThan(1000);
  expect(total(await app.search(web)), 'the opening search too, once the file is here').toBe(head.opening.total);
  expect(asked).toHaveLength(2);
  // A typed destination is looked up by the server, then searched here.
  expect((await app.search({ ...web, workplace: 'custom', customWorkplace: '350 Fifth Avenue, New York' })).workplace.label).toBe(
    '350 Fifth Avenue',
  );
  expect(asked.at(-1)).toBe('geocode');
  // Searches the file does not cover go to the server.
  for (const beyond of [{ officialOnly: true }, { liveOnly: false }, { includeCached: false }, { maxTransitMinutes: 30 }])
    expect(total(await app.search({ ...web, ...beyond }))).toBe(-1);
  // A long-open page asks for the head again after five minutes and takes a newer file when there is one.
  clock = 6 * 60_000;
  headAnswer = { ...head, version: 'f'.repeat(24) };
  await app.search({ ...web, region: 'queens' });
  await Bun.sleep(1);
  await app.search({ ...web, region: 'queens' });
  expect(asked).toContain('/api/inventory/' + 'f'.repeat(24));
  // No head, a head in another format, or a file that cannot be read: the server answers.
  headAnswer = null;
  expect(total(await client().search({ ...web, region: 'bronx' }))).toBe(-1);
  headAnswer = { ...head, format: 99 };
  expect(total(await client().search({ ...web, region: 'bronx' }))).toBe(-1);
  headAnswer = head;
  fileStatus = 503;
  expect(total(await client().search({ ...web, region: 'bronx' }))).toBe(-1);
  // Starting the download early is harmless either way.
  client().preload();
  client(false).preload();
  await Bun.sleep(1);
});
