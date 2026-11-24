/**
 * Rockrose: every market-rate apartment on the landlord's own availabilities page at rockrose.com. The page
 * lists all of them at once (it has no pages) as cards giving the street address, ZIP code, unit, size and
 * advertised rent; it publishes no separate total, so every card must be fully described or nothing is saved.
 * Some rents are net effective (after the advertised free months), as Rockrose shows them. Sizes the page
 * names without a bedroom count ("Flex 2", "Loft") are left out. Affordable lotteries, on their own page,
 * are not read.
 */
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'rockrose', name: 'Rockrose', kind: 'feed' };
const ORIGIN = 'https://rockrose.com';
export const ROCKROSE_TRANSPORT = 'rockrose-availabilities-page';

export function rockroseListingUrl(value: unknown) {
  return publicListingUrl(value, ORIGIN, /^\/listing\/[a-z0-9-]{1,80}\/$/);
}

export type RockroseCard = {
  id: string;
  url: string;
  address: string;
  zip: string;
  unit: string;
  size: string;
  rent: number;
  latitude: number;
  longitude: number;
};

const attribute = (card: string, name: string) => card.match(new RegExp(`data-${name}='([^']*)'`))?.[1];
const plain = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#0?38;|&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The apartment cards on the availabilities page. Throws when it holds none or one is not fully described. */
export function parseRockroseAvailabilities(html: string): RockroseCard[] {
  const start = html.indexOf("id='availabilities-grid'");
  const end = html.indexOf('</ul>\n</section>', start);
  if (start < 0 || end < 0) throw new Error('Rockrose did not return a recognized availabilities page.');
  const cards = html.slice(start, end).split("<li class='col-xs-12").slice(1);
  if (!cards.length) throw new Error('Rockrose did not list any apartments.');
  return cards.map((card) => {
    const id = attribute(card, 'id');
    const rent = Number(attribute(card, 'price'));
    const [place, unit] = [...card.matchAll(/<span class='address'>([\s\S]*?)<\/span>/g)].map(([, text]) => text);
    const [street, locality] = place?.split(/,\s*<br\s*\/?>/) ?? [];
    const zip = locality?.match(/\bNY (\d{5})$/)?.[1];
    const url = rockroseListingUrl(card.match(/href="([^"]+)" class="uppercase save-availabilities-order"/)?.[1]);
    const size = plain(card.match(/<li class='size'>([\s\S]*?)<\/li>/)?.[1] ?? '');
    if (!id || !/^\d+$/.test(id) || !Number.isFinite(rent) || !street || !zip || !unit?.startsWith('#') || !url || !size)
      throw new Error('Rockrose listed an apartment it did not fully describe.');
    return {
      id,
      url,
      address: plain(street),
      zip,
      unit: plain(unit.slice(1)),
      size,
      rent,
      latitude: Number(attribute(card, 'lat')),
      longitude: Number(attribute(card, 'lng')),
    };
  });
}

/** A card as a listing, or null when it is outside the five boroughs or its size gives no bedroom count. */
export function rockroseListing(card: RockroseCard, checkedAt: string) {
  const bedrooms = /^Studio\b/.test(card.size) ? 0 : Number(card.size.match(/^(\d) Bedroom\b/)?.[1] ?? NaN);
  const bathrooms = Number(card.size.match(/([\d.]+) Bath/)?.[1]);
  const city = nycBorough(card.zip);
  if (!city || !Number.isInteger(bedrooms)) return null;
  return normalizeListing(
    {
      id: card.id,
      url: card.url,
      address: card.address,
      unit: card.unit,
      city,
      state: 'NY',
      region: 'nyc',
      zipCode: card.zip,
      latitude: card.latitude,
      longitude: card.longitude,
      bedrooms,
      bathrooms: Number.isFinite(bathrooms) ? bathrooms : undefined,
      rent: card.rent,
      company: 'Rockrose',
      status: 'Active',
      updatedAt: checkedAt,
    },
    SOURCE,
  );
}

export async function loadRockrose(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const cards = parseRockroseAvailabilities(await fetchPublicHtml(fetcher, ORIGIN + '/availabilities/', 'Rockrose', 15_000));
  const listings = cards.map((card) => rockroseListing(card, checkedAt)).filter((listing) => listing !== null);
  return { listings, pages: 1, total: cards.length, rawCount: cards.length, transport: ROCKROSE_TRANSPORT, checkedAt };
}

export const ROCKROSE_LIVE = {
  ...SOURCE,
  id: 'rockrose-live',
  marketplace: SOURCE.id,
  coverage:
    'every market-rate apartment on Rockrose’s own availabilities page (it lists all of them on one page and gives no separate total)',
  regions: ['nyc'],
  minPages: 1,
  maxPages: 1,
  rowsPerPage: 400,
  listingUrl: rockroseListingUrl,
  load: loadRockrose,
};
