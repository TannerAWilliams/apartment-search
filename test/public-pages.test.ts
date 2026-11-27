import { afterEach, expect, test } from 'bun:test';
import { fakeD1 } from './fixtures/fake-d1.ts';
import './fixtures/quiet-logs.ts';

const { default: worker } = await import('../server/cloudflare.ts');
const { neighborhoodIndex, slug } = await import('../server/public-pages.ts');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function environment() {
  const { d1 } = await fakeD1();
  return {
    APARTMENTS: d1,
    BETTER_AUTH_SECRET: 'test-only-better-auth-secret-0123456789abcdef',
    ACCESS_ALLOWED_EMAILS: 'owner@example.test',
    ASSETS: { fetch: async (request: Request) => new Response('asset ' + new URL(request.url).pathname) },
  };
}
const get = async (env: object, path: string) =>
  worker.fetch(new Request('https://walkup.test' + path), env as Parameters<typeof worker.fetch>[1]);

test('neighborhood pages, their index, the sitemap and robots.txt are public', async () => {
  // NYC Open Data's 311 counts for the page's ZIP code.
  globalThis.fetch = (async () => Response.json([{ complaint_type: 'Noise - Residential', count: '12' }])) as unknown as typeof fetch;
  const env = await environment();
  expect(slug(' Park Slope / South ')).toBe('park-slope-south');
  const pages = await neighborhoodIndex({});
  expect(pages.length).toBeGreaterThan(0);
  expect(pages.every(({ count }) => count >= 5)).toBe(true);
  const first = pages[0]!;

  // One of its buildings has been checked (before any page is asked for: pages show the scored listings the
  // server holds, which take up new building facts within fifteen minutes).
  const { offline, search } = await import('../server/search.ts');
  const { parseFilters } = await import('../src/search.ts');
  const { buildingKey } = await import('../src/listings.ts');
  const { createD1Bucket } = await import('../server/storage/d1-bucket.ts');
  const listing = (await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: null }), {}, offline, true)).matches.find(
    ({ neighborhood }) => neighborhood === first.name,
  )!;
  const facts = { stabilized: true, openViolations: 0, complaints: 0, bedbugs: false, flood: false, checkedAt: '2026-11-24T00:00:00Z' };
  await createD1Bucket(env.APARTMENTS).put('buildings/facts.json', JSON.stringify({ [buildingKey(listing)!]: facts }));

  const robots = await get(env, '/robots.txt');
  const rules = await robots.text();
  expect(rules).toContain('Sitemap: https://walkup.test/sitemap.xml');
  // Search engines may index the public pages; the listings are not for collecting, and AI and data crawlers get nothing.
  expect(rules).toContain('User-agent: *\nAllow: /$\nAllow: /rents\nAllow: /building/\nAllow: /blog\nAllow: /about\nAllow: /pricing\n');
  expect(rules).toContain('Allow: /manifest.webmanifest\nDisallow: /\n');
  expect(rules).toContain('User-agent: GPTBot\n');
  expect(rules).toMatch(/User-agent: DataForSeoBot\nDisallow: \/\n/);
  expect(rules).not.toContain('Googlebot');
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  expect(sitemap).toContain(`<loc>https://walkup.test/rents/${first.path}</loc>`);
  const index = await get(env, '/rents');
  expect(index.status).toBe(200);
  expect(await index.text()).toContain(`href="/rents/${first.path}"`);

  const response = await get(env, '/rents/' + first.path);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=3600, no-transform');
  const html = await response.text();
  // The page opens with the answer to the question people ask, dated, and says where it sits.
  expect(html).toContain(`<h1>Rent in ${first.name}, ${first.borough}</h1>`);
  expect(html).toMatch(/<p>(The median asking rent in|\d[\d,]* apartments are listed in) /);
  expect(html).toContain(`<h2>How much is rent in ${first.name}?</h2>`);
  expect(html).toContain('"@type":"BreadcrumbList"');
  expect(html).toContain(`href="/rent-check?neighborhood=${encodeURIComponent(first.name)}"`);
  expect(html).toContain('311 complaints in the last year');
  expect(html).toContain('register rent-stabilized units');
  expect(html).toContain('<link rel="canonical" href="https://walkup.test/rents/' + first.path + '">');

  expect((await get(env, '/rents/brooklyn/nowhere')).status).toBe(404);
  // The app is public too; what belongs to an account still needs one.
  expect((await get(env, '/api/config')).status).toBe(200);
  expect((await get(env, '/api/saved')).status).toBe(404);
});

