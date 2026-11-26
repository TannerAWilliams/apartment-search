/**
 * Articles about New York City's rental market, written from the monthly figures the site already keeps
 * (StreetEasy's Data Dashboard, in the market history tables). Each month has three: the city's rent report, the
 * most affordable neighborhoods, and where rents rose and fell most. They are composed when read, so a new
 * month's figures publish a new set without anyone writing them, and every statement is a number from the data.
 */
import { DASHBOARD_URL } from '../src/dashboard-data.ts';
import { formatRent } from '../src/search.ts';
import type { ArchiveLoader } from './dashboard-snapshot.ts';
import type { D1Database } from './storage/d1-bucket.ts';
import { ensureMarketSeries, marketHistoryState, marketMonth, seriesId } from './storage/market-history.ts';

const SIZES = [
  ['Studio', 'Studio'],
  ['OneBd', '1 bedroom'],
  ['TwoBd', '2 bedrooms'],
  ['ThreePlusBd', '3+ bedrooms'],
] as const;
const RENT = 'medianAskingRent_All.csv';
const INVENTORY = 'rentalInventory_All.csv';
const CUTS = 'discountShare_All.csv';
const SERIES = [RENT, INVENTORY, CUTS, ...SIZES.map(([segment]) => `medianAskingRent_${segment}.csv`)];
/** How many months of articles stay published. */
const MONTHS_KEPT = 12;
/** A neighborhood needs this many rentals listed to be ranked, so a handful of listings does not top a list. */
const MIN_INVENTORY = 25;
const KINDS = ['nyc-rent-report', 'most-affordable-neighborhoods', 'where-rents-are-rising-and-falling'] as const;
type Kind = (typeof KINDS)[number];

