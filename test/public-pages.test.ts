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
