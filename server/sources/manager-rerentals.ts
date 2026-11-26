/**
 * Income-restricted apartments re-rented by their managers, outside Housing Connect. The city lists the managers
 * (nyc.gov/site/hpd/services-and-information/find-affordable-housing-re-rentals.page); these are the ones that
 * publish their vacancies as a page of apartments, each read from that page. Their robots.txt files allow it.
 * The rest publish flyers, forms or nothing readable, and stay as links (src/screens/AffordableHousing.tsx).
 */
import type { SourceFetch } from '../contracts.ts';
import { isRecord } from '../../src/domain.ts';

export const MANAGER_RERENTALS = { id: 'manager-rerentals', name: 'Re-rental managers' };

export type ManagerRental = {
  id: string;
  manager: string;
  name: string;
  url: string;
  borough: string;
  /** Each as the manager states it, or empty when it does not. */
  size: string;
  rent: string;
  income: string;
};

const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'];
const boroughIn = (words: string) => BOROUGHS.find((borough) => new RegExp(`\\b${borough}\\b`, 'i').test(words)) ?? '';
const ENTITIES: Record<string, string> = { amp: '&', nbsp: ' ', quot: '"', '#39': "'", '#8217': '’', '#8211': '–', '#038': '&' };
/** A page's words, without its markup. */
export const words = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?\w+);/g, (_all, name: string) => ENTITIES[name] ?? ' ')
    .replace(/[\s​]+/g, ' ')
    .trim();
const labeled = (text: string, label: string) =>
  new RegExp(`${label}:\\s*([^:]*?)(?=\\s+(?:[A-Z][\\w’']*\\s)*[A-Z][\\w’']*:|\\s*\\*|$)`).exec(text)?.[1]?.trim() ?? '';
const dollars = (amount: number) => '$' + amount.toLocaleString('en-US');
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Fifth Avenue Committee: a card per apartment, with its building, unit and a list of labeled facts. */
export function readFifthAvenue(html: string, url: string): Omit<ManagerRental, 'manager'>[] {
  return html
    .split('grid_section-col')
    .slice(1)
    .flatMap((card) => {
      const building = words(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(card)?.[1] ?? '');
      const unit = words(/<h4[^>]*>([\s\S]*?)<\/h4>/.exec(card)?.[1] ?? '');
      const facts = words(/<ul[^>]*>([\s\S]*?)<\/ul>/.exec(card)?.[1] ?? '');
      if (!building || !unit || !facts) return [];
      const [low, high] = [labeled(facts, 'Min Income'), labeled(facts, 'Max Income')];
      return [
        {
          id: slug(`${building} ${unit}`),
          name: `${building}, ${unit}`,
          url,
          borough: boroughIn(building) || 'Brooklyn',
          size: labeled(facts, 'Unit Size'),
          rent: labeled(facts, 'Rent'),
          income: low && high ? `${low} to ${high}` : high ? `up to ${high}` : '',
        },
      ];
    });
}

/** MNS: a table row per apartment, with its address, unit, bedrooms and rent. */
export function readMns(html: string): Omit<ManagerRental, 'manager'>[] {
  return [...html.matchAll(/<tr class="afordable_listing"([^>]*)>([\s\S]*?)<\/tr>/g)].flatMap(([, attributes, row]) => {
    const address = words(/data-address="([^"]*)"/.exec(attributes!)?.[1] ?? '');
    const link = /href="(https:\/\/www\.mns\.com\/details\/(\d+)\/[^"]*)"/.exec(row!);
    const unit = words(/<td class="unit">([\s\S]*?)<\/td>/.exec(row!)?.[1] ?? '');
    const beds = /data-bedrooms="(\d+)"/.exec(attributes!)?.[1];
    if (!address || !link) return [];
    return [
      {
        id: link[2]!,
        name: [address, unit && `Unit ${unit}`].filter(Boolean).join(', '),
        url: link[1]!,
        borough: boroughIn(link[1]!.split('/').at(-1)!.replace(/\+/g, ' ')),
        size: beds === undefined ? '' : beds === '0' ? 'Studio' : `${beds}-bedroom`,
        rent: /\$[\d,]+/.exec(words(row!))?.[0] ?? '',
        income: '',
      },
    ];
  });
}

