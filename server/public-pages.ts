/**
 * Public pages search engines can read without signing in: one page per New York City neighborhood with its
 * rents by size, its buildings and its 311 complaints (server/neighborhoods.ts), an index of them, a sitemap and
 * robots.txt. Each page links to sign up. They show market figures only, never individual listings.
 */
import { Hono } from 'hono';
import { articleList, articleMonths, articleSlugs, composeArticle, monthName } from './articles.ts';
import type { AppEnv } from './contracts.ts';
import type { ArchiveLoader } from './dashboard-snapshot.ts';
import { log } from './log.ts';
import { zipComplaints } from './neighborhoods.ts';
import { BOROUGHS, type BuildingSummary, type PublicSummary, publicSummary, slug } from './public-summary.ts';
import { formatRent } from '../src/search.ts';
import type { FetchTransport } from '../src/fetch-type.ts';

export { slug };
const SHORT_SIZE = ['Studio', '1 bed', '2 bed', '3 bed', '4+ bed'];
const SIZE = ['studio', 'one-bedroom', 'two-bedroom', 'three-bedroom', 'four-bedroom'];
export const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
const MONTH = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', year: 'numeric' });

/** Every New York City neighborhood with enough listings for a page: name, borough and count, by borough then name. */
export const neighborhoodIndex = async (env: AppEnv) =>
  (await publicSummary(env)).neighborhoods.map(({ path, name, borough, count }) => ({ path, name, borough, count }));

/** Where a page sits, as links above its heading and as data a search engine reads. */
function trail(origin: string, steps: [name: string, path: string][]) {
  return {
    html: `<p class="muted">${steps.map(([name, path]) => `<a href="${path}">${escape(name)}</a>`).join(' › ')}</p>`,
    data: {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: steps.map(([name, path], index) => ({ '@type': 'ListItem', position: index + 1, name, item: origin + path })),
    },
  };
}

export function page(
  origin: string,
  path: string,
  title: string,
  description: string,
  body: string,
  {
    published,
    noindex = false,
    data = [],
  }: {
    /** An article, with the day it was published. */
    published?: string;
    /** An answer to one person's question, or a page that is not there: not for search engines to keep. */
    noindex?: boolean;
    /** What the page is about, as schema.org data. */
    data?: object[];
  } = {},
) {
  const article = published
    ? [
        {
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: title,
          description,
          datePublished: published,
          mainEntityOfPage: origin + path,
          publisher: { '@type': 'Organization', name: 'Walkup' },
        },
      ]
    : [];
  const canonical = origin + path;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}">${noindex ? '\n<meta name="robots" content="noindex">' : ''}
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(canonical)}"><meta property="og:type" content="${published ? 'article' : 'website'}">
<meta property="og:site_name" content="Walkup"><meta property="og:image" content="${escape(origin)}/icons/share.png"><meta name="twitter:card" content="summary_large_image">${[
    ...article,
    ...data,
  ]
    .map((entry) => `\n<script type="application/ld+json">${JSON.stringify(entry).replace(/</g, '\\u003c')}</script>`)
    .join('')}