test('a page whose neighborhood moved borough is not shown under the old one', async () => {
  globalThis.fetch = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  const env = await environment();
  const [first] = await neighborhoodIndex({});
  const { neighborhoodPage } = await import('../server/public-pages.ts');
  expect(await neighborhoodPage({}, 'https://walkup.test', 'Staten Island', first!.name, globalThis.fetch)).toBeNull();
  const html = await (await get(env, '/rents/' + first!.path)).text();
  expect(html).not.toContain('311 complaints in the last year');
});

test('the rent check compares a rent with its neighborhood, and the free tools are pages of their own', async () => {
  const env = await environment();
  const { rentPage } = await import('../server/tool-pages.ts');
  const { offline, search } = await import('../server/search.ts');
  const { parseFilters } = await import('../src/search.ts');
  const { summarizeNeighborhood } = await import('../server/neighborhoods.ts');
  const places = await neighborhoodIndex({});
  // A neighborhood with enough apartments of one size to compare with, and that size's median.
  let place = places[0]!;
  let bedrooms = 0;
  let median = 0;
  let thin: { name: string; bedrooms: number } | null = null;
  for (const candidate of places) {
    const filters = parseFilters({ region: 'nyc', bedrooms: null, maxRent: null, neighborhood: candidate.name });
    const sizes = summarizeNeighborhood((await search(filters, {}, offline, true, { kept: true })).matches).sizes;
    const full = sizes.find(({ count }) => count >= 3);
    const few = sizes.find(({ count }) => count < 3);
    if (few) thin ??= { name: candidate.name, bedrooms: few.bedrooms };
    if (full && !median) [place, bedrooms, median] = [candidate, full.bedrooms, full.median!];
  }
  expect(median).toBeGreaterThan(0);
  const origin = 'https://walkup.test';
  const ask = (rent: number | string, where = place.name, size = bedrooms) =>
    rentPage({}, origin, { neighborhood: where, bedrooms: String(size), rent: String(rent) });

  const landing = await rentPage({}, origin, {});
  expect(landing).toContain('<h1>Is my rent fair?</h1>');
  expect(landing).toContain(`<option value="${place.name.replace(/'/g, '&#39;')}">`);
  expect(landing).not.toContain('noindex');
  expect(await ask(Math.round(median * 1.3))).toMatch(/<p class="grade">\d+% above the neighborhood’s median<\/p>/);
  expect(await ask(Math.round(median * 1.3))).toContain('could save about');
  expect(await ask(Math.round(median * 0.7))).toMatch(/\d+% below the neighborhood’s median/);
  const close = await ask('$' + median.toLocaleString('en-US'));
  expect(close).toContain('In line with the neighborhood');
  expect(close).toContain(`href="/rents/${place.path}"`);
  expect(close).toContain('<meta name="robots" content="noindex">');
  if (thin) expect(await ask(3000, thin.name, thin.bedrooms)).toContain('Too few');
  // A rent with no neighborhood chosen, or no rent: the form again, and not for search engines once filled in.
  expect(await ask(3000, 'Nowhere At All')).toContain('<option value="">Choose one</option>');
  expect(await ask(3000, 'Nowhere At All')).toContain('noindex');
  expect(await ask('', place.name, 99)).not.toContain('<h2>Your rent</h2>');

  // Through the Worker: both pages, their caching, and where they are announced.
  const building = await get(env, '/check-building');
  expect(building.status).toBe(200);
  expect(building.headers.get('Cache-Control')).toBe('public, max-age=3600, no-transform');
  expect(await building.text()).toContain('Check any NYC building before you rent');
  globalThis.fetch = (async () => Response.json([])) as unknown as typeof fetch;
  const answer = await get(env, '/check-building?address=1+Main+St&zip=11201');
  expect(answer.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await answer.text()).toContain('No building found at that address');
  const rent = await get(env, `/rent-check?neighborhood=${encodeURIComponent(place.name)}&bedrooms=${bedrooms}&rent=${median}`);
  expect(rent.headers.get('Cache-Control')).toBe('private, no-store');
  expect((await get(env, '/rent-check')).headers.get('Cache-Control')).toBe('public, max-age=3600, no-transform');
  expect(await (await get(env, '/robots.txt')).text()).toContain('Allow: /check-building$\nAllow: /rent-check$\n');
  const sitemap = await (await get(env, '/sitemap.xml')).text();
  expect(sitemap).toContain('<loc>https://walkup.test/check-building</loc>');
  expect(sitemap).toContain('<loc>https://walkup.test/rent-check</loc>');

  // A burst of building checks from one visitor is refused; the page itself never is.
  const limited = { ...env, LOOKUP_LIMIT: { limit: async () => ({ success: false }) } };
  expect((await get(limited, '/check-building?address=1+Main+St&zip=11201')).status).toBe(429);
  expect((await get(limited, '/check-building')).status).toBe(200);
});