/** MGNY Consulting: its site's own list of buildings, with the household incomes each takes and how many apartments. */
export function readMgny(body: string): Omit<ManagerRental, 'manager'>[] {
  const rows: unknown = JSON.parse(body);
  if (!Array.isArray(rows)) throw new Error('not a list');
  return rows.filter(isRecord).flatMap((row) => {
    const facts = isRecord(row.acf) ? row.acf : {};
    const title = words(isRecord(row.title) && typeof row.title.rendered === 'string' ? row.title.rendered : '');
    const link = typeof row.link === 'string' && row.link.startsWith('https://mgnyconsulting.com/listing/') ? row.link : '';
    if (typeof row.slug !== 'string' || !title || !link) return [];
    const address = typeof facts.property_address === 'string' ? words(facts.property_address) : '';
    const [low, high, units] = [facts.min_income, facts.max_income, facts.units].map((value) =>
      typeof value === 'number' && value > 0 ? value : 0,
    );
    return [
      {
        id: row.slug,
        name: address && !address.startsWith(title) ? `${title}, ${address}` : address || title,
        url: link,
        borough: boroughIn(address),
        size: units ? `${units} ${units === 1 ? 'apartment' : 'apartments'}` : '',
        rent: '',
        income: low && high ? `${dollars(low!)} to ${dollars(high!)}` : '',
      },
    ];
  });
}

/** Taxace NY: a block of words per vacant apartment, in one fixed order. */
export function readTaxace(html: string, url: string): Omit<ManagerRental, 'manager'>[] {
  const each =
    /(\d[\w .'-]{2,60}?)\.? Unit ([\w-]+) (Bronx|Brooklyn|Queens|Manhattan|Staten Island) ?, NY (?:Apply )?Unit Size: ([\w-]+) Rent: (\$[\d,.]+)[\s\S]{0,120}?Min Income: (\$[\d,]+) ?- ?(\$[\d,]+)/g;
  return [...words(html).matchAll(each)].map(([, before, unit, borough, size, rent, low, high]) => {
    // The words before an address are the end of the apartment above it ("… Rent $3,741.18 Apply").
    const address = before!.replace(/^[\d.,]+ (?:Apply )?(?=\d)/, '');
    return {
      id: slug(`${address} ${unit}`),
      name: `${address}, Unit ${unit}`,
      url,
      borough: borough!,
      size: size!,
      rent: rent!,
      income: `${low} to ${high}`,
    };
  });
}

type Reader = { manager: string; url: string; from?: string; read: (body: string, url: string) => Omit<ManagerRental, 'manager'>[] };
export const MANAGERS: Reader[] = [
  { manager: 'Fifth Avenue Committee', url: 'https://fifthave.org/re-rental-availabilities/', read: readFifthAvenue },
  { manager: 'MNS', url: 'https://www.mns.com/affordable_units', read: readMns },
  {
    manager: 'MGNY Consulting',
    url: 'https://mgnyconsulting.com/listings/',
    // The page shows nine at a time; the list behind it has them all.
    from: 'https://mgnyconsulting.com/wp-json/wp/v2/listing?per_page=100&_fields=slug,link,title,acf.property_address,acf.units,acf.min_income,acf.max_income',
    read: readMgny,
  },
  { manager: 'Taxace NY', url: 'https://www.taxaceny.com/projects-8', read: readTaxace },
];

async function page(fetcher: SourceFetch, url: string) {
  const response = await fetcher(url, {
    headers: { Accept: 'text/html, application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.text();
}

/** Every manager's vacancies. One that cannot be read is named as such and the others are still shown. */
export async function loadManagerRerentals(fetcher: SourceFetch, managers = MANAGERS) {
  const answers = await Promise.allSettled(
    managers.map(async ({ manager, url, from, read }) => {
      const rows = read(await page(fetcher, from ?? url), url);
      return [...new Map(rows.map((row) => [row.id, { ...row, manager }])).values()];
    }),
  );
  const read = managers.map(({ manager, url }, index) => {
    const answer = answers[index]!;
    return { manager, url, count: answer.status === 'fulfilled' ? answer.value.length : null };
  });
  if (read.every(({ count }) => count === null)) throw new Error('None of the re-rental managers’ pages could be read.');
  return { results: answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : [])), managers: read };
}
