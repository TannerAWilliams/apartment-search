import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { articleList, articleMonths, articleSlugs, composeArticle } from '../server/articles.ts';
import { publicPages } from '../server/public-pages.ts';
import { createD1Bucket } from '../server/storage/d1-bucket.ts';
import { refreshMarketHistory } from '../server/storage/market-history.ts';
import { fakeD1 } from './fixtures/fake-d1.ts';
import './fixtures/quiet-logs.ts';

const archive = () => Bun.file(new URL('../public/data/streeteasy-dashboard-2026-11-17.zip', import.meta.url)).bytes();
const { d1 } = await fakeD1();
const offline = async () => new Response('offline', { status: 503 });

test('each month has three articles, for the latest month with figures and the eleven before it', async () => {
  const months = await articleMonths(d1, archive);
  expect(months).toHaveLength(12);
  expect(months[0]).toBe('2026-10');
  expect(months.at(-1)).toBe('2025-11');
  expect(articleSlugs(months)).toHaveLength(36);
  expect(articleList(months)[0]).toEqual({
    slug: 'nyc-rent-report-2026-10',
    month: '2026-10',
    title: 'New York City rent report: October 2026',
    label: 'Rent report',
  });
  // A database with no figures publishes nothing.
  expect(await articleMonths((await fakeD1()).d1, async () => Promise.reject(new Error('no archive'))).catch(() => [])).toEqual([]);
});

test('the rent report states the month’s figures, by borough and by size, with their source', async () => {
  const article = (await composeArticle(d1, archive, 'nyc-rent-report-2026-10'))!;
  // Every neighborhood is ranked by rent under the boroughs, with how many rentals its median is of.
  expect(article.html).toMatch(/<h2>All \d+ neighborhoods, by rent<\/h2>/);
  expect(article.html).toContain('Rentals listed');
  expect(article.title).toBe('New York City rent report: October 2026');
  expect(article.description).toBe('The median asking rent in New York City was $4,100 in October 2026, up 3.8% from a year earlier.');
  expect(article.html).toContain('27,084 rentals were listed, down 15.2% from a year earlier.');
  expect(article.html).toContain('<td>Manhattan</td><td>$4,995</td><td>+8.6%</td>');
  expect(article.html).toContain('<td>Staten Island</td><td>$2,800</td><td>−12.5%</td>');
  expect(article.html).toContain('<td>1 bedroom</td>');
  expect(article.html).toContain('StreetEasy Data Dashboard</a>, October 2026.');
  expect(article.html).toContain('Year-over-year changes compare with October 2025.');
});

test('the neighborhood articles rank only neighborhoods with enough rentals listed', async () => {
  const affordable = (await composeArticle(d1, archive, 'most-affordable-neighborhoods-2026-10'))!;
  expect(affordable.description).toStartWith('Briarwood, Queens had the lowest median asking rent of New York City');
  expect(affordable.html).toContain('<td>1</td><td>Briarwood, Queens</td><td>$2,193</td><td>−0.3%</td>');
  expect(affordable.html.match(/<tr>/g)).toHaveLength(16);
  const moving = (await composeArticle(d1, archive, 'where-rents-are-rising-and-falling-2026-10'))!;
  expect(moving.description).toContain('Median asking rents rose most in Little Italy, Manhattan, up 46.9% from a year earlier to $5,400');
  expect(moving.description).toContain('They fell most in Middle Village, Queens, down 20.0%');
  expect(moving.html).toContain('<h2>Largest decreases</h2>');
  expect(moving.html).toContain('<td>Little Italy, Manhattan</td><td>$5,400</td><td>$3,675</td><td>+46.9%</td>');
  // An earlier month has its own.
  expect((await composeArticle(d1, archive, 'nyc-rent-report-2026-03'))?.title).toBe('New York City rent report: March 2026');
});

test('an address that is not an article, or a month no longer kept, is not found', async () => {
  for (const slug of ['nyc-rent-report-2019-01', 'nyc-rent-report-2031-01', 'something-else-2026-10', 'nyc-rent-report', ''])
    expect(await composeArticle(d1, archive, slug)).toBeNull();
});

