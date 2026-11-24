/**
 * Nest Seekers: rentals on its own site's Brooklyn, Queens and Manhattan rentals pages
 * (nestseekers.com/Rentals/<area>/), newest first, about 38 cards a page; robots.txt allows these pages.
 * Brooklyn and Queens are read in full. Manhattan has about 35 pages (some 1,300 rentals in November 2026), more
 * than one gentle sync should ask for, so it is read for the pages left of a 39-page budget, newest first.
 *
 * Cards give the street address, neighborhood, borough, bedrooms, baths and rent, but rarely the ZIP code, which
 * comes from the U.S. Census geocoder (see realny.ts) and must fall in the card's borough. Commercial leases,
 * buildings priced as a range, and cards without a building number are left out.
 */
import type { ListingData } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, publicListingUrl } from './public-rentals.ts';
import { censusLocations } from './realny.ts';

const SOURCE = { id: 'nestseekers', name: 'Nest Seekers', kind: 'feed' };
const ORIGIN = 'https://www.nestseekers.com';
const AREAS = ['brooklyn', 'queens', 'manhattan'];
const PAGE_BUDGET = 39;
const BOROUGHS = ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'] as const;
type Borough = (typeof BOROUGHS)[number];

export const nestseekersListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/\d+\/[a-z0-9-]+$/);
const areaPage = (area: string, page: number) => `${ORIGIN}/Rentals/${area}/?sortBy=newest${page > 1 ? `&page=${page}` : ''}`;

const decode = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#0*39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const divs = (html: string | undefined) => [...(html ?? '').matchAll(/<div>([^<]*)<\/div>/g)].map(([, text]) => decode(text));

export type NestSeekersCard = {
  id: string;
  url: string;
  street: string;
  unit: string;
  zip: string;
  neighborhood: string;
  borough: Borough;
  bedrooms: number;
  bathrooms: number;
  rent: number;
};

/** The rental cards on a Nest Seekers rentals page and its last page number. Throws when the page is not recognizable. */
export function parseNestSeekersPage(html: string) {
  if (!html.includes('id="search-results"')) throw new Error('Nest Seekers did not return a recognized rentals page.');
  const lastPage = Math.max(1, ...[...html.matchAll(/[?&]page=(\d+)"/g)].map(([, page]) => Number(page)));
  const cards: NestSeekersCard[] = [];
  const parts = html.split(/<a href="(https:\/\/www\.nestseekers\.com\/\d+\/[^"]+)" class="hover:no-underline/);
  for (let index = 1; index < parts.length; index += 2) {
    const url = nestseekersListingUrl(parts[index]);
    const card = parts[index + 1].slice(parts[index + 1].indexOf('<div class="hidden grow'));
    const place = divs(card.match(/<div class="text-base leading-tight">((?:<div>[^<]*<\/div>)+)<\/div>/)?.[1]);
    const facts = divs(card.match(/<div class="w-1\/3 text-sm leading-tight text-right">((?:<div>[^<]*<\/div>)+)<\/div>/)?.[1]);
    const rent = Number(card.match(/text-center">\$([\d,]+)<\/div>/)?.[1]?.replaceAll(',', ''));
    const borough = BOROUGHS.find((name) => place.includes(name));
    // "67 Livingston Street, Unit 20, Brooklyn, NY 11201" or just "128 Summit Street".
    const [, street, unit = ''] = place[0]?.match(/^(\d+(?:-\d+)?[A-Za-z]?\s[^,]+?)(?:,\s*(?:Unit|Apt\.?|#)\s*([^,]+))?(?:,.*)?$/i) ?? [];
    const zip = place[0]?.match(/, NY (\d{5})(?:, USA)?$/)?.[1] ?? '';
    // Bedrooms read "2 bed" or "Studio", or only the kind of home says them ("2 bedroom apartment").
    const rooms =
      facts.find((fact) => /^(?:\d+ bed|Studio)$/.test(fact)) ?? facts.find((fact) => /^(?:\d\+? bedroom|Studio)\b/i.test(fact)) ?? '';
    const bedrooms = /^Studio/i.test(rooms) ? 0 : Number.parseInt(rooms, 10);
    const bathrooms = Number(
      facts
        .find((fact) => / bath$/.test(fact))
        ?.replace('½', '.5')
        .replace(' bath', ''),
    );
    if (
      !url ||
      !street ||
      !borough ||
      !Number.isFinite(rent) ||
      !Number.isInteger(bedrooms) ||
      facts.some((fact) => /commercial/i.test(fact))
    )
      continue;
    cards.push({
      id: url.split('/')[3],
      url,
      street,
      unit,
      zip,
      neighborhood: place[1] ?? '',
      borough,
      bedrooms,
      bathrooms,
      rent,
    });
  }
  return { lastPage, cards };
}

export async function loadNestSeekers(fetcher: FetchTransport, now: Date, pauseMs = 1000) {
  const checkedAt = now.toISOString();
  const cards = new Map<string, NestSeekersCard>();
  let pages = 0;
  for (const area of AREAS) {
    for (let page = 1, lastPage = 1; page <= lastPage; page++) {
      if (pages === PAGE_BUDGET) break;
      // One page at a time with a pause, as a person would browse the site.
      if (pages) await new Promise((resolve) => setTimeout(resolve, pauseMs));
      const result = parseNestSeekersPage(await fetchPublicHtml(fetcher, areaPage(area, page), SOURCE.name, 20_000));
      pages++;
      lastPage = result.lastPage;
      for (const card of result.cards) cards.set(card.id, card);
    }
  }
  const homes = [...cards.values()];
  const located = await censusLocations(
    fetcher,
    // Every address, for its coordinates too.
    homes.map((card) => ({
      id: card.id,
      street: card.street,
      // The Census knows Queens addresses by their neighborhood's postal name (Astoria, Flushing, ...).
      city: card.borough === 'Manhattan' ? 'New York' : card.borough === 'Queens' ? card.neighborhood : card.borough,
    })),
  );
  const listings: ListingData[] = [];
  for (const card of homes) {
    const place = located.get(card.id);
    const zip = card.zip || place?.zip || '';
    if (nycBorough(zip) !== card.borough) continue;
    const listing = normalizeListing(
      {
        id: card.id,
        url: card.url,
        address: card.street,
        unit: card.unit,
        city: card.borough,
        state: 'NY',
        region: 'nyc',
        zipCode: zip,
        latitude: place?.latitude,
        longitude: place?.longitude,
        bedrooms: card.bedrooms,
        bathrooms: Number.isFinite(card.bathrooms) ? card.bathrooms : undefined,
        rent: card.rent,
        neighborhood: card.neighborhood,
        company: SOURCE.name,
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    if (listing) listings.push(listing);
  }
  return { listings, pages, rawCount: cards.size, checkedAt };
}

export const NESTSEEKERS_LIVE = {
  ...SOURCE,
  id: 'nestseekers-live',
  marketplace: SOURCE.id,
  coverage: `Brooklyn and Queens rentals pages in full and Manhattan's newest, up to ${PAGE_BUDGET} pages in all; ZIP codes from the Census geocoder`,
  regions: ['nyc'],
  minPages: 1,
  maxPages: PAGE_BUDGET,
  rowsPerPage: 60,
  listingUrl: nestseekersListingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadNestSeekers(fetcher, now),
};
