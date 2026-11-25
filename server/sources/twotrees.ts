/**
 * Two Trees: every available apartment in Two Trees' Brooklyn and Manhattan buildings, from the listings feed
 * twotreesny.com's own pages read (/api/nestio, which robots.txt allows and which needs no key). The feed
 * states how many residential listings it holds; unless that many are read, nothing is saved. Apartments
 * with an application pending, offices and stores are left out. Listings Nestio marks "private" (not sent to
 * other listing sites) are kept: twotreesny.com shows them to every visitor.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'twotrees', name: 'Two Trees', kind: 'feed' };
const ORIGIN = 'https://www.twotreesny.com';
const FEED = ORIGIN + '/api/nestio';
const MAX_FEED_BYTES = 8 * 1024 * 1024;
export const TWOTREES_TRANSPORT = 'twotrees-nestio-feed';

export function twoTreesListingUrl(value: unknown) {
  return publicListingUrl(value, ORIGIN, /^\/apartments\/[a-z0-9.-]{1,80}\/[a-z0-9-]{1,40}\/[A-Za-z0-9-]{1,20}$/);
}

/** The apartment's page on twotreesny.com, built the way the site's own app builds it. */
const pagePath = (street: string, layout: string, unit: string) =>
  `/apartments/${street.toLowerCase().replace('street', '').trim().replace(/ /g, '-')}/${layout
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/w\//g, 'with')}/${unit}`;

async function readFeed(fetcher: FetchTransport): Promise<unknown> {
  const response = await fetcher(FEED, {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.headers.get('cf-mitigated') === 'challenge') {
    throw Object.assign(new Error('Two Trees answered with a browser verification challenge (bot protection).'), { code: 'bot_challenge' });
  }
  if (!response.ok) throw new Error('Two Trees returned HTTP ' + response.status + '.');
  if (
    !response.headers.get('content-type')?.includes('application/json') ||
    Number(response.headers.get('content-length')) > MAX_FEED_BYTES
  )
    throw new Error('Two Trees did not return a recognized listings feed.');
  const text = await response.text();
  if (text.length > MAX_FEED_BYTES) throw new Error('Two Trees returned a listings feed that was too large.');
  return JSON.parse(text);
}

/** The residential listings in the feed. Throws unless it holds as many as it says it does. */
export function parseTwoTreesFeed(feed: unknown): Record<string, unknown>[] {
  const groups = isRecord(feed) && isRecord(feed.data) ? Object.values(feed.data) : [];
  const residential = groups.find((group) => isRecord(group) && group.label === 'residential');
  const data = isRecord(residential) && typeof residential.data === 'string' ? JSON.parse(residential.data) : null;
  if (!isRecord(data) || !Array.isArray(data.items) || !Number.isSafeInteger(data.total_items))
    throw new Error('Two Trees did not return a recognized listings feed.');
  if (data.items.length !== data.total_items)
    throw new Error(`Two Trees listed ${data.items.length} of the ${data.total_items} apartments it reported.`);
  return data.items.filter(isRecord);
}

/** One feed item as a listing, or null when it is not an available apartment for rent in the five boroughs. */
export function twoTreesListing(item: Record<string, unknown>, checkedAt: string) {
  const building = isRecord(item.building) ? item.building : {};
  const location = isRecord(building.location) ? building.location : {};
  const { street_address: street, unit_number: unit, layout } = item;
  const zip = typeof building.postal_code === 'string' ? building.postal_code : '';
  const city = nycBorough(zip);
  if (
    item.status !== 'Available' ||
    item.listing_type !== 'For Rent' ||
    item.property_type !== 'Residential' ||
    !Number.isSafeInteger(item.id) ||
    typeof street !== 'string' ||
    typeof unit !== 'string' ||
    typeof layout !== 'string' ||
    !city
  )
    return null;
  const url = twoTreesListingUrl(ORIGIN + pagePath(street, layout, unit));
  if (!url) return null;
  return normalizeListing(
    {
      id: String(item.id),
      url,
      address: street,
      unit,
      city,
      state: 'NY',
      region: 'nyc',
      zipCode: zip,
      neighborhood: isRecord(building.neighborhood) ? building.neighborhood.name : undefined,
      latitude: location.latitude,
      longitude: location.longitude,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms,
      squareFeet: item.square_footage,
      rent: Number(item.price),
      company: 'Two Trees',
      status: 'Active',
      updatedAt: checkedAt,
      // When Two Trees last put the unit on the market.
      listedAt: item.last_listed_at,
    },
    SOURCE,
  );
}

export async function loadTwoTrees(fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const items = parseTwoTreesFeed(await readFeed(fetcher));
  const listings = items.map((item) => twoTreesListing(item, checkedAt)).filter((listing) => listing !== null);
  return { listings, pages: 1, total: items.length, rawCount: items.length, transport: TWOTREES_TRANSPORT, checkedAt };
}

export const TWOTREES_LIVE = {
  ...SOURCE,
  id: 'twotrees-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in Two Trees’ buildings, from the listings feed its own site reads',
  regions: ['nyc'],
  minPages: 1,
  maxPages: 1,
  rowsPerPage: 500,
  listingUrl: twoTreesListingUrl,
  load: loadTwoTrees,
};
