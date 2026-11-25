/**
 * Stonehenge NYC: every available apartment in Stonehenge's Manhattan and Long Island City buildings, from the
 * landlord's own apartments page (stonehengenyc.com/apartments). The page lists all of them as cards (its
 * sitemap names the same apartment pages), so no apartment page is read. robots.txt allows the page but
 * disallows every address with a query string, so the site's filtered and paged views are never used.
 *
 * Cards give the street address, neighborhood, unit, rent, bedrooms, baths and size, but no ZIP code and no
 * posting date. The U.S. Census geocoder (one batch request for the buildings) gives each building's ZIP code
 * and coordinates; an apartment is kept only when the Census places it in the borough its neighborhood is in.
 */
import type { ListingData } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, publicListingUrl } from './public-rentals.ts';
import { censusLocations, decodeRealtyMx } from './realny.ts';

const SOURCE = { id: 'stonehenge', name: 'Stonehenge NYC', kind: 'feed' };
const ORIGIN = 'https://www.stonehengenyc.com';
export const STONEHENGE_TRANSPORT = 'stonehenge-apartments-page';
/** Webflow shows at most 100 items in a list; a page that full may be hiding apartments behind its pages. */
const MAX_CARDS = 100;
/** Stonehenge's neighborhoods outside Manhattan, and their boroughs. */
const OUTER_BOROUGHS: Partial<Record<string, 'Queens' | 'Brooklyn'>> = {
  'Long Island City': 'Queens',
  Astoria: 'Queens',
  Brooklyn: 'Brooklyn',
};

export function stonehengeListingUrl(value: unknown) {
  return publicListingUrl(value, ORIGIN, /^\/apartments\/[a-z0-9-]{1,60}$/);
}

export type StonehengeCard = {
  id: string;
  url: string;
  address: string;
  unit: string;
  building: string;
  neighborhood: string;
  rent: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
};

const field = (card: string, pattern: RegExp) => decodeRealtyMx(card.match(pattern)?.[1] ?? '');
const amount = (text: string) => Number(text.replace(/[$,]/g, '') || Number.NaN);

/**
 * The apartments on the apartments page, once each (the page shows each card twice, in its list and map
 * views). Throws when the page shows none, or as many as a Webflow list can hold.
 */
export function parseStonehengeApartments(html: string): StonehengeCard[] {
  const cards = new Map<string, StonehengeCard>();
  for (const card of html.split(/<div role="listitem" class="apt-card-collection-item\b/).slice(1)) {
    const url = stonehengeListingUrl(card.match(/href="([^"]+)"/)?.[1]);
    if (!url) continue;
    const id = url.slice(url.lastIndexOf('/') + 1);
    const rooms = field(card, /fs-cmsfilter-field="Bedroom"[^>]*>([^<]*)</);
    const bedrooms = rooms === 'Studio' ? 0 : Math.min(4, amount(rooms.match(/^(\d+) Bedrooms?$/)?.[1] ?? ''));
    const apartment = {
      id,
      url,
      address: field(card, /<\/h4><\/div><div class="text-color-secondary text-size-small cards-text"[^>]*>([^<]*)</),
      unit: field(card, /class="heading-style-h4 text-color-secondary text-size-medium"[^>]*>([^<]*)</),
      building: field(card, /fs-cmsfilter-field="building"[^>]*>([^<]*)</),
      neighborhood: field(card, /fs-cmsfilter-field="Neighborhood"[^>]*>([^<]*)</),
      rent: amount(field(card, /fs-cmsfilter-field="Price"[^>]*>([^<]*)</)),
      bedrooms,
      bathrooms: amount(field(card, /fs-cmsfilter-field="Bathroom"[^>]*>([^<]*)</)),
      squareFeet: amount(field(card, />([\d,]+)<\/div><div[^>]*>ft(?:²|&sup2;)/)),
    };
    if (
      !/^\d+(?:-\d+)?[a-z]? /i.test(apartment.address) ||
      !apartment.neighborhood ||
      !Number.isFinite(apartment.rent) ||
      !Number.isInteger(bedrooms)
    )
      continue;
    if (!cards.has(id)) cards.set(id, apartment);
  }
  if (!cards.size) throw new Error('Stonehenge did not return a recognized apartments page.');
  if (cards.size >= MAX_CARDS) throw new Error('Stonehenge listed more apartments than its page shows at once.');
  return [...cards.values()];
}

export async function loadStonehenge(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const cards = parseStonehengeApartments(await fetchPublicHtml(fetcher, ORIGIN + '/apartments', 'Stonehenge', 20_000));
  const borough = (card: StonehengeCard) => OUTER_BOROUGHS[card.neighborhood] ?? 'Manhattan';
  // The Census knows Queens addresses by their neighborhood's postal name (Long Island City).
  const buildings = [...new Map(cards.map((card) => [card.address, card])).values()];
  const located = await censusLocations(
    fetcher,
    buildings.map((card) => ({
      id: card.address,
      street: card.address,
      city: borough(card) === 'Manhattan' ? 'New York' : borough(card) === 'Queens' ? card.neighborhood : borough(card),
    })),
  );
  const listings: ListingData[] = [];
  for (const card of cards) {
    const place = located.get(card.address);
    const city = borough(card);
    if (!place || nycBorough(place.zip) !== city) continue;
    const listing = normalizeListing(
      {
        id: card.id,
        url: card.url,
        address: card.address,
        unit: card.unit,
        city,
        state: 'NY',
        region: 'nyc',
        zipCode: place.zip,
        latitude: place.latitude,
        longitude: place.longitude,
        bedrooms: card.bedrooms,
        bathrooms: Number.isFinite(card.bathrooms) ? card.bathrooms : undefined,
        squareFeet: Number.isFinite(card.squareFeet) ? card.squareFeet : undefined,
        rent: card.rent,
        neighborhood: card.neighborhood,
        company: 'Stonehenge NYC',
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    if (listing) listings.push(listing);
  }
  return { listings, pages: 1, total: cards.length, rawCount: cards.length, transport: STONEHENGE_TRANSPORT, checkedAt };
}

export const STONEHENGE_LIVE = {
  ...SOURCE,
  id: 'stonehenge-live',
  marketplace: SOURCE.id,
  coverage:
    'every apartment on Stonehenge NYC’s own apartments page (it lists all of them on one page); ZIP codes from the Census geocoder',
  regions: ['nyc'],
  minPages: 1,
  maxPages: 1,
  rowsPerPage: MAX_CARDS,
  listingUrl: stonehengeListingUrl,
  load: loadStonehenge,
};
