/**
 * Public pages search engines can read without signing in: one page per New York City neighborhood with its
 * rents by size, its buildings and its 311 complaints (server/neighborhoods.ts), an index of them, a sitemap and
 * robots.txt. Each page links to sign up. They show market figures only, never individual listings.
 */
import { Hono } from 'hono';
import type { AppEnv } from './contracts.ts';
import { neighborhoodReport } from './neighborhoods.ts';
import { offline, search } from './search.ts';
import { parseFilters } from '../src/search.ts';
import { formatRent } from '../src/search.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const SIZES = ['Studios', '1 bedrooms', '2 bedrooms', '3 bedrooms', '4+ bedrooms'];
/** A neighborhood needs this many listings for a page, so thin pages are not published. */
const MIN_LISTINGS = 5;

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** Every New York City neighborhood with enough listings for a page: name, borough and count, by borough then name. */
export async function neighborhoodIndex(env: AppEnv) {
  const { matches } = await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: null }), env, offline, true);
  const counts = new Map<string, { name: string; borough: string; count: number }>();
  for (const { neighborhood, city } of matches) {
    if (!neighborhood || !BOROUGHS.includes(city)) continue;
    const key = slug(city) + '/' + slug(neighborhood);
    const entry = counts.get(key) ?? { name: neighborhood, borough: city, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  return [...counts.entries()]
    .filter(([, { count }]) => count >= MIN_LISTINGS)
    .map(([path, entry]) => ({ path, ...entry }))
    .sort((a, b) => BOROUGHS.indexOf(a.borough) - BOROUGHS.indexOf(b.borough) || a.name.localeCompare(b.name));
}

function page(origin: string, path: string, title: string, description: string, body: string) {
  const canonical = origin + path;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="website">
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#222;background:#fff;line-height:1.5}
header,main,footer{max-width:880px;margin:0 auto;padding:16px 20px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #ddd}
a{color:#222}.brand{color:#d62a52;font-weight:800;font-size:22px;text-decoration:none;letter-spacing:-.5px}
h1{font-size:34px;line-height:1.15;letter-spacing:-.6px;margin:24px 0 8px}h2{font-size:22px;margin:32px 0 12px}
.muted{color:#6a6a6a}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{border:1px solid #ddd;border-radius:12px;padding:14px}.tile b{display:block;font-size:24px}
.cta{display:inline-block;background:#d62a52;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;margin:16px 0}
ul.links{columns:2;padding-left:18px}footer{border-top:1px solid #ddd;margin-top:40px;font-size:14px}
</style></head><body>
<header><a class="brand" href="/">walkup</a><a href="/">Sign in</a></header>
<main>${body}</main>
<footer class="muted">Walkup searches New York City apartments across listing sites, brokerages and landlords. Figures are medians of asking rents listed now; 311 complaints come from NYC Open Data. · <a href="/rents">All neighborhoods</a></footer>
</body></html>`;
}

/** One neighborhood's page, or null when it has too few listings. */
export async function neighborhoodPage(env: AppEnv, origin: string, borough: string, name: string, fetcher: FetchTransport) {
  const report = await neighborhoodReport(env, name, fetcher);
  if (report.listings < MIN_LISTINGS || report.borough !== borough) return null;
  const sizes = report.sizes.filter(({ count, median }) => count && median);
  const cheapest = sizes[0];
  const title = `${name}, ${borough} apartments for rent: median rents, buildings and 311 | Walkup`;
  const description = `${report.listings} apartments listed in ${name}, ${borough}${
    cheapest ? `, from a ${formatRent(cheapest.median!)} median for ${SIZES[cheapest.bedrooms]!.toLowerCase()}` : ''
  }. Rents by size, rent-stabilized buildings and the year's 311 complaints.`;
  const tiles = sizes
    .map(
      ({ bedrooms, count, median }) =>
        `<div class="tile"><span class="muted">${SIZES[bedrooms]}</span><b>${formatRent(median!)}</b><span class="muted">${count} listed</span></div>`,
    )
    .join('');
  // Only when some of its buildings have been checked.
  const buildings = [
    report.buildings.known &&
      `<p>${report.buildings.known} buildings with listings here have been checked against city and state records; ${report.buildings.stabilized} register rent-stabilized units.</p>`,
  ]
    .filter(Boolean)
    .join('');
  const complaints = report.complaints
    ? `<h2>311 complaints in the last year</h2><p class="muted">ZIP code ${escape(report.complaints.zip)}, from NYC Open Data.</p><div class="grid">${Object.entries(
        report.complaints.counts,
      )
        .map(
          ([group, count]) => `<div class="tile"><span class="muted">${escape(group)}</span><b>${count.toLocaleString('en-US')}</b></div>`,
        )
        .join('')}</div>`
    : '';
  const body = `<p class="muted">${escape(borough)} · New York City</p>
<h1>Apartments for rent in ${escape(name)}</h1>
<p>${report.listings.toLocaleString('en-US')} apartments are listed in ${escape(name)} right now. Median asking rents by size:</p>
<div class="grid">${tiles}</div>
<a class="cta" href="/">See the ${report.listings.toLocaleString('en-US')} apartments on Walkup</a>
${buildings}${complaints}
<h2>Why search on Walkup</h2>
<p>Every listing in one place, compared with similar apartments nearby, with building grades, rent-stabilized buildings, the nearest subway and alerts within hours.</p>`;
  return page(origin, `/rents/${slug(borough)}/${slug(name)}`, title, description, body);
}

/** The public pages for this deployment's settings and data. */
export const publicPages = (env: AppEnv, fetcher: FetchTransport) =>
  new Hono()
    .get('/robots.txt', (c) => {
      const origin = new URL(c.req.url).origin;
      return c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`, 200, {
        'Cache-Control': 'public, max-age=86400',
      });
    })
    .get('/sitemap.xml', async (c) => {
      const origin = new URL(c.req.url).origin;
      const pages = await neighborhoodIndex(env);
      const urls = ['/', '/rents', ...pages.map(({ path }) => '/rents/' + path)]
        .map((path) => `<url><loc>${escape(origin + path)}</loc></url>`)
        .join('');
      return c.body(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
        200,
        {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      );
    })
    .get('/rents', async (c) => {
      const origin = new URL(c.req.url).origin;
      const pages = await neighborhoodIndex(env);
      // The boroughs that have pages, in order.
      const sections = BOROUGHS.filter((borough) => pages.some((item) => item.borough === borough))
        .map(
          (borough) =>
            `<h2>${borough}</h2><ul class="links">${pages
              .filter((item) => item.borough === borough)
              .map(({ path, name, count }) => `<li><a href="/rents/${path}">${escape(name)}</a> <span class="muted">(${count})</span></li>`)
              .join('')}</ul>`,
        )
        .join('');
      const html = page(
        origin,
        '/rents',
        'New York City rents by neighborhood | Walkup',
        'Median asking rents by size, rent-stabilized buildings and 311 complaints for every New York City neighborhood with apartments listed now.',
        `<h1>New York City rents by neighborhood</h1><p>Median asking rents, buildings and 311 complaints for ${pages.length} neighborhoods with apartments listed now.</p>${sections}`,
      );
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600' });
    })
    .get('/rents/:borough/:name', async (c) => {
      const origin = new URL(c.req.url).origin;
      const wanted = `${c.req.param('borough')}/${c.req.param('name')}`;
      const entry = (await neighborhoodIndex(env)).find(({ path }) => path === wanted);
      const html = entry && (await neighborhoodPage(env, origin, entry.borough, entry.name, fetcher));
      if (!html)
        return c.html(
          page(
            origin,
            '/rents',
            'Neighborhood not found | Walkup',
            'Not found.',
            '<h1>Neighborhood not found</h1><p><a href="/rents">All neighborhoods</a></p>',
          ),
          404,
        );
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600' });
    });
