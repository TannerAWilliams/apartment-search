/**
 * UDR: every available apartment in its New York City communities, from the landlord's own site. The New
 * York City page links each community's "Apartments & Pricing" page, which lists every available
 * apartment (number, size, rent, link) as schema.org data and gives the community's street address.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, jsonLd, loadPublicPages } from './public-rentals.ts';

const SOURCE = { id: 'udr', name: 'UDR', kind: 'feed' };
const ORIGIN = 'https://www.udr.com';
const CITY_PAGE = `${ORIGIN}/new-york-city-apartments/`;
const PRICING_PATH = /^\/new-york-city-apartments\/[a-z0-9-]+\/[a-z0-9-]+\/apartments-pricing\/$/;

export function udrListingUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const unit = url.searchParams.get('unitid');
    return url.origin === ORIGIN && PRICING_PATH.test(url.pathname) && unit && /^\d{1,12}$/.test(unit)
      ? `${ORIGIN}${url.pathname}?unitid=${unit}`
      : null;
  } catch {
    return null;
  }
}

/** The New York City communities' pricing pages, from the city page. */
export function parseUdrCommunities(html: string): { url: string }[] {
  const paths = [...html.matchAll(/href="(\/new-york-city-apartments\/[a-z0-9-]+\/[a-z0-9-]+\/apartments-pricing\/)"/g)].map(
    ([, path]) => path,
  );
  if (!paths.length) throw new Error('UDR did not return a recognized New York City page.');
  return [...new Set(paths)].map((path) => ({ url: ORIGIN + path }));
}

/** A pricing page's available apartments, one listing each. */
export function parseUdrPricing(html: string, _page: { url: string }, checkedAt: string) {
  const list = jsonLd(html).find((thing) => isRecord(thing) && thing['@type'] === 'ItemList' && Array.isArray(thing.itemListElement));
  const fullAddress = html.match(/"propertyAddress":"([^"]+)"/)?.[1];
  if (!list || !fullAddress) throw new Error('UDR did not return a recognized pricing page.');
  const zip = fullAddress.match(/\b(\d{5})$/)?.[1] ?? '';
  const city = nycBorough(zip);
  if (!city) return [];
  const address = fullAddress.split(',')[0].trim();
  return list
    .itemListElement!.map((element: unknown) => {
      const apartment = isRecord(element) && isRecord(element.item) ? element.item : null;
      const offer = isRecord(apartment?.offers) ? apartment.offers : {};
      // "Apartment 415", or in a community of several buildings "Apartment #775 - 07E" (building 775).
      const name = typeof apartment?.name === 'string' ? apartment.name.match(/^Apartment\s+(?:#(\w+)\s*-\s*)?(\S+)$/) : null;
      const unit = name ? (name[1] ? `${name[1]}-${name[2]}` : name[2]) : undefined;
      const url = udrListingUrl(apartment?.url);
      if (!apartment || !unit || !url || offer.availability !== 'https://schema.org/InStock') return null;
      return normalizeListing(
        {
          id: url.match(/\d+$/)![0],
          url,
          address,
          unit,
          city,
          state: 'NY',
          region: 'nyc',
          zipCode: zip,
          bedrooms: apartment.numberOfBedrooms,
          bathrooms: apartment.numberOfBathroomsTotal,
          squareFeet: isRecord(apartment.floorSize) ? apartment.floorSize.value : undefined,
          rent: offer.price,
          company: 'UDR',
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
    })
    .filter((listing) => listing !== null);
}

export async function loadUdr(fetcher: FetchTransport, now: Date) {
  const communities = parseUdrCommunities(await fetchPublicHtml(fetcher, CITY_PAGE, 'UDR', 15_000));
  // One community at a time, a second apart.
  const result = await loadPublicPages(SOURCE, communities, parseUdrPricing, fetcher, now, {
    concurrency: 1,
    intervalMs: 1000,
    timeoutMs: 15_000,
  });
  return { ...result, pages: result.pages + 1, ...(result.partial ? { requestedPages: result.requestedPages! + 1 } : {}) };
}

export const UDR_LIVE = {
  ...SOURCE,
  id: 'udr-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in UDR’s New York City communities, from the landlord’s own site',
  regions: ['nyc'],
  minPages: 2,
  maxPages: 20,
  rowsPerPage: 200,
  listingUrl: udrListingUrl,
  load: loadUdr,
};
