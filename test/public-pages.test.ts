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
  expect(rules).toContain('User-agent: *\nAllow: /$\nAllow: /rents\nAllow: /blog\nAllow: /about\nAllow: /pricing\n');
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
  expect(html).toContain(`<h1>Apartments for rent in ${first.name}</h1>`);
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
