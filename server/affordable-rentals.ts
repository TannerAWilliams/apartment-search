import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { searchBorough } from '../src/regions.ts';
import { geocodeRentalAddresses } from './geocode-rentals.ts';
import { loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'affordablehousing', name: 'AffordableHousing.com', kind: 'feed' };
const ORIGIN = 'https://www.affordablehousing.com';
const PAGES = [
  ['new-york-ny', 'Manhattan'],
  ['brooklyn-ny', 'Brooklyn'],
].flatMap(([slug, city]) => ['', 'page-2/'].map((page) => ({
  url: `${ORIGIN}/${slug}/${page}`, city, state: 'NY', region: 'nyc',
})));
const listingUrl = (url) => publicListingUrl(url, ORIGIN, /^\/[a-z\d-]+\/[a-z\d-]+-\d+\/?$/i);

export const AFFORDABLE_LIVE = {
  ...SOURCE, id: 'affordablehousing-live', marketplace: SOURCE.id, coverage: 'Manhattan and Brooklyn',
  regions: ['nyc'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 50,
  listingUrl, load: loadAffordableRentals,
};

export function parseAffordableRentals(html, market, checkedAt) {
  const cards = [...html.matchAll(/<article\b[^>]*\bdata-listing-card-type=["'][^"']+["'][^>]*>[\s\S]*?<\/article>/gi)];
  if (!cards.length) throw new Error('AffordableHousing.com did not return a recognized rental page.');
  return cards.flatMap(([card]) => {
    if (!/<span\b[^>]*\bclass=["']green--text["'][^>]*>\s*<em><\/em>\s*Available Now\s*<\/span>/i.test(card) ||
        !/\bclass=["']details-category["'][^>]*>\s*Apartment\s*<\/span>/i.test(card)) return [];

    const link = card.match(/<a\b[^>]*\bdata-track=["']listing-card-link["'][^>]*\bhref=["']([^"']+)["']/i);
    const url = listingUrl(link?.[1]);
    const location = card.match(/\bclass=["']tnresult--propertyaddress["'][^>]*>\s*([^<]+)<\/div>/i)?.[1]
      ?.replaceAll('&amp;', '&').trim().match(/^(\d.+),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})$/);
    const price = card.match(/\bclass=["'][^"']*card--price["'][^>]*>\s*\$([\d,]+)\s*</i)?.[1];
    const size = card.match(/card--details["'][^>]*>\s*<span>\s*(?:(\d+)\s*<span\b[^>]*>\s*beds?\s*<\/span>|Studio\s*<\/span>)/i);
    if (!url || !location || !price || !size ||
        location[3] !== market.state || searchBorough({ state: location[3], zip: location[4] }) !== market.city.toLowerCase()) return [];

    const [address, unit = ''] = location[1].split(/,\s*/, 2);
    const listing = normalizeListing({
      id: url.match(/-(\d+)\/?$/)?.[1], url, address, unit, city: market.city, state: market.state,
      region: market.region, zipCode: location[4], bedrooms: Number(size[1] ?? 0), rent: Number(price.replaceAll(',', '')),
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [{ ...listing, priceIncludesFees: /card--tmlp--text["'][^>]*><div>\s*Total Monthly Price/i.test(card) }] : [];
  });
}

async function loadAffordableRentals(fetcher: FetchTransport = fetch, now = new Date()) {
  const sample = await loadPublicPages(SOURCE, PAGES, parseAffordableRentals, fetcher, now);
  const listings = await geocodeRentalAddresses(sample.listings, fetcher).catch(() => sample.listings);
  return { ...sample, listings };
}