<style>
:root{color-scheme:light dark;--ink:#201e1c;--muted:#5f5b59;--page:#fff;--line:#d7d5d3;--soft:#f7f6f6;--brand:#201e1c;--accent:#db164e}
@media (prefers-color-scheme:dark){:root{--ink:#f6f6f6;--muted:#b8b8b8;--page:#121212;--line:#353535;--soft:#262626;--brand:#f6f6f6;--accent:#f43f6b}}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--page);line-height:1.5}
header,main,footer{max-width:880px;margin:0 auto;padding:16px 20px}
header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line)}
a{color:var(--ink)}.brand{display:flex;align-items:baseline;gap:7px;color:var(--brand);font-weight:800;font-size:23px;text-decoration:none;letter-spacing:-.9px}.brand img{height:23px;width:auto}
main{padding-top:8px;padding-bottom:32px}main>:last-child{margin-bottom:0}
h1{font-size:34px;line-height:1.15;letter-spacing:-.6px;margin:24px 0 8px}h2{font-size:22px;margin:32px 0 8px}p{margin:0 0 16px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{border:1px solid var(--line);border-radius:12px;padding:14px}.tile b{display:block;font-size:24px}
.form{display:grid;gap:12px;max-width:460px;margin:16px 0 8px}.form label{display:grid;gap:4px;font-weight:600;font-size:15px}
.form input,.form select{font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--page);color:var(--ink)}
.form button{font:inherit;font-weight:600;padding:12px 20px;border:0;border-radius:10px;background:var(--ink);color:var(--page);cursor:pointer;justify-self:start}
.grade{display:inline-block;font-size:44px;font-weight:800;line-height:1;border:2px solid var(--accent);border-radius:14px;padding:10px 18px;margin:8px 0}
.cta{display:inline-block;background:var(--ink);color:var(--page);text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;margin:8px 0 0}
ul.links{columns:2;padding-left:18px}ul.articles{list-style:none;padding:0;margin:0 0 16px}ul.articles li{padding:10px 0;border-bottom:1px solid var(--soft)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:8px 0 16px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--soft)}th{font-size:14px;color:var(--muted)}
td:not(:first-child),th:not(:first-child){text-align:right;white-space:nowrap}
footer{border-top:1px solid var(--line);font-size:14px;padding-top:20px;padding-bottom:28px}footer p{margin:0 0 8px}footer nav{display:flex;flex-wrap:wrap;gap:6px 18px}
</style></head><body>
<header><a class="brand" href="/"><img src="/icons/walkup.svg" alt="">walkup</a><a href="/profile">Log in</a></header>
<main>${body}</main>
<footer class="muted"><p>Walkup searches New York City apartments across listing sites, brokerages and landlords. Figures are medians of asking rents; 311 complaints come from NYC Open Data.</p><nav><a href="/search">Search apartments</a><a href="/rents">All neighborhoods</a><a href="/check-building">Check a building</a><a href="/rent-check">Is my rent fair?</a><a href="/blog">Market reports</a></nav></footer>
</body></html>`;
}

const GRADE_MEANS: Record<string, string> = {
  A: 'a clean record',
  B: 'a few marks on its record',
  C: 'several problems on its record',
  D: 'many problems on its record',
};
const count = (value: number | null | undefined, one: string, many: string) =>
  value == null ? null : `${value.toLocaleString('en-US')} ${value === 1 ? one : many}`;
const yes = (value: boolean | null | undefined, when: string, otherwise: string | null) =>
  value == null ? null : value ? when : otherwise;
/** What the city's records say about a building, one short line each; what was not checked is left out. */
export const recordLines = (facts: BuildingSummary['facts']) =>
  [
    count(facts.openViolations, 'open violation', 'open violations'),
    count(facts.complaints, 'complaint in the last year', 'complaints in the last year'),
    yes(facts.bedbugs, 'Bedbugs reported', 'No bedbugs reported'),
    yes(facts.rats, 'Rats found by inspectors', 'No rats found by inspectors'),
    count(facts.evictions, 'eviction in two years', 'evictions in two years'),
    count(facts.courtCases, 'Housing Court case in two years', 'Housing Court cases in two years'),
    yes(facts.stabilized, 'Registers rent-stabilized apartments', 'No rent-stabilized apartments registered'),
    yes(facts.vacate, 'An order to vacate is in force', null),
  ].filter((line): line is string => Boolean(line));

/**
 * One neighborhood's page, or null when it has too few listings. It opens with the answer to the question people
 * ask ("what is the rent in Astoria?"), with its date and what it is based on, then the same by size, against the
 * borough, its buildings and the year's 311 complaints.
 */
export async function neighborhoodPage(
  env: AppEnv,
  origin: string,
  borough: string,
  name: string,
  fetcher: FetchTransport,
  summary?: PublicSummary,
) {
  const all = summary ?? (await publicSummary(env));
  const place = all.neighborhoods.find((entry) => entry.name === name && entry.borough === borough);
  if (!place) return null;
  const built = new Date(all.builtAt);
  const sizes = place.sizes.filter(({ count: listed, median }) => listed && median);
  const whole = all.boroughs.find((entry) => entry.name === borough);
  // One-bedrooms are what most people ask about; where there are none, the size with the most listings.
  const lead = sizes.find(({ bedrooms }) => bedrooms === 1) ?? [...sizes].sort((a, b) => b.count - a.count)[0];
  const others = sizes.filter((size) => size !== lead).slice(0, 2);
  const against = lead && whole?.sizes[lead.bedrooms]?.median;
  const gap = lead && against ? Math.round(((lead.median! - against) / against) * 100) : 0;
  const answer = lead
    ? `The median asking rent in ${name}, ${borough} is ${formatRent(lead.median!)} for a ${SIZE[lead.bedrooms]}${others
        .map(({ bedrooms, median }) => `, ${formatRent(median!)} for a ${SIZE[bedrooms]}`)
        .join('')}, from ${place.count.toLocaleString('en-US')} apartments listed on ${DAY.format(built)}.${
        against
          ? ` A ${SIZE[lead.bedrooms]} here costs ${
              Math.abs(gap) < 3 ? 'about the same as' : `${Math.abs(gap)}% ${gap > 0 ? 'more' : 'less'} than`
            } the ${borough} median of ${formatRent(against)}.`
          : ''
      }`
    : `${place.count.toLocaleString('en-US')} apartments are listed in ${name}, ${borough} as of ${DAY.format(built)}.`;
  const title = lead
    ? `Rent in ${name}, ${borough}: ${formatRent(lead.median!)} for a ${SIZE[lead.bedrooms]} (${MONTH.format(built)}) | Walkup`
    : `Rent in ${name}, ${borough} (${MONTH.format(built)}) | Walkup`;
  const table = sizes.length
    ? `<div class="scroll"><table><tr><th>Size</th><th>${escape(name)}</th><th>${escape(borough)}</th><th>Listed</th></tr>${sizes
        .map(
          ({ bedrooms, count: listed, median }) =>
            `<tr><td>${SHORT_SIZE[bedrooms]}</td><td>${formatRent(median!)}</td><td>${
              whole?.sizes[bedrooms]?.median ? formatRent(whole.sizes[bedrooms]!.median!) : '–'
            }</td><td>${listed}</td></tr>`,
        )
        .join('')}</table></div>`
    : '';
  const graded = all.buildings.filter((building) => building.neighborhood === name && building.borough === borough);
  const grades = Object.entries(place.buildings.grades).filter(([, total]) => total > 0);
  const buildings = place.buildings.known
    ? `<h2>Buildings in ${escape(name)}</h2><p>${place.buildings.known} buildings with apartments listed here have been checked against city and state records; ${
        place.buildings.stabilized
      } register rent-stabilized units.${
        grades.length ? ` By Walkup’s grade: ${grades.map(([grade, total]) => `${total} graded ${grade}`).join(', ')}.` : ''
      }</p>${
        graded.length
          ? `<ul class="links">${graded
              .slice(0, 24)
              .map(
                ({ slug: id, address, grade }) =>
                  `<li><a href="/building/${id}">${escape(address)}</a> <span class="muted">(${grade})</span></li>`,
              )
              .join('')}</ul>`
          : ''
      }`
    : '';
  let complaints = '';
  if (place.zip) {
    try {
      const year = await zipComplaints(env.BUCKET, place.zip, fetcher);
      complaints = `<h2>311 complaints in the last year</h2><p class="muted">ZIP code ${escape(year.zip)}, from <a href="https://data.cityofnewyork.us/d/erm2-nwe9">NYC Open Data</a>.</p><div class="grid">${Object.entries(
        year.counts,
      )
        .map(
          ([group, total]) => `<div class="tile"><span class="muted">${escape(group)}</span><b>${total.toLocaleString('en-US')}</b></div>`,
        )
        .join('')}</div>`;
    } catch (cause) {
      log.warn('neighborhood_311_failed', { zip: place.zip, message: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  const nearby = all.neighborhoods
    .filter((entry) => entry.borough === borough && entry.name !== name)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const path = `/rents/${place.path}`;
  const crumbs = trail(origin, [
    ['NYC rents', '/rents'],
    [name, path],
  ]);
  const body = `${crumbs.html}
