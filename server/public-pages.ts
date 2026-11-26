/**
 * Public pages search engines can read without signing in: one page per New York City neighborhood with its
 * rents by size, its buildings and its 311 complaints (server/neighborhoods.ts), an index of them, a sitemap and
 * robots.txt. Each page links to sign up. They show market figures only, never individual listings.
 */
import { Hono } from 'hono';
import { articleList, articleMonths, articleSlugs, composeArticle, monthName } from './articles.ts';
import type { AppEnv } from './contracts.ts';
import type { ArchiveLoader } from './dashboard-snapshot.ts';
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
  const { matches } = await search(parseFilters({ region: 'nyc', bedrooms: null, maxRent: null }), env, offline, true, { kept: true });
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

function page(origin: string, path: string, title: string, description: string, body: string, article?: { published: string }) {
  const canonical = origin + path;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="${article ? 'article' : 'website'}">${
    article
      ? `\n<script type="application/ld+json">${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description,
          datePublished: article.published,
          mainEntityOfPage: canonical,
          publisher: { '@type': 'Organization', name: 'Walkup' },
        }).replace(/</g, '\\u003c')}</script>`
      : ''
  }
<style>
:root{color-scheme:light dark;--ink:#222;--muted:#5f5b59;--page:#fff;--line:#ddd;--soft:#eee;--brand:#201e1c;--accent:#db164e}
@media (prefers-color-scheme:dark){:root{--ink:#f6f6f6;--muted:#b8b8b8;--page:#121212;--line:#353535;--soft:#262626;--brand:#f6f6f6;--accent:#f43f6b}}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--page);line-height:1.5}
header,main,footer{max-width:880px;margin:0 auto;padding:16px 20px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}
a{color:var(--ink)}.brand{display:flex;align-items:baseline;gap:1px;color:var(--brand);font-weight:800;font-size:23px;text-decoration:none;letter-spacing:-.9px}.brand img{height:12.5px;width:auto}
main{padding-top:8px;padding-bottom:32px}main>:last-child{margin-bottom:0}
h1{font-size:34px;line-height:1.15;letter-spacing:-.6px;margin:24px 0 8px}h2{font-size:22px;margin:32px 0 8px}p{margin:0 0 16px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{border:1px solid var(--line);border-radius:12px;padding:14px}.tile b{display:block;font-size:24px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;margin:8px 0 0}
ul.links{columns:2;padding-left:18px}ul.articles{list-style:none;padding:0;margin:0 0 16px}ul.articles li{padding:10px 0;border-bottom:1px solid var(--soft)}
table{border-collapse:collapse;width:100%;margin:8px 0 16px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--soft)}th{font-size:14px;color:var(--muted)}
td:not(:first-child),th:not(:first-child){text-align:right;white-space:nowrap}
footer{border-top:1px solid var(--line);font-size:14px;padding-top:20px;padding-bottom:28px}footer p{margin:0 0 8px}footer nav{display:flex;flex-wrap:wrap;gap:6px 18px}
</style></head><body>
<header><a class="brand" href="/" aria-label="Walkup, home"><img src="/icons/walkup.svg" alt="w">alkup</a><a href="/profile">Log in</a></header>
<main>${body}</main>
<footer class="muted"><p>Walkup searches New York City apartments across listing sites, brokerages and landlords. Figures are medians of asking rents; 311 complaints come from NYC Open Data.</p><nav><a href="/search">Search apartments</a><a href="/rents">All neighborhoods</a><a href="/blog">Market reports</a></nav></footer>
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

/**
 * Crawlers that collect pages to train AI models or to resell as data, which get nothing. Search engines are not
 * here: Google-Extended and Applebot-Extended opt out of AI training only, and do not affect Google or Apple search.
 */
const DATA_COLLECTORS = [
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'FacebookBot',
  'cohere-ai',
  'Diffbot',
  'Omgilibot',
  'ImagesiftBot',
  'DataForSeoBot',
];

/**
 * robots.txt: what crawlers are asked to do. Search engines may read the pages written for them (the home page
 * and the neighborhood rent pages, which carry market figures and no individual listings) and nothing else:
 * everything not named is closed, so the listings, behind /api/ and on apartments' own pages, are not for
 * collecting, and a page added later is closed until it is listed here. The file is a request
 * that reputable crawlers honor, not a lock: the rate limits and the Terms of Service do the enforcing.
 */
export const robotsFile = (origin: string) =>
  [
    '# Walkup',
    '#',
    '# Search engines are welcome to index the pages below.',
    '# The listings, rents and scores on this site may not be copied, scraped, collected in bulk,',
    '# republished, resold or used to train models. See the Terms of Service: ' + origin + '/terms',
    '',
    '# Search engines and everyone else: the public pages only, and the files those pages need to display.',
    'User-agent: *',
    'Allow: /$',
    'Allow: /rents',
    'Allow: /blog',
    'Allow: /about',
    'Allow: /pricing',
    'Allow: /terms',
    'Allow: /privacy',
    'Allow: /_expo/',
    'Allow: /icons/',
    'Allow: /boot.js',
    'Allow: /manifest.webmanifest',
    'Disallow: /',
    '',
    '# Crawlers that collect data for AI training or resale: nothing.',
    ...DATA_COLLECTORS.map((agent) => 'User-agent: ' + agent),
    'Disallow: /',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');

/** The public pages for this deployment's settings and data. */
export const publicPages = (env: AppEnv, fetcher: FetchTransport, loadArchive?: ArchiveLoader) =>
  new Hono()
    // Articles about the rental market, composed from the monthly figures (server/articles.ts).
    .get('/blog', async (c) => {
      const origin = new URL(c.req.url).origin;
      const database = env.BUCKET?.database;
      const months = database && loadArchive ? await articleMonths(database, loadArchive).catch(() => []) : [];
      const list = articleList(months);
      // A heading for each month, with that month's articles under it.
      const items = months
        .map(
          (month) =>
            `<h2>${escape(monthName(month))}</h2><ul class="articles">${list
              .filter((article) => article.month === month)
              .map(({ slug, title }) => `<li><a href="/blog/${slug}">${escape(title)}</a></li>`)
              .join('')}</ul>`,
        )
        .join('');
      const html = page(
        origin,
        '/blog',
        'New York City rental market reports | Walkup',
        'Monthly reports on New York City rents: the citywide median, the most affordable neighborhoods, and where rents are rising and falling.',
        `<h1>New York City rental market reports</h1><p class="muted">Written each month from that month's figures.</p>${
          items || '<p>The first reports are being prepared.</p>'
        }<a class="cta" href="/">Search apartments on Walkup</a>`,
      );
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600, no-transform' });
    })
    .get('/blog/:slug', async (c) => {
      const origin = new URL(c.req.url).origin;
      const database = env.BUCKET?.database;
      const article = database && loadArchive ? await composeArticle(database, loadArchive, c.req.param('slug')).catch(() => null) : null;
      if (!article)
        return c.html(
          page(
            origin,
            '/blog',
            'Report not found | Walkup',
            'Not found.',
            '<h1>Report not found</h1><p><a href="/blog">All market reports</a></p>',
          ),
          404,
        );
      const html = page(
        origin,
        '/blog/' + article.slug,
        article.title + ' | Walkup',
        article.description,
        `<p class="muted"><a href="/blog">Market reports</a></p><h1>${escape(article.title)}</h1>${article.html}<a class="cta" href="/">Search apartments on Walkup</a>`,
        { published: article.month + '-01' },
      );
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600, no-transform' });
    })
    .get('/robots.txt', (c) =>
      c.text(robotsFile(new URL(c.req.url).origin), 200, {
        'Cache-Control': 'public, max-age=86400',
      }),
    )
    .get('/sitemap.xml', async (c) => {
      const origin = new URL(c.req.url).origin;
      const pages = await neighborhoodIndex(env);
      const database = env.BUCKET?.database;
      const articles = database && loadArchive ? articleSlugs(await articleMonths(database, loadArchive).catch(() => [])) : [];
      const urls = [
        '/',
        '/about',
        '/pricing',
        '/rents',
        ...pages.map(({ path }) => '/rents/' + path),
        '/blog',
        ...articles.map((slug) => '/blog/' + slug),
      ]
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
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600, no-transform' });
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
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600, no-transform' });
    });
