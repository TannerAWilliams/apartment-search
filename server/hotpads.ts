import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { jsonLd, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'hotpads', name: 'HotPads', kind: 'feed' };
const ORIGIN = 'https://hotpads.com';
const MARKETS = [
  { city: 'New York', state: 'NY', region: 'nyc', slug: 'new-york-ny' },
  { city: 'Jersey City', state: 'NJ', region: 'nj', slug: 'jersey-city-nj' },
  { city: 'Stamford', state: 'CT', region: 'ct', slug: 'stamford-ct' },
];
const PAGES = MARKETS.map((market) => ({ ...market, url: `${ORIGIN}/${market.slug}/condos-for-rent` }));
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/[a-z0-9-]+\/[a-z0-9-]+\/pad\/?$/i);

export const HOTPADS_LIVE = {
  ...SOURCE,
  id: 'hotpads-live',
  marketplace: SOURCE.id,
  coverage: 'first condo-rental search page in New York, Jersey City and Stamford; exact apartment units only',
  regions: ['nyc', 'nj', 'ct'],
  minPages: PAGES.length,
  maxPages: PAGES.length,
  rowsPerPage: 50,
  listingUrl,
  load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, PAGES, parseHotpadsPage, fetcher, now),
};

export function parseHotpadsPage(html: string, market: { city: string; state: string; region: string }, checkedAt: string) {
  const list = jsonLd(html)
    .flatMap((schema) => schema?.['@graph'] ?? [])
    .find((schema) => schema?.['@type'] === 'ItemList');
  const entries = list?.itemListElement;
  if (!Array.isArray(entries)) throw new Error('HotPads did not return a recognized rental page.');
  return entries.flatMap(({ item }) => {
    const url = listingUrl(item?.url);
    const unit = item?.name?.match(/\s+#\s*([\w-]+)$/)?.[1];
    const address = item?.address;
    const offer = item?.offers;
    const rent =
      offer?.['@type'] === 'Offer'
        ? offer.price
        : offer?.['@type'] === 'AggregateOffer' && offer.lowPrice === offer.highPrice
          ? offer.lowPrice
          : null;
    if (
      !url ||
      !unit ||
      item['@type'] !== 'Apartment' ||
      address?.addressRegion !== market.state ||
      (market.state !== 'NY' && address?.addressLocality?.toLowerCase() !== market.city.toLowerCase()) ||
      !/^\d/.test(address?.streetAddress ?? '') ||
      !/^\d{5}$/.test(address?.postalCode ?? '') ||
      !rent ||
      !offer ||
      offer.priceCurrency !== 'USD' ||
      offer.availability !== 'https://schema.org/InStock' ||
      /\b(?:room for rent|shared|roommate)\b/i.test(item.name ?? '')
    )
      return [];
    const listing = normalizeListing(
      {
        id: url.slice(ORIGIN.length),
        url,
        address: address.streetAddress,
        unit,
        city: address.addressLocality,
        state: market.state,
        zip: address.postalCode,
        region: market.state === 'NY' ? undefined : market.region,
        bedrooms: item.numberOfBedrooms,
        rent,
        latitude: item.geo?.latitude,
        longitude: item.geo?.longitude,
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    return listing ? [listing] : [];
  });
}