<h1>Rent in ${escape(name)}, ${escape(borough)}</h1>
<p>${escape(answer)}</p>
<h2>How much is rent in ${escape(name)}?</h2>
<p class="muted">Median asking rents by size, next to all of ${escape(borough)}. Updated ${DAY.format(built)}.</p>
${table}
<a class="cta" href="/search">See the ${place.count.toLocaleString('en-US')} apartments on Walkup</a>
<p><a href="/rent-check?neighborhood=${encodeURIComponent(name)}">Is your rent in ${escape(name)} fair?</a> Compare it with these.</p>
${buildings}${complaints}${
  nearby.length
    ? `<h2>More ${escape(borough)} neighborhoods</h2><ul class="links">${nearby
        .map((entry) => `<li><a href="/rents/${entry.path}">${escape(entry.name)}</a></li>`)
        .join('')}</ul>`
    : ''
}
<h2>Where these figures come from</h2>
<p>Walkup reads apartments from listing sites, brokerages and landlords several times a day and counts each apartment once. The median is the middle asking rent: half the apartments ask more, half less. Building records are New York City’s and New York State’s own.</p>`;
  return page(origin, path, title, answer, body, { data: [crumbs.data] });
}

/**
 * One building's page: its grade and what the city's records say, the apartments listed there now, and other
 * buildings nearby. Null when Walkup has no grade for a building at this address.
 */
export function buildingRecordPage(all: PublicSummary, origin: string, id: string) {
  const building = all.buildings.find((entry) => entry.slug === id);
  if (!building) return null;
  const { address, borough, neighborhood, zip, grade, facts } = building;
  const where = [neighborhood, borough].filter(Boolean).join(', ');
  const checked = DAY.format(new Date(facts.checkedAt));
  const lines = recordLines(facts);
  const answer = `${address} in ${where} has a Walkup building grade of ${grade}, which means ${GRADE_MEANS[grade]}. City records show ${lines
    .slice(0, 4)
    .map((line) => line[0]!.toLowerCase() + line.slice(1))
    .join(', ')}, as of ${checked}.`;
  const place = all.neighborhoods.find((entry) => entry.name === neighborhood && entry.borough === borough);
  const near = all.buildings
    .filter((entry) => entry.neighborhood === neighborhood && entry.borough === borough && entry.slug !== id)
    .slice(0, 12);
  const path = `/building/${id}`;
  const crumbs = trail(origin, [
    ['NYC rents', '/rents'],
    ...(place ? [[place.name, `/rents/${place.path}`] as [string, string]] : []),
    [address, path],
  ]);
  const body = `${crumbs.html}