test('the articles are public pages, listed in the index and the sitemap', async () => {
  const pages = publicPages({ BUCKET: createD1Bucket(d1) }, offline, archive);
  const get = (path: string) => pages.request('https://walkup.test' + path);
  const index = await get('/blog');
  expect(index.status).toBe(200);
  const listing = await index.text();
  expect(listing).toContain('<a href="/blog/nyc-rent-report-2026-10">Rent report</a>');
  expect(listing.match(/<li>/g)).toHaveLength(36);
  expect(listing).toContain('<h2>October 2026</h2><ul class="articles"><li><a href="/blog/nyc-rent-report-2026-10">');
  expect(listing.match(/<h2>/g)).toHaveLength(12);
  const article = await get('/blog/nyc-rent-report-2026-10');
  expect(article.status).toBe(200);
  expect(article.headers.get('Cache-Control')).toBe('public, max-age=3600, no-transform');
  const html = await article.text();
  expect(html).toContain('<title>New York City rent report: October 2026 | Walkup</title>');
  expect(html).toContain('<link rel="canonical" href="https://walkup.test/blog/nyc-rent-report-2026-10">');
  expect(html).toContain('<meta property="og:type" content="article">');
  expect(html).toContain('"@type":"Article"');
  expect(html).toContain('"datePublished":"2026-10-01"');
  expect((await get('/blog/nyc-rent-report-2019-01')).status).toBe(404);
  expect(await (await get('/sitemap.xml')).text()).toContain(
    '<loc>https://walkup.test/blog/where-rents-are-rising-and-falling-2026-10</loc>',
  );
  expect(await (await get('/robots.txt')).text()).toContain('Allow: /blog\n');
  // Without the figures (no database, or no archive to load them from) the index says so and nothing is listed.
  const empty = publicPages({}, offline);
  expect(await (await empty.request('https://walkup.test/blog')).text()).toContain('The first reports are being prepared.');
  expect((await empty.request('https://walkup.test/blog/nyc-rent-report-2026-10')).status).toBe(404);
});

/** A series' zip with the latest month rewritten, row by row, from that row's value a year earlier. */
function rewritten(name: string, zip: Uint8Array, latest: (area: string, yearAgo: string) => string) {
  const [header, ...rows] = strFromU8(unzipSync(zip)[name]!).trimEnd().split('\n');
  const changed = rows.map((row) => {
    const cells = row.split(',');
    cells[cells.length - 1] = latest(cells[0]!, cells.at(-13)!);
    return cells.join(',');
  });
  return zipSync({ [name]: strToU8([header, ...changed].join('\n') + '\n') });
}

test('a month with nothing falling, an unchanged city median and no count of rentals says only what it can', async () => {
  const { d1: database } = await fakeD1();
  const files = unzipSync(await archive());
  // Every neighborhood's rent a tenth above a year earlier, the city's the same as then, and no citywide count.
  await refreshMarketHistory(database, async (url) => {
    const name = String(url).split('/').at(-1)!.replace('.zip', '.csv');
    const zip = files[name.replace('.csv', '.zip')]!;
    if (name === 'medianAskingRent_All.csv')
      return new Response(rewritten(name, zip, (area, yearAgo) => (yearAgo && area !== 'NYC' ? String(Number(yearAgo) * 1.1) : yearAgo)));
    if (name === 'rentalInventory_All.csv')
      return new Response(rewritten(name, zip, (area, yearAgo) => (area === 'NYC' ? '' : yearAgo || '30')));
    return new Response(new Uint8Array(zip));
  });
  const report = (await composeArticle(database, archive, 'nyc-rent-report-2026-10'))!;
  expect(report.description).toBe('The median asking rent in New York City was $3,950 in October 2026, unchanged from a year earlier.');
  expect(report.html).not.toContain('rentals were listed');
  const moving = (await composeArticle(database, archive, 'where-rents-are-rising-and-falling-2026-10'))!;
  expect(moving.description).not.toContain('They fell most');
  expect(moving.html).toContain('<h2>Largest increases</h2>');
  expect(moving.html).not.toContain('Largest decreases');
  expect(moving.html).toContain('+10.0%');
}, 60_000);
