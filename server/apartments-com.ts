import type { FetchTransport } from '../src/fetch-type.ts';
import { normalizeListing } from '../src/listings.ts';
import { searchBorough } from '../src/regions.ts';
import { jsonLd, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'apartments', name: 'Apartments.com', kind: 'feed' };
const ORIGIN = 'https://www.apartments.com';
const PAGES = ['manhattan', 'brooklyn'].flatMap((borough) => [1, 2].flatMap((bedrooms) =>
  ['', '2/'].map((suffix) => ({ borough, bedrooms,
    url: ORIGIN + '/' + borough + '-ny/' + bedrooms + '-bedrooms/' + suffix }))));
const listingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, /^\/[a-z0-9-]+\/[a-z0-9]{7}\/$/i);

export const APARTMENTS_LIVE = {
  ...SOURCE, id: 'apartments-live', marketplace: SOURCE.id,
  coverage: 'the first two one- and two-bedroom search pages per borough',
  regions: ['nyc'], minPages: PAGES.length, maxPages: PAGES.length, rowsPerPage: 50,
  listingUrl, load: (fetcher: FetchTransport, now: Date) => loadPublicPages(SOURCE, PAGES, parseApartmentsPage, fetcher, now),
};

export function parseApartmentsPage(html: string, { borough, bedrooms }: {borough:string; bedrooms:number}, checkedAt: string) {
  const collection = jsonLd(html).flatMap((schema) => schema?.['@graph'] ?? [])
    .find((entry) => entry?.['@type'] === 'CollectionPage');
  const entries = collection?.mainEntity?.itemListElement;
  if (!Array.isArray(entries) || !entries.length) throw new Error('Apartments.com did not return a recognized rental page.');

  const advertisedBeds = new Map<string, unknown>();
  for (const [, id, lines] of html.matchAll(/data-listing-key="([a-z0-9]{7})"[^>]*?data-listing-share-lines='([^']*)'/gi)) {
    try { const share = JSON.parse(lines); advertisedBeds.set(id, Array.isArray(share) ? share[5] : undefined); }
    catch { /* Skip cards with malformed share data. */ }
  }
  return entries.flatMap(({ item }) => {
    const url = listingUrl(item?.url);
    const id = url?.split('/').at(-2) ?? '';
    const unit = item?.name?.match(/\s+(?:Unit\s+|#\s*)([^,]+)$/i)?.[1]?.trim();
    const { streetAddress, addressRegion, postalCode } = item?.mainEntity?.address ?? {};
    const { latitude, longitude } = item?.mainEntity?.geo ?? {};
    const offer = item?.offers;
    if (!item || !url || !unit || !addressRegion || advertisedBeds.get(id) !== bedrooms + ' bd' ||
        item.potentialAction?.['@type'] !== 'RentAction' || offer?.['@type'] !== 'Offer' ||
        offer.availability !== 'https://schema.org/InStock' || offer.priceCurrency !== 'USD' ||
        !/^\d/.test(streetAddress ?? '') || !/^\d{5}$/.test(postalCode ?? '') ||
        searchBorough({ state: addressRegion, zip: postalCode }) !== borough ||
        /\b(?:room for rent|private room|roommate|shared apartment|co-?living)\b/i.test(item.name + ' ' + (item.description ?? ''))) return [];

    const listing = normalizeListing({
      id, url, address: streetAddress, unit, city: borough === 'brooklyn' ? 'Brooklyn' : 'Manhattan',
      state: 'NY', zipCode: postalCode, latitude, longitude, bedrooms, rent: offer.price,
      status: 'Active', updatedAt: checkedAt,
    }, SOURCE);
    return listing ? [listing] : [];
  });
}