export type Article = { slug: string; month: string; title: string; description: string; html: string };
type Figure = { name: string; borough: string; type: string; value: number | null; yearAgo: number | null };

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
/** "October 2026" for 2026-10. */
export const monthName = (month: string) =>
  new Date(month + '-15T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shiftMonth = (month: string, by: number) => {
  const date = new Date(month + '-15T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
};
/** The change from a year earlier as a fraction, or null when either figure is missing. */
const change = ({ value, yearAgo }: Pick<Figure, 'value' | 'yearAgo'>) => (value !== null && yearAgo ? (value - yearAgo) / yearAgo : null);
const percent = (fraction: number) => `${Math.abs(fraction * 100).toFixed(1)}%`;
/** "up 4.2% from a year earlier", "unchanged from a year earlier", or nothing when it cannot be said. */
const against = (figure: Pick<Figure, 'value' | 'yearAgo'>) => {
  const delta = change(figure);
  if (delta === null) return '';
  return Math.abs(delta) < 0.0005
    ? ', unchanged from a year earlier'
    : `, ${delta > 0 ? 'up' : 'down'} ${percent(delta)} from a year earlier`;
};
const signed = (figure: Pick<Figure, 'value' | 'yearAgo'>) => {
  const delta = change(figure);
  return delta === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${percent(delta)}`;
};
const table = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((cell) => `<th>${escape(cell)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
const source = (month: string) =>
  `<p class="muted">Source: <a href="${DASHBOARD_URL}" rel="noopener">StreetEasy Data Dashboard</a>, ${escape(monthName(month))}. Median asking rents are of rentals listed on StreetEasy that month; they are what landlords asked, not what tenants signed for. Year-over-year changes compare with ${escape(monthName(shiftMonth(month, -12)))}.</p>`;

/** The months articles are published for, newest first: the latest month with figures and the eleven before it. */
export async function articleMonths(database: D1Database, loadArchive: ArchiveLoader) {
  await ensureMarketSeries(database, SERIES, loadArchive);
  const latest = (await marketHistoryState(database)).imports.get(seriesId(RENT))?.last_month;
  return latest ? Array.from({ length: MONTHS_KEPT }, (_, index) => shiftMonth(latest, -index)) : [];
}
export const articleSlugs = (months: string[]) => months.flatMap((month) => KINDS.map((kind) => `${kind}-${month}`));
const titleOf = (kind: Kind, month: string) =>
  ({
    'nyc-rent-report': `New York City rent report: ${monthName(month)}`,
    'most-affordable-neighborhoods': `The most affordable New York City neighborhoods to rent in, ${monthName(month)}`,
    'where-rents-are-rising-and-falling': `Where New York City rents are rising and falling, ${monthName(month)}`,
  })[kind];
/** Every published article's address and title, newest first, without composing them. */
export const articleList = (months: string[]) =>
  months.flatMap((month) => KINDS.map((kind) => ({ slug: `${kind}-${month}`, month, title: titleOf(kind, month) })));

/** One series' figures for the month and a year earlier, by area. */
async function figures(database: D1Database, name: string, month: string): Promise<Figure[]> {
  const [{ areas }, values] = await Promise.all([marketHistoryState(database), marketMonth(database, name, month, shiftMonth(month, -12))]);
  const byId = new Map(areas.map((area) => [area.id, area]));
  return values.flatMap(({ area, value, yearAgo }) => {
    const known = byId.get(area);
    return known ? [{ name: known.name, borough: known.borough, type: known.type, value, yearAgo }] : [];
  });
}

/** The article at this address, or null when there is none (an unknown address, or a month without figures). */
export async function composeArticle(database: D1Database, loadArchive: ArchiveLoader, slug: string): Promise<Article | null> {
  const found = /^(.+)-(\d{4}-\d{2})$/.exec(slug);
  const kind = KINDS.find((candidate) => candidate === found?.[1]);
  const month = found?.[2];
  if (!kind || !month || !(await articleMonths(database, loadArchive)).includes(month)) return null;
  const [rents, inventory, cuts, ...bySize] = await Promise.all(SERIES.map((name) => figures(database, name, month)));
  const city = rents!.find(({ type }) => type === 'city');
  if (!city || city.value === null) return null;
  const title = titleOf(kind, month);
  const listed = new Map(inventory!.map((figure) => [`${figure.type}|${figure.borough}|${figure.name}`, figure.value ?? 0]));
  // Neighborhoods with enough rentals listed that their median means something.
  const neighborhoods = rents!.filter(
    (figure): figure is Figure & { value: number } =>
      figure.type === 'neighborhood' &&
      figure.value !== null &&
      (listed.get(`neighborhood|${figure.borough}|${figure.name}`) ?? 0) >= MIN_INVENTORY,
  );
  const place = ({ name, borough }: Figure) => `${name}, ${borough}`;

  if (kind === 'nyc-rent-report') {
    const boroughs = rents!.filter(({ type, value }) => type === 'borough' && value !== null);
    const cityInventory = inventory!.find(({ type }) => type === 'city');
    const cityCuts = cuts!.find(({ type }) => type === 'city');
    const sizes = SIZES.flatMap(([, label], index) => {
      const figure = bySize[index]!.find(({ type }) => type === 'city');
      return figure && figure.value !== null ? [[label, formatRent(figure.value), signed(figure)]] : [];
    });
    const everyNeighborhood = rents!
      .filter((figure): figure is Figure & { value: number } => figure.type === 'neighborhood' && figure.value !== null)
      .toSorted((x, y) => y.value - x.value);
    const lead = `The median asking rent in New York City was ${formatRent(city.value)} in ${monthName(month)}${against(city)}.`;
    const html = [
      `<p>${escape(lead)}</p>`,
      cityInventory?.value
        ? `<p>${escape(`${Math.round(cityInventory.value).toLocaleString('en-US')} rentals were listed${against(cityInventory)}.`)}${
            cityCuts?.value ? escape(` ${(cityCuts.value * 100).toFixed(1)}% of them had their asking rent cut during the month.`) : ''
          }</p>`
        : '',
      '<h2>By borough</h2>',
      table(
        ['Borough', 'Median asking rent', 'From a year earlier'],
        boroughs.sort((a, b) => b.value! - a.value!).map((figure) => [figure.name, formatRent(figure.value!), signed(figure)]),
      ),
      '<h2>By size</h2>',
      table(['Size', 'Median asking rent', 'From a year earlier'], sizes),
      // Every neighborhood with a median that month, dearest first; a median of few rentals moves a lot, so the count is shown.
      `<h2>${escape(`All ${everyNeighborhood.length} neighborhoods, by rent`)}</h2>`,
      table(
        ['', 'Neighborhood', 'Median asking rent', 'From a year earlier', 'Rentals listed'],
        everyNeighborhood.map((figure, index) => [
          String(index + 1),
          place(figure),
          formatRent(figure.value),
          signed(figure),
          Math.round(listed.get(`neighborhood|${figure.borough}|${figure.name}`) ?? 0).toLocaleString('en-US'),
        ]),
      ),
      source(month),
    ].join('\n');
    return { slug, month, title, description: lead, html };
  }

  if (kind === 'most-affordable-neighborhoods') {
    const cheapest = neighborhoods.toSorted((a, b) => a.value - b.value).slice(0, 15);
    if (!cheapest.length) return null;
    const lead = `${place(cheapest[0]!)} had the lowest median asking rent of New York City's neighborhoods in ${monthName(month)}, at ${formatRent(cheapest[0]!.value)}. The city's median was ${formatRent(city.value)}.`;
    const html = [
      `<p>${escape(lead)}</p>`,
      `<p>${escape(`The fifteen neighborhoods with the lowest median asking rents, among those with at least ${MIN_INVENTORY} rentals listed:`)}</p>`,
      table(
        ['', 'Neighborhood', 'Median asking rent', 'From a year earlier'],
        cheapest.map((figure, index) => [String(index + 1), place(figure), formatRent(figure.value), signed(figure)]),
      ),
      source(month),
    ].join('\n');
    return { slug, month, title, description: lead, html };
  }

  const moved = neighborhoods.flatMap((figure) => {
    const delta = change(figure);
    return delta === null ? [] : [{ figure, delta }];
  });
  if (!moved.length) return null;
  const rising = moved.toSorted((a, b) => b.delta - a.delta).slice(0, 10);
  const falling = moved
    .filter(({ delta }) => delta < 0)
    .toSorted((a, b) => a.delta - b.delta)
    .slice(0, 10);
  const rows = (list: typeof moved) =>
    list.map(({ figure }) => [place(figure), formatRent(figure.value!), formatRent(figure.yearAgo!), signed(figure)]);
  const lead = `Median asking rents rose most in ${place(rising[0]!.figure)}, up ${percent(rising[0]!.delta)} from a year earlier to ${formatRent(rising[0]!.figure.value!)}, in ${monthName(month)}.${
    falling.length
      ? ` They fell most in ${place(falling[0]!.figure)}, down ${percent(falling[0]!.delta)} to ${formatRent(falling[0]!.figure.value!)}.`
      : ''
  }`;
  const head = ['Neighborhood', monthName(month), monthName(shiftMonth(month, -12)), 'Change'];
  const html = [
    `<p>${escape(lead)}</p>`,
    `<p>${escape(`Citywide, the median asking rent was ${formatRent(city.value)}${against(city)}. Neighborhoods with fewer than ${MIN_INVENTORY} rentals listed are left out.`)}</p>`,
    '<h2>Largest increases</h2>',
    table(head, rows(rising)),
    ...(falling.length ? ['<h2>Largest decreases</h2>', table(head, rows(falling))] : []),
    source(month),
  ].join('\n');
  return { slug, month, title, description: lead, html };
}
