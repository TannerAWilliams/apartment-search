/**
 * Related Rentals: every available apartment in Related's New York City buildings, from the landlord's own
 * apartment search (/search, filtered to New York City, twelve to a page; robots.txt disallows only /search/).
 * Search cards give each apartment's building, size, rent and link but not the street address, so the
 * buildings' addresses and coordinates are read from the map data every building page carries.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { deduplicatePublicRentals, fetchPublicHtml, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'related', name: 'Related Rentals', kind: 'feed' };
const ORIGIN = 'https://www.relatedrentals.com';
/** At most this many search pages are read (about 30 apartments a page would be far more than Related lists). */
const MAX_SEARCH_PAGES = 30;
const UNIT_PATH = /^\/apartment-rentals\/new-york-city\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+-\d{1,9}$/;
export const relatedSearchUrl = (page: number) =>
  `${ORIGIN}/search?city%5BNew%20York%20City%5D=New%20York%20City&sort_by=price_min&page=${page}`;
export const relatedListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, UNIT_PATH);

export type RelatedCard = { id: string; url: string; building: string; bedrooms: number; bathrooms: number; rent: number };
export type RelatedBuilding = { address: string; zip: string; city: string; latitude: unknown; longitude: unknown };

const attribute = (html: string, name: string) => html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

/** The apartment cards on a search page, and the last page number its pager offers. */
export function parseRelatedSearch(html: string): { cards: RelatedCard[]; lastPage: number } {
  if (!html.includes('views-exposed-form-unit-solr-search-full-search'))
    throw new Error('Related did not return a recognized search page.');
  const cards = html
    .split('<article')
    .slice(1)
    .filter((card) => /^[^>]*node--type-unit/.test(card))
    .map((card) => {
      const url = relatedListingUrl(card.match(/<a href="([^"]+)"/)?.[1]);
      const id = attribute(card, 'data-api-id');
      const bedrooms = Number(attribute(card, 'data-dimension6'));
      const rent = Number(attribute(card, 'data-price'));
      if (!url || !id || !/^\d+$/.test(id) || !Number.isFinite(bedrooms) || !Number.isFinite(rent))
        throw new Error('Related listed an apartment it did not fully describe.');
      return { id, url, building: url.replace(/\/[^/]+$/, ''), bedrooms, bathrooms: Number(attribute(card, 'data-dimension7')), rent };
    });
  const pages = [...html.matchAll(/href="\?[^"]*\bpage=(\d+)"/g)].map(([, page]) => Number(page));
  return { cards, lastPage: Math.min(Math.max(0, ...pages), MAX_SEARCH_PAGES - 1) };
}

/** Related's buildings by page URL, from the map data on a building page; only those in the five boroughs. */
export function parseRelatedBuildings(html: string): Map<string, RelatedBuilding> {
  const json = html.match(/<script type="application\/json" data-drupal-selector="drupal-settings-json">([\s\S]*?)<\/script>/)?.[1];
  const settings: unknown = json ? JSON.parse(json) : null;
  const related = isRecord(settings) && isRecord(settings.relatedData) ? settings.relatedData : {};
  const places = related['map-properties'];
  if (!Array.isArray(places)) throw new Error('Related did not give its buildings’ addresses.');
  const buildings = new Map<string, RelatedBuilding>();
  for (const place of places) {
    if (!isRecord(place) || typeof place.address !== 'string' || typeof place.page_url !== 'string') continue;
    const zip = place.address.match(/\b(\d{5})\s*$/)?.[1] ?? '';
    const city = nycBorough(zip);
    if (city)
      buildings.set(ORIGIN + place.page_url, {
        address: place.address.split(',')[0].trim(),
        zip,
        city,
        latitude: place.lat,
        longitude: place.lon,
      });
  }
  return buildings;
}

export function relatedListing(card: RelatedCard, buildings: Map<string, RelatedBuilding>, checkedAt: string) {
  const building = buildings.get(card.building);
  if (!building) return null;
  return normalizeListing(
    {
      id: card.id,
      url: card.url,
      address: building.address,
      unit: '',
      city: building.city,
      state: 'NY',
      region: 'nyc',
      zipCode: building.zip,
      latitude: building.latitude,
      longitude: building.longitude,
      // Related counts an alcove studio as half a bedroom and a flex one-bedroom as one and a half.
      bedrooms: Math.floor(card.bedrooms),
      bathrooms: Number.isFinite(card.bathrooms) ? card.bathrooms : undefined,
      rent: card.rent,
      company: 'Related Rentals',
      status: 'Active',
      updatedAt: checkedAt,
    },
    SOURCE,
  );
}

const listingsOf = (cards: RelatedCard[], buildings: Map<string, RelatedBuilding>, checkedAt: string) =>
  cards.map((card) => relatedListing(card, buildings, checkedAt)).filter((listing) => listing !== null);

/** The first search page, one building page for addresses, then the remaining search pages a second apart. */
export async function loadRelated(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const first = parseRelatedSearch(await fetchPublicHtml(fetcher, relatedSearchUrl(0), 'Related', 15_000));
  if (!first.cards.length) throw new Error('Related listed no New York City apartments.');
  const buildings = parseRelatedBuildings(await fetchPublicHtml(fetcher, first.cards[0].building, 'Related', 15_000));
  const listings = listingsOf(first.cards, buildings, checkedAt);
  if (first.lastPage === 0) return { listings: deduplicatePublicRentals(listings), pages: 2 };
  const pages = Array.from({ length: first.lastPage }, (_, index) => ({ url: relatedSearchUrl(index + 1) }));
  const rest = await loadPublicPages(
    SOURCE,
    pages,
    (html) => listingsOf(parseRelatedSearch(html).cards, buildings, checkedAt),
    fetcher,
    now,
    {
      concurrency: 1,
      intervalMs: 1000,
      timeoutMs: 15_000,
    },
  );
  return {
    ...rest,
    listings: deduplicatePublicRentals([...listings, ...rest.listings]),
    pages: rest.pages + 2,
    ...(rest.partial ? { requestedPages: rest.requestedPages! + 2 } : {}),
  };
}

export const RELATED_LIVE = {
  ...SOURCE,
  id: 'related-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in Related’s New York City buildings, from the landlord’s own apartment search',
  regions: ['nyc'],
  minPages: 2,
  maxPages: MAX_SEARCH_PAGES + 1,
  rowsPerPage: 12,
  listingUrl: relatedListingUrl,
  load: loadRelated,
};
