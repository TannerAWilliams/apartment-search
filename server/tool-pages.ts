/**
 * Two free tools as pages of their own, open to everyone and to search engines: check a New York City building
 * against city records, and compare a rent with what similar apartments in the neighborhood ask now. Each is a
 * page that explains itself and a form; the answer is the same page with the result on it. The pages are
 * indexed; an answer to one person's question is not.
 */
import { Hono } from 'hono';
import { summarizeReport } from './building-facts.ts';
import { retrieveBuildingRecords } from './building-records.ts';
import type { AppEnv } from './contracts.ts';
import { readEvictions } from './open-data.ts';
import { escape, page, recordLines, slug } from './public-pages.ts';
import { publicSummary } from './public-summary.ts';
import type { FetchTransport } from '../src/fetch-type.ts';
import { buildingGrade } from '../src/insights.ts';
import { formatRent } from '../src/search.ts';

const BUILDING_ABOUT = `<h2>What the grade means</h2>
<p>A is a building with a clean record; D is one with many open violations, pests, or an order to vacate. The grade comes from New York City’s and New York State’s own records, read when you ask:</p>
<ul><li>Open housing code violations (HPD)</li><li>Heat, hot water and other complaints in the last year</li><li>Bedbug filings and rat inspections</li><li>Evictions by a marshal and Housing Court cases, over two years</li><li>Whether it registers rent-stabilized apartments</li><li>Orders to vacate</li></ul>
<h2>Before you sign a lease</h2>
<p>Check the building, not only the apartment. A renovated unit says nothing about the heat in January or how the landlord treats repairs; the city’s records do.</p>`;

const buildingForm = (address = '', zip = '') =>
  `<form class="form" method="get" action="/check-building"><label>Street address<input name="address" required maxlength="120" placeholder="100 West 86th Street" value="${escape(address)}"></label><label>ZIP code<input name="zip" required pattern="\\d{5}" inputmode="numeric" maxlength="5" placeholder="10024" value="${escape(zip)}"></label><button>Check this building</button></form>`;

/** The building check: the page and its form, or the result for an address. */
export async function buildingPage(
  env: AppEnv,
  origin: string,
  query: { address?: string; zip?: string },
  fetcher: FetchTransport,
  now = new Date(),
) {
  const address = (query.address ?? '').trim().slice(0, 120);
  const zip = (query.zip ?? '').trim();
  const title = 'Check any NYC building before you rent: violations, bedbugs, heat, evictions | Walkup';
  const description =
    'Type a New York City address and see the building’s grade from city records: open violations, heat complaints, bedbugs, rats, evictions and Housing Court cases. Free.';
  const intro =
    '<h1>Check any NYC building before you rent</h1><p>Type an address and see what the city’s records say about the building: violations, heat and hot water complaints, bedbugs, rats, evictions and court cases, as one grade. Free, no account.</p>';
  if (!address && !zip) return page(origin, '/check-building', title, description, intro + buildingForm() + BUILDING_ABOUT);

  const evictions = env.BUCKET ? readEvictions(env.BUCKET).catch(() => null) : null;
  // Read as the city's records spell it (server/building-records.ts): "100 W 86th St." finds "100 WEST 86 STREET".
  const report = await retrieveBuildingRecords(
    { address: address.replace(/[.,]/g, ' '), zip, state: 'NY' },
    fetcher,
    now,
    undefined,
    evictions,
  );
  const facts = summarizeReport(report);
  const grade = facts ? buildingGrade(facts) : null;
  const result = facts
    ? `<h2>${escape(report.identity?.address ?? address)}</h2>${grade ? `<p class="grade">${grade}</p>` : ''}<div class="grid">${recordLines(
        { ...facts, checkedAt: now.toISOString() },
      )
        .map((line) => `<div class="tile">${escape(line)}</div>`)
        .join(
          '',
        )}</div><p class="muted">From New York City and New York State records, read just now. A record can lag what has happened in the building.</p><a class="cta" href="/search">See apartments with their building’s grade</a>`
    : `<h2>No building found at that address</h2><p>${
        report.status === 'unavailable'
          ? 'The city’s records could not be reached just now. Try again in a minute.'
          : 'Write the street as it is on a lease, with the house number and no apartment number, like “100 West 86th Street”, and the building’s own ZIP code. Only buildings in the five boroughs are covered.'
      }</p>`;
  return page(origin, '/check-building', title, description, intro + buildingForm(address, zip) + result + BUILDING_ABOUT, {
    noindex: true,
  });
}

const SIZES = ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms', '4 or more bedrooms'];
const RENT_ABOUT = `<h2>How the comparison works</h2>
<p>Your rent is set next to the median asking rent of apartments the same size listed in the same neighborhood right now, gathered from listing sites, brokerages and landlords. The median is the middle one: half ask more, half ask less.</p>
<h2>What to do with the answer</h2>
<p>If you pay well above the median, bring current listings to a renewal conversation, or look at what moving would save. If you pay below it, an increase is likely, and staying usually costs less than moving. A rent-stabilized apartment follows the Rent Guidelines Board’s increases, whatever the market does.</p>`;

