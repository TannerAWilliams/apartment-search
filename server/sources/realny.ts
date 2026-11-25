/**
 * REAL New York: the rentals on its own site (realnyproperties.com/Rentals), which runs on RealtyMX like
 * Bond New York's. The search lists REAL's rentals and other brokers' shared ones, many pages of cards at
 * a time; robots.txt allows it (only /images/ and /admin are disallowed).
 *
 * RealtyMX cards give the street address, neighborhood, rent, bedrooms and baths but no ZIP code. The search's
 * own neighborhood filter says which borough each neighborhood is in, and the U.S. Census geocoder (one batch
 * request) gives the ZIP code and coordinates of each street address; a listing is kept only when the Census
 * finds the address in the borough its neighborhood is in. Listings that hide the building number, outside
 * the five boroughs, or that are not homes (retail, offices, parking) are left out.
 */
import { parse } from 'csv-parse/browser/esm/sync';
import type { ListingData } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, publicListingUrl } from './public-rentals.ts';

type Borough = NonNullable<ReturnType<typeof nycBorough>>;

/** RealtyMX neighborhood groups, as the two sites name them, and the borough each is in. */
const GROUP_BOROUGHS: Record<string, Borough> = {
  Manhattan: 'Manhattan',
  'East Side': 'Manhattan',
  'West Side': 'Manhattan',
  Midtown: 'Manhattan',
  Downtown: 'Manhattan',
  'Upper Manhattan': 'Manhattan',
  Brooklyn: 'Brooklyn',
  Queens: 'Queens',
  Bronx: 'Bronx',
  'Staten Island': 'Staten Island',
};
/** The kinds of home RealtyMX lists for rent (its others are retail, office, parking and the like). */
export const REALTYMX_HOMES = new Set(['Apartment', 'Condo', 'Condop', 'Coop', 'House', 'Townhouse', 'Loft', 'Multi-Family']);

export const decodeRealtyMx = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#0*39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type RealtyMxCard = {
  id: string;
  url: string;
  street: string;
  unit: string;
  area: string;
  type: string;
  rent: number;
  bedrooms: number;
  bathrooms: number;
};

/**
 * A card's street address and unit: "145 HENRY STREET, #2A". Cards that hide the building number show only the
 * street ("1ST AVENUE"), which gives no street.
 */