<h1>${escape(address)}, ${escape(borough)} ${escape(zip)}</h1>
<p>${escape(answer)}</p>
<p class="grade">${grade}</p>
<div class="grid">${lines.map((line) => `<div class="tile">${escape(line)}</div>`).join('')}</div>
<p class="muted">From New York City and New York State records, checked ${checked}. A record can lag what has happened in the building.</p>
<h2>Apartments at ${escape(address)}</h2>
<p>${building.listed} ${building.listed === 1 ? 'apartment is' : 'apartments are'} listed here now${
    building.fromRent ? `, from ${formatRent(building.fromRent)} a month` : ''
  }.</p>
<a class="cta" href="/search">See them on Walkup</a>
<h2>What the grade means</h2>
<p>A is a clean record; D is a building with many open violations, pests or an order to vacate. The grade is Walkup’s own, worked out from open housing code violations, complaints in the last year, bedbug filings, rat inspections, evictions and Housing Court cases. <a href="/check-building?address=${encodeURIComponent(
    address,
  )}&zip=${encodeURIComponent(zip)}">Check this building again now</a>, or <a href="/check-building">check another</a>.</p>${
    near.length
      ? `<h2>Other buildings in ${escape(neighborhood || borough)}</h2><ul class="links">${near
          .map(
            (entry) =>
              `<li><a href="/building/${entry.slug}">${escape(entry.address)}</a> <span class="muted">(${entry.grade})</span></li>`,
          )
          .join('')}</ul>`
      : ''
  }