/** The rent check: the page and its form, or the comparison for one rent. */
export async function rentPage(env: AppEnv, origin: string, query: { neighborhood?: string; bedrooms?: string; rent?: string }) {
  const summary = await publicSummary(env);
  const places = summary.neighborhoods;
  const chosen = places.find(({ name }) => slug(name) === slug(query.neighborhood ?? ''));
  const bedrooms = Math.min(4, Math.max(0, Math.trunc(Number(query.bedrooms ?? '1')) || 0));
  const rent = Math.trunc(Number((query.rent ?? '').replace(/[$,\s]/g, '')));
  const title = 'Is my rent fair? Compare your NYC rent with your neighborhood | Walkup';
  const description =
    'Enter your neighborhood, apartment size and rent, and see how it compares with the median asking rent of similar New York City apartments listed right now. Free.';
  const intro =
    '<h1>Is my rent fair?</h1><p>Compare your rent with what similar apartments in your New York City neighborhood ask right now. Free, no account.</p>';
  const form = `<form class="form" method="get" action="/rent-check"><label>Neighborhood<select name="neighborhood" required><option value="">Choose one</option>${places
    .map(
      ({ name, borough }) =>
        `<option value="${escape(name)}"${chosen?.name === name ? ' selected' : ''}>${escape(name)}, ${escape(borough)}</option>`,
    )
    .join('')}</select></label><label>Size<select name="bedrooms">${SIZES.map(
    (label, size) => `<option value="${size}"${size === bedrooms ? ' selected' : ''}>${label}</option>`,
  ).join(
    '',
  )}</select></label><label>Your monthly rent<input name="rent" required inputmode="numeric" maxlength="9" placeholder="3200" value="${rent > 0 ? rent : ''}"></label><button>Compare my rent</button></form>`;
  if (!chosen || !(rent > 0))
    return page(origin, '/rent-check', title, description, intro + form + RENT_ABOUT, { noindex: Boolean(query.rent) });

  const size = chosen.sizes[bedrooms]!;
  const place = `${escape(chosen.name)}, ${escape(chosen.borough)}`;
  const label = SIZES[bedrooms]!.toLowerCase();
  let verdict: string;
  if (size.median === null || size.count < 3) {
    verdict = `<p>Too few ${label} apartments are listed in ${place} right now to compare. Try a neighboring area, or the size next to yours.</p>`;
  } else {
    const delta = (rent - size.median) / size.median;
    const percent = Math.round(Math.abs(delta) * 100);
    const headline =
      delta > 0.05
        ? `${percent}% above the neighborhood’s median`
        : delta < -0.05
          ? `${percent}% below the neighborhood’s median`
          : 'In line with the neighborhood';
    verdict = `<p class="grade">${headline}</p><p>You pay ${formatRent(rent)} for a ${label} in ${place}. The median asking rent of the ${size.count} listed there now is ${formatRent(size.median)}${
      delta > 0.05
        ? `, so moving within the neighborhood could save about ${formatRent(Math.round(rent - size.median))} a month.`
        : delta < -0.05
          ? `, about ${formatRent(Math.round(size.median - rent))} a month more than you pay.`
          : '.'
    }</p>`;
  }
  const more = `<a class="cta" href="/rents/${chosen.path}">Rents in ${escape(chosen.name)} by size</a>`;
  return page(origin, '/rent-check', title, description, intro + form + `<h2>Your rent</h2>` + verdict + more + RENT_ABOUT, {
    noindex: true,
  });
}

/** A page that is not there. */
export const missingPage = (origin: string, path: string) =>
  page(
    origin,
    path,
    'Page not found | Walkup',
    'This page does not exist on Walkup.',
    '<h1>Page not found</h1><p>There is nothing at this address. It may have moved, or the link may be mistyped.</p><a class="cta" href="/">Search New York City apartments</a>',
    { noindex: true },
  );

export const toolPages = (env: AppEnv, fetcher: FetchTransport) =>
  new Hono()
    .get('/check-building', async (c) =>
      c.html(await buildingPage(env, new URL(c.req.url).origin, c.req.query(), fetcher), 200, {
        // The page itself is the same for everyone; an answer is one person's.
        'Cache-Control': c.req.query('address') ? 'private, no-store' : 'public, max-age=3600, no-transform',
      }),
    )
    .get('/rent-check', async (c) =>
      c.html(await rentPage(env, new URL(c.req.url).origin, c.req.query()), 200, {
        'Cache-Control': c.req.query('rent') ? 'private, no-store' : 'public, max-age=3600, no-transform',
      }),
    );
