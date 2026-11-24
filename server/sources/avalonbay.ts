/**
 * AvalonBay: every available apartment in its New York City (five boroughs) communities, from the landlord's
 * own site. The New York page lists AvalonBay's communities (and Equity communities it links out to, which
 * are not AvalonBay listings and are left out); each AvalonBay community page embeds its available units.
 * Both are read from the page data the site's own pages carry (Fusion.globalContent); robots.txt allows them.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { assignedJson, fetchPublicHtml, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'avalonbay', name: 'AvalonBay', kind: 'feed' };
const ORIGIN = 'https://www.avaloncommunities.com';
const STATE_PAGE = `${ORIGIN}/new-york/`;
const COMMUNITY_PATH = /^\/new-york\/[a-z0-9-]+-apartments\/[a-z0-9-]+\/?$/;
const UNIT_PATH = /^\/new-york\/[a-z0-9-]+-apartments\/[a-z0-9-]+\/apartment\/[A-Za-z0-9-]+$/;
const GLOBAL_CONTENT = /Fusion\.globalContent\s*=\s*/;

export const avalonbayListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, UNIT_PATH);

function pageData(html: string, what: string) {
  const data = assignedJson(html, GLOBAL_CONTENT);
  if (!isRecord(data)) throw new Error(`AvalonBay did not return a recognized ${what} page.`);
  return data;
}

/** The AvalonBay community pages in the five boroughs, from the New York page. */
export function parseAvalonCommunities(html: string): { url: string }[] {
  const data = pageData(html, 'New York');
  const results = data.communityResults;
  const items = isRecord(results) && isRecord(results.communities) ? results.communities.items : null;
  if (!Array.isArray(items)) throw new Error('AvalonBay did not list its New York communities.');
  const pages = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.url !== 'string' || !COMMUNITY_PATH.test(item.url)) continue;
    const zip = isRecord(item.address) ? item.address.zip : null;
    if (typeof zip === 'string' && nycBorough(zip)) pages.add(ORIGIN + item.url.replace(/\/?$/, '/'));
  }
  return [...pages].map((url) => ({ url }));
}

/** A unit's address without its apartment number ("11 East First St. Apt #406", "4-75 48th Avenue 405"). */
export function streetAddress(address: string, unit: string) {
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return address.replace(new RegExp(`\\s*(?:(?:apartment|apt\\.?|unit)\\s*)?#?\\s*${escaped}$`, 'i'), '').trim();
}

/** The available units a community page embeds, one listing each. */
export function parseAvalonCommunity(html: string, _page: { url: string }, checkedAt: string) {
  const data = pageData(html, 'community');
  if (!Array.isArray(data.units)) throw new Error('AvalonBay did not list a community’s apartments.');
  const totalPrice = data.useTotalPrice === true;
  return data.units
    .map((unit) => {
      if (!isRecord(unit) || typeof unit.unitStatus !== 'string' || !/Available$/.test(unit.unitStatus)) return null;
      const address = isRecord(unit.address) ? unit.address : {};
      const zip = typeof address.zip === 'string' ? address.zip : '';
      const borough = nycBorough(zip);
      if (!borough || typeof address.addressLine1 !== 'string' || typeof unit.unitName !== 'string') return null;
      const offer = isRecord(unit.startingAtPricesUnfurnished) ? unit.startingAtPricesUnfurnished : {};
      const prices = isRecord(offer.prices) ? offer.prices : {};
      return normalizeListing(
        {
          id: unit.unitId,
          url: avalonbayListingUrl(unit.url),
          address: streetAddress(address.addressLine1, unit.unitName),
          unit: unit.unitName,
          city: borough,
          state: 'NY',
          region: 'nyc',
          zipCode: zip,
          latitude: isRecord(data.coordinates) ? data.coordinates.latitude : undefined,
          longitude: isRecord(data.coordinates) ? data.coordinates.longitude : undefined,
          bedrooms: unit.bedroomNumber,
          bathrooms: unit.bathroomNumber,
          squareFeet: unit.squareFeet,
          rent: totalPrice ? prices.totalPrice : prices.price,
          company: 'AvalonBay',
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
    })
    .filter((listing) => listing !== null)
    .filter((listing) => listing.sources[0]?.url);
}

export async function loadAvalonBay(fetcher: FetchTransport, now: Date) {
  const communities = parseAvalonCommunities(await fetchPublicHtml(fetcher, STATE_PAGE, 'AvalonBay', 15_000));
  if (!communities.length) throw new Error('AvalonBay listed no New York City communities.');
  // One community page at a time, a second apart.
  const result = await loadPublicPages(SOURCE, communities, parseAvalonCommunity, fetcher, now, {
    concurrency: 1,
    intervalMs: 1000,
    timeoutMs: 15_000,
  });
  return { ...result, pages: result.pages + 1, ...(result.partial ? { requestedPages: result.requestedPages! + 1 } : {}) };
}

export const AVALONBAY_LIVE = {
  ...SOURCE,
  id: 'avalonbay-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in AvalonBay’s New York City communities, from the landlord’s own site',
  regions: ['nyc'],
  minPages: 2,
  maxPages: 30,
  rowsPerPage: 150,
  listingUrl: avalonbayListingUrl,
  load: loadAvalonBay,
};