test('an address with nothing at it is answered "not found" on a page; a missing file stays a missing file', async () => {
  const env = await environment();
  const missing = { ...env, ASSETS: { fetch: async () => new Response('not found', { status: 404 }) } };
  const page = await worker.fetch(
    new Request('https://walkup.test/apartments-in-narnia', { headers: { Accept: 'text/html,application/xhtml+xml' } }),
    missing as Parameters<typeof worker.fetch>[1],
  );
  expect(page.status).toBe(404);
  const html = await page.text();
  expect(html).toContain('<h1>Page not found</h1>');
  expect(html).toContain('<meta name="robots" content="noindex">');
  expect(page.headers.get('Cache-Control')).toBe('no-store');
  // A file a page asked for, or anything but a visit: the plain answer.
  const file = await get(missing, '/icons/gone.png');
  expect(file.status).toBe(404);
  expect(await file.text()).toBe('not found');
  const post = await worker.fetch(
    new Request('https://walkup.test/apartments-in-narnia', { method: 'POST', headers: { Accept: 'text/html' } }),
    missing as Parameters<typeof worker.fetch>[1],
  );
  expect(await post.text()).toBe('not found');
});

test('graded buildings have pages of their own, read from the summary kept beside the inventory', async () => {
  const { summarizePublic } = await import('../server/public-summary.ts');
  const { buildingRecordPage, neighborhoodPage } = await import('../server/public-pages.ts');
  const facts = (extra: object = {}) => ({
    stabilized: true,
    openViolations: 0,
    complaints: 1,
    bedbugs: false,
    flood: false,
    rats: false,
    evictions: 0,
    courtCases: 0,
    vacate: false,
    checkedAt: '2026-11-26T12:00:00.000Z',
    ...extra,
  });
  const home = (id: string, address: string, extra: object = {}) =>
    ({
      id,
      address,
      unit: id,
      city: 'Manhattan',
      state: 'NY',
      zip: '10024',
      neighborhood: 'Upper West Side',
      rent: 4000,
      bedrooms: 1,
      region: 'nyc',
      sources: [{ id: 'zumper', name: 'Zumper', kind: 'feed', url: 'https://www.zumper.com/' + id }],
      building: facts(),
      ...extra,
    }) as never;
  const listings = [
    home('1', '100 W 86th St'),
    home('2', '100 W 86th St', { rent: 3500, sources: [{ id: 'trulia', name: 'Trulia', kind: 'feed', url: 'https://www.trulia.com/2' }] }),
    home('3', '100 W 86th St', { rent: 0 }),
    home('4', '200 W 90th St', {
      building: facts({ openViolations: 40, bedbugs: true, rats: true, vacate: true }),
      bedrooms: 0,
      rent: 3000,
    }),
    home('5', '300 W 91st St', { building: undefined, bedrooms: 2, rent: 6000 }),
    // No street number is no one building; an ungraded building and one outside the city have no page.
    home('6', 'W 92nd St'),
    home('7', '5 Elsewhere St', { building: { ...facts(), openViolations: null, complaints: null, bedbugs: null, flood: null } }),
    home('8', '9 Grove St', { city: 'Jersey City', state: 'NJ', neighborhood: 'Downtown' }),
    home('9', '10 Astor Pl', { neighborhood: 'Noho', building: undefined }),
    home('10', '77 W 85th St', { neighborhood: undefined, zip: '', building: facts() }),
  ];
  const summary = summarizePublic(listings, new Date('2026-11-27T15:00:00Z'));
  expect(summary.listings).toBe(9);
  expect(summary.sites).toBe(2);
  expect(summary.boroughs).toEqual([expect.objectContaining({ name: 'Manhattan', count: 9 })]);
  // Five listings make a neighborhood's page; one listing does not.
  expect(summary.neighborhoods.map(({ path, count, zip }) => [path, count, zip])).toEqual([['manhattan/upper-west-side', 7, '10024']]);
  expect(summary.buildings.map(({ slug, grade, listed, fromRent }) => [slug, grade, listed, fromRent])).toEqual([
    ['100-w-86th-st-10024', 'A', 3, 3500],
    ['200-w-90th-st-10024', 'D', 1, 3000],
  ]);

  const origin = 'https://walkup.test';
  const page = buildingRecordPage(summary, origin, '100-w-86th-st-10024')!;
  expect(page).toContain('<title>100 W 86th St, Manhattan: building grade A, violations and complaints | Walkup</title>');
  expect(page).toContain('<h1>100 W 86th St, Manhattan 10024</h1>');
  expect(page).toContain(
    'has a Walkup building grade of A, which means a clean record. City records show 0 open violations, 1 complaint in the last year',
  );
  expect(page).toContain('3 apartments are listed here now, from $3,500 a month.');
  expect(page).toContain('<a href="/rents/manhattan/upper-west-side">Upper West Side</a>');
  expect(page).toContain('<a href="/building/200-w-90th-st-10024">200 W 90th St</a> <span class="muted">(D)</span>');
  expect(page).toContain('"@type":"ApartmentComplex"');
  expect(page).toContain('href="/check-building?address=100%20W%2086th%20St&zip=10024"');
  const worst = buildingRecordPage(summary, origin, '200-w-90th-st-10024')!;
  expect(worst).toContain('1 apartment is listed here now, from $3,000 a month.');
  expect(worst).toContain('An order to vacate is in force');
  expect(buildingRecordPage(summary, origin, 'nowhere')).toBeNull();
  // A building with no neighborhood page or neighbors still has its own, and one with no rent says none.
  const alone = summarizePublic([home('1', '7 Lone St', { neighborhood: undefined, rent: 0 })]);
  const lone = buildingRecordPage(alone, origin, alone.buildings[0]!.slug)!;
  expect(lone).toContain('1 apartment is listed here now.');
  expect(lone).not.toContain('Other buildings in');

  // Two names for one place are one neighborhood, and a park is not a neighborhood.
  const named = summarizePublic(
    ['Flatiron', 'Flatiron District', 'Flatiron', 'Flatiron District', 'Flatiron', 'Central Park'].flatMap((neighborhood, index) =>
      Array.from({ length: 2 }, (_, copy) => home(`n${index}-${copy}`, `${index + 1}${copy} Named St`, { neighborhood })),
    ),
  );
  expect(named.neighborhoods.map(({ name, count }) => [name, count])).toEqual([['Flatiron', 10]]);

  // The neighborhood's page lists its graded buildings and sets its rents next to the borough's.
  globalThis.fetch = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
  const place = (await neighborhoodPage({}, origin, 'Manhattan', 'Upper West Side', globalThis.fetch, summary))!;
  expect(place).toContain('<title>Rent in Upper West Side, Manhattan: $4,000 for a one-bedroom (November 2026) | Walkup</title>');
  expect(place).toContain('The median asking rent in Upper West Side, Manhattan is $4,000 for a one-bedroom');
  expect(place).toContain('from 7 apartments listed on November 27, 2026.');
  expect(place).toContain('A one-bedroom here costs about the same as the Manhattan median of $4,000.');
  expect(place).toContain('<a href="/building/100-w-86th-st-10024">100 W 86th St</a> <span class="muted">(A)</span>');
  expect(place).toContain('By Walkup’s grade: 2 graded A, 1 graded D.');
  // Against a borough whose rents differ, it says by how much; with no one-bedrooms, the commonest size leads.
  const dearer = {
    ...summary,
    boroughs: [{ ...summary.boroughs[0]!, sizes: summary.boroughs[0]!.sizes.map((size) => ({ ...size, median: 5000 })) }],
  };
  expect(await neighborhoodPage({}, origin, 'Manhattan', 'Upper West Side', globalThis.fetch, dearer)).toContain(
    'costs 20% less than the Manhattan median of $5,000.',
  );
  const cheaper = {
    ...summary,
    boroughs: [{ ...summary.boroughs[0]!, sizes: summary.boroughs[0]!.sizes.map((size) => ({ ...size, median: 3200 })) }],
  };
  expect(await neighborhoodPage({}, origin, 'Manhattan', 'Upper West Side', globalThis.fetch, cheaper)).toContain(
    'costs 25% more than the Manhattan median of $3,200.',
  );
  // No figure for the borough, and no graded building to link to: the page says what it does know.
  const bare = (await neighborhoodPage({}, origin, 'Manhattan', 'Upper West Side', globalThis.fetch, {
    ...summary,
    boroughs: [],
    buildings: [],
  }))!;
  expect(bare).toContain('<h2>Buildings in Upper West Side</h2>');
  expect(bare).not.toContain('href="/building/');
  expect(bare).not.toContain('here costs');
  const studios = summarizePublic(
    Array.from({ length: 6 }, (_, index) => home(String(index), `${index + 1} W 70th St`, { bedrooms: 0, building: undefined })),
  );
  const small = (await neighborhoodPage({}, origin, 'Manhattan', 'Upper West Side', globalThis.fetch, studios))!;
  expect(small).toContain('is $4,000 for a studio, from 6 apartments');
  expect(small).not.toContain('Buildings in Upper West Side');
  const unpriced = {
    ...studios,
    neighborhoods: studios.neighborhoods.map((entry) => ({
      ...entry,
      zip: null,
      sizes: entry.sizes.map((size) => ({ ...size, median: null })),
    })),
  };
  expect(await neighborhoodPage({}, origin, 'Manhattan', 'Upper West Side', globalThis.fetch, unpriced)).toContain(
    '<p>6 apartments are listed in Upper West Side, Manhattan as of',
  );

  // Through the Worker, from the document kept beside the inventory: the building's page, the sitemap, and a miss.
  const env = { ...(await environment()), INVENTORY: { get: async () => JSON.stringify(summary), put: async () => {} } };
  const found = await get(env, '/building/100-w-86th-st-10024');
  expect(found.status).toBe(200);
  expect(found.headers.get('cache-control')).toBe('public, max-age=3600, no-transform');
  expect(await found.text()).toContain('<h1>100 W 86th St, Manhattan 10024</h1>');
  const missing = await get(env, '/building/1-nowhere-st-10001');
  expect(missing.status).toBe(404);
  expect(await missing.text()).toContain('<meta name="robots" content="noindex">');
  expect(await (await get(env, '/sitemap.xml')).text()).toContain('<loc>https://walkup.test/building/200-w-90th-st-10024</loc>');
  expect(await (await get(env, '/rents/manhattan/upper-west-side')).text()).toContain('Rent in Upper West Side, Manhattan');
});
