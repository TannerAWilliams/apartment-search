/**
 * MNS: every rental on MNS's own rentals page (mns.com/mns_listings/rent), which lists all of them on one
 * page. Each listing card carries the building's street address, ZIP code, bedrooms, baths, size and rent.
 * robots.txt disallows nothing.
 */
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'mns', name: 'MNS', kind: 'feed' };
const ORIGIN = 'https://www.mns.com';
const RENTALS = ORIGIN + '/mns_listings/rent';
// About 200 rentals in November 2026.
const MAX_ROWS = 1000;

export const mnsListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/details\/\d+\/rental\/[\w+.%'-]+\/[\w+.%'-]+$/);

const decode = (text: string) =>
  text
    .replace(/&#0*39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** The rentals on MNS's rentals page. Throws when the page is not recognizable. */
export function parseMnsRentals(html: string, _page: unknown, checkedAt: string) {
  if (!html.includes('listings_card')) throw new Error('MNS did not return a recognized rentals page.');
  return html
    .split('<div class="listings_card" ')
    .slice(1)
    .flatMap((card) => {
      const tag = card.slice(0, card.indexOf('>'));
      const attribute = (name: string) => decode(tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1] ?? '');
      const street = attribute('data-address');
      // "whole" ends with the ZIP code and the street address: "Hudson Tower Battery Park City New York 10280 350 Albany ST".
      const zip = attribute('whole').match(/(\d{5}) (.+)$/);
      const city = zip && zip[2] === street ? nycBorough(zip[1]) : null;
      const url = mnsListingUrl(card.match(/<a href="([^"]+)"/)?.[1]);
      const id = attribute('id');
      if (!city || !url || !/^\d+$/.test(id) || !/^\d/.test(street)) return [];
      // The second heading is "350 Albany ST, 15F".
      const heading = decode(card.match(/<h3>[^<]*<\/h3>\s*<h3>([^<]*)<\/h3>/)?.[1] ?? '');
      const unit = heading.startsWith(street + ', ') ? heading.slice(street.length + 2) : '';
      const bedrooms = Number(attribute('bed'));
      const listing = normalizeListing(
        {
          id,
          url,
          address: street,
          unit,
          city,
          state: 'NY',
          region: 'nyc',
          zipCode: zip![1],
          // A "1.5 bedroom" is a one-bedroom with a small extra room.
          bedrooms: Math.floor(bedrooms),
          bathrooms: Number(attribute('bath')) || undefined,
          squareFeet: Number(attribute('sq')) || undefined,
          rent: Number(attribute('price')),
          neighborhood: attribute('data-hood'),
          company: 'MNS',
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
      return listing ? [listing] : [];
    });
}

export const MNS_LIVE = {
  ...SOURCE,
  id: 'mns-live',
  marketplace: SOURCE.id,
  coverage: 'every rental on MNS’s own rentals page (it lists all of them on one page)',
  regions: ['nyc'],
  minPages: 1,
  maxPages: 1,
  rowsPerPage: MAX_ROWS,
  listingUrl: mnsListingUrl,
  // The page is about 1 MB.
  load: (fetcher: FetchTransport, now: Date) =>
    loadPublicPages(SOURCE, [{ url: RENTALS }], parseMnsRentals, fetcher, now, { timeoutMs: 20_000 }),
};