export function realtyMxAddress(text: string) {
  const [, street = '', unit = ''] = text.match(/^(\d+(?:-\d+)?[a-z]?\s[^,#]*?)\s*(?:[,#]\s*#?\s*(?:(?:apt|unit)\.?\s+)?(.*))?$/i) ?? [];
  return { street, unit };
}

/** The neighborhoods of a RealtyMX search's filter, by name, with the borough of the group each is listed under. */
export function parseRealtyMxAreas(html: string) {
  const groups = new Map<string, string>();
  for (const [, id, name] of html.matchAll(/id="Cat_(\d+)" href="[^"#]*#cat\d+">([^<]+)</g)) groups.set(id, decodeRealtyMx(name));
  const areas = new Map<string, Borough>();
  for (const [, name, group] of html.matchAll(
    /aria-label="([^"]+)" type="checkbox" name="cat" value="\d+"\s*class="styled checkCat_(\d+)/g,
  )) {
    const borough = GROUP_BOROUGHS[groups.get(group) ?? ''];
    if (borough) areas.set(decodeRealtyMx(name), borough);
  }
  // A card can also name a whole group ("Brooklyn").
  for (const name of groups.values()) if (GROUP_BOROUGHS[name]) areas.set(name, GROUP_BOROUGHS[name]);
  return areas;
}

/** A RealtyMX search page's listing cards and its total. Throws when the page is not a recognizable search. */
export function parseRealtyMxPage(html: string, listingUrl: (value: unknown) => string | null, name: string) {
  const total = Number(html.match(/<h3>\s*([\d,]+) records found\s*<\/h3>/)?.[1]?.replaceAll(',', ''));
  if (!Number.isSafeInteger(total)) throw new Error(name + ' did not return a recognized rentals search page.');
  const cards: RealtyMxCard[] = [];
  for (const card of html.split('<li class="property-card').slice(1)) {
    const id = card.match(/data-pid="(\d+)"/)?.[1];
    const link = card.match(/<h3>\s*<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const url = listingUrl(link?.[1]);
    const type = decodeRealtyMx(card.match(/class="property-grid-type">([^<]*)</)?.[1] ?? '');
    const area = decodeRealtyMx(card.match(/class="property-grid-area"[^>]*>([^<]*)</)?.[1] ?? '');
    const rent = Number(card.match(/class="price">\s*<span>\$([\d,]+)<\/span>/)?.[1]?.replaceAll(',', ''));
    const rooms = decodeRealtyMx(card.match(/class="bedrooms"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '');
    const bedrooms = /^Studio\b/.test(rooms) ? 0 : Math.floor(Number(rooms.match(/(?:^|\| )([\d.]+) BR\b/)?.[1] ?? NaN));
    const { street, unit } = realtyMxAddress(decodeRealtyMx(link?.[2] ?? ''));
    if (!id || !url || !street || !REALTYMX_HOMES.has(type) || !area || !Number.isFinite(rent) || !Number.isInteger(bedrooms)) continue;
    cards.push({ id, url, street, unit, area, type, rent, bedrooms, bathrooms: Number(rooms.match(/([\d.]+) BT\b/)?.[1]) });
  }
  return { total, cards };
}

type Located = { zip: string; latitude: number; longitude: number };
const csvField = (value: string) => '"' + value.replaceAll('"', '""') + '"';

/**
 * ZIP codes and coordinates of street addresses from the U.S. Census batch geocoder, by id. Addresses it
 * cannot match are left out.
 */
export async function censusLocations(fetcher: FetchTransport, rows: { id: string; street: string; city: string }[]) {
  const located = new Map<string, Located>();
  if (!rows.length) return located;
  const form = new FormData();
  const csv = rows.map(({ id, street, city }) => [id, street, city, 'NY', ''].map(csvField).join(',')).join('\n');
  form.set('addressFile', new Blob([csv], { type: 'text/csv' }), 'apartments.csv');
  form.set('benchmark', 'Public_AR_Current');
  const response = await fetcher('https://geocoding.geo.census.gov/geocoder/locations/addressbatch', {
    method: 'POST',
    body: form,
    redirect: 'manual',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error('The Census geocoder returned HTTP ' + response.status + '.');
  for (const row of parse(await response.text(), { skip_empty_lines: true, relax_column_count: true }) as string[][]) {
    const zip = row[2] === 'Match' ? row[4]?.match(/, NY, (\d{5})$/)?.[1] : undefined;
    const [longitude, latitude] = (row[5] ?? '').split(',').map(Number);
    if (zip && latitude >= 40 && latitude <= 41.5 && longitude >= -74.5 && longitude <= -73)
      located.set(row[0], { zip, latitude, longitude });
  }
  return located;
}

export type RealtyMxSite = {
  source: { id: string; name: string; kind: string };
  origin: string;
  /** The search's listing status filter for rentals, as the site's own Rentals link sets it. */
  status: string;
  rowsPerPage: number;
  maxPages: number;
  listingUrl: (value: unknown) => string | null;
  /** How the site's search template lays out its cards, when it is not RealtyMX's usual grid. */
  parsePage?: typeof parseRealtyMxPage;
};

/** Every rental of a RealtyMX search, read a page at a time, with ZIP codes from the Census geocoder. */
export async function loadRealtyMx(site: RealtyMxSite, fetcher: FetchTransport, now: Date, pauseMs = 1000) {
  const checkedAt = now.toISOString();
  const { name } = site.source;
  const pageUrl = (start: number) =>
    `${site.origin}/index.cfm?page=properties&status=${site.status}&isCompany=1&isMLS=1&maxRows=${site.rowsPerPage}&startAt=${start}`;
  const firstHtml = await fetchPublicHtml(fetcher, pageUrl(1), name, 30_000);
  const areas = parseRealtyMxAreas(firstHtml);
  if (!areas.size) throw new Error(name + ' did not list its neighborhoods.');
  const parsePage = site.parsePage ?? parseRealtyMxPage;
  const first = parsePage(firstHtml, site.listingUrl, name);
  const pages = Math.max(1, Math.ceil(first.total / site.rowsPerPage));
  if (pages > site.maxPages) throw new Error(name + ' listed more rentals than expected.');
  const cards = [...first.cards];
  // One page at a time with a pause, as a person would browse the search.
  for (let page = 2; page <= pages; page++) {
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const next = parsePage(await fetchPublicHtml(fetcher, pageUrl((page - 1) * site.rowsPerPage + 1), name, 30_000), site.listingUrl, name);
    cards.push(...next.cards);
  }
  const homes = [...new Map(cards.map((card) => [card.id, card])).values()].flatMap((card) => {
    const borough = areas.get(card.area);
    // The Census knows Queens addresses by their neighborhood's postal name (Astoria, Flushing, ...).
    const city = borough === 'Manhattan' ? 'New York' : borough === 'Queens' ? card.area : borough;
    return borough && city ? [{ card, borough, city }] : [];
  });
  const located = await censusLocations(
    fetcher,
    homes.map(({ card, city }) => ({ id: card.id, street: card.street, city })),
  );
  const listings: ListingData[] = [];
  for (const { card, borough } of homes) {
    const place = located.get(card.id);
    if (!place || nycBorough(place.zip) !== borough) continue;
    const listing = normalizeListing(
      {
        id: card.id,
        url: card.url,
        address: card.street,
        unit: card.unit,
        city: borough,
        state: 'NY',
        region: 'nyc',
        zipCode: place.zip,
        latitude: place.latitude,
        longitude: place.longitude,
        bedrooms: card.bedrooms,
        bathrooms: Number.isFinite(card.bathrooms) ? card.bathrooms : undefined,
        rent: card.rent,
        neighborhood: card.area,
        company: name,
        status: 'Active',
        updatedAt: checkedAt,
      },
      site.source,
    );
    if (listing) listings.push(listing);
  }
  return { listings, pages, total: first.total, rawCount: cards.length, checkedAt };
}

const SOURCE = { id: 'realny', name: 'REAL New York', kind: 'feed' };
const ORIGIN = 'https://www.realnyproperties.com';
export const realnyListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/[a-z0-9-]+\/[a-z-]+-for-rent\/[a-z0-9-]+\/\d+$/);
// About 1,400 rentals (3 pages of 500 cards, about 1.2 MB each) in November 2026.
const REALNY: RealtyMxSite = {
  source: SOURCE,
  origin: ORIGIN,
  status: '2,21',
  rowsPerPage: 500,
  maxPages: 8,
  listingUrl: realnyListingUrl,
};

export const REALNY_LIVE = {
  ...SOURCE,
  id: 'realny-live',
  marketplace: SOURCE.id,
  coverage:
    'every rental with a street number in REAL New York’s own rentals search (its own and shared listings) in the five boroughs; ZIP codes from the Census geocoder',
  regions: ['nyc'],
  minPages: 1,
  maxPages: REALNY.maxPages,
  rowsPerPage: REALNY.rowsPerPage,
  listingUrl: realnyListingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadRealtyMx(REALNY, fetcher, now),
};
