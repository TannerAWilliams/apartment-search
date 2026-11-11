import { normalizeListing } from '../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'renthop', name: 'RentHop', kind: 'feed' };
const ORIGIN = 'https://www.renthop.com';
const SEARCH = ORIGIN + '/apartments-for-rent/new-york-ny?sort=price&max_price=';
const PAGES = [2200, 2800].map((budget) => ({ url: SEARCH + budget, budget }));
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/listings\/(?:[^/]+\/){1,2}\d+\/?$/);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replaceAll('&amp;', '&').replaceAll('&#39;', "'")
  .replaceAll('&nbsp;', ' ').replace(/\s+/g, ' ').trim();

export const RENTHOP_LIVE = {
  ...SOURCE, id: 'renthop-live', marketplace: SOURCE.id, coverage: 'NYC low-price searches',
  regions: ['nyc'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 30,
  listingUrl, load: (fetcher, now) => loadPublicPages(SOURCE, PAGES, parseRentHopPage, fetcher, now),
};

export function parseRentHopPage(html, { budget }, checkedAt) {
  const cards = [...html.matchAll(/<div\b[^>]*\bid=["']listing-(\d+)["'][^>]*>[\s\S]*?(?=<div\b[^>]*\bid=["']listing-\1-padding["'])/g)];
  if (!cards.length) throw new Error('RentHop did not return a recognized rental page.');
  return cards.flatMap(([card, id]) => {
    const title = card.match(/<a\b[^>]*\bid=["']listing-\d+-title["'][^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const url = listingUrl(title?.[1]);
    const address = title && text(title[2]).replace(/,\s*(?=(?:apt\.?|unit)\s)/i, ' ');
    const place = card.match(/\bid=["']listing-\d+-neighborhoods["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*>\s*(\d{5})\s*<\/div>/i);
    const city = nycBorough(place?.[2] ?? '');
    const monthly = card.match(/\bid=["']listing-\d+-price["'][^>]*>\s*\$([\d,]+)\s*<\/div>/i);
    const size = card.match(/<img\b[^>]*\balt=["']bedrooms["'][^>]*>\s*<\/div>\s*<div\b[^>]*>\s*(?:Studio|(\d+) Beds?)(?:\s*\/\s*Flex\s+\d+)?\s*<\/div>/i);
    const coordinates = card.match(/\blatitude=["']([\d.]+)["']\s+longitude=["'](-[\d.]+)["']/i);
    if (!url || !address || !/^\d/.test(address) || /\b(?:room for rent|roommate|shared apartment)\b/i.test(address) ||
        !city || !monthly || !size || !coordinates) return [];
    const rent = Number(monthly[1].replaceAll(',', ''));
    if (rent > budget) return [];

    const listing = normalizeListing({
      id, url, address, city, state: 'NY', region: 'nyc', zipCode: place[2],
      neighborhood: text(place[1]).split(',')[0], latitude: Number(coordinates[1]), longitude: Number(coordinates[2]),
      bedrooms: Number(size[1] ?? 0), rent,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