<h2>Where the records come from</h2>
<p><a href="https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5/about_data">Housing code violations</a> and <a href="https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Complaint-Problems/ygpa-z7cr">complaints</a> from the city’s housing department, and the city’s bedbug, rat inspection, eviction and Housing Court records, on NYC Open Data.</p>`;
  const title = `${address}, ${borough}: building grade ${grade}, violations and complaints | Walkup`;
  return page(origin, path, title, answer, body, {
    data: [
      crumbs.data,
      {
        '@context': 'https://schema.org',
        '@type': 'ApartmentComplex',
        name: address,
        url: origin + path,
        address: { '@type': 'PostalAddress', streetAddress: address, addressLocality: borough, addressRegion: 'NY', postalCode: zip },
      },
    ],
  });
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
    'Allow: /building/',
    'Allow: /blog',
    'Allow: /about',
    'Allow: /pricing',
    'Allow: /llms.txt',
    'Allow: /check-building$',
    'Allow: /rent-check$',
    'Allow: /terms',
    'Allow: /privacy',
    'Allow: /_expo/',
    'Allow: /icons/',
    'Allow: /boot.js',
    'Allow: /manifest.webmanifest',
    'Disallow: /',
    '',
    '# AI assistants answering a person’s question (ChatGPT search, Claude, Perplexity) are welcome on the same',
    '# public pages, under the rule above, and may quote the rent figures and reports with a link.',
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
            { noindex: true },
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
      const summary = await publicSummary(env);
      const pages = summary.neighborhoods;
      const database = env.BUCKET?.database;
      const articles = database && loadArchive ? articleSlugs(await articleMonths(database, loadArchive).catch(() => [])) : [];
      const urls = [
        '/',
        '/about',
        '/pricing',
        '/rents',
        '/check-building',
        '/rent-check',
        ...pages.map(({ path }) => '/rents/' + path),
        ...summary.buildings.map((building) => '/building/' + building.slug),
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
      const summary = await publicSummary(env);
      const entry = summary.neighborhoods.find(({ path }) => path === wanted);
      const html = entry && (await neighborhoodPage(env, origin, entry.borough, entry.name, fetcher, summary));
      if (!html)
        return c.html(
          page(
            origin,
            '/rents',
            'Neighborhood not found | Walkup',
            'Not found.',
            '<h1>Neighborhood not found</h1><p><a href="/rents">All neighborhoods</a></p>',
            { noindex: true },
          ),
          404,
        );
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600, no-transform' });
    })
    .get('/building/:id', async (c) => {
      const origin = new URL(c.req.url).origin;
      const html = buildingRecordPage(await publicSummary(env), origin, c.req.param('id'));
      if (!html)
        return c.html(
          page(
            origin,
            '/check-building',
            'Building not found | Walkup',
            'Not found.',
            '<h1>Building not found</h1><p>Walkup has no grade for a building at this address, or no apartment is listed there now. <a href="/check-building">Check any building by its address</a>.</p>',
            { noindex: true },
          ),
          404,
        );
      return c.html(html, 200, { 'Cache-Control': 'public, max-age=3600, no-transform' });
    });
