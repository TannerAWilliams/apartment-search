/**
 * SERHANT. rentals (serhant.com/rent). The site runs on Luxury Presence: its rentals page reads the brokerage's
 * listings from the site's own GraphQL endpoint (/api-gw/graphql, which robots.txt allows; only /api/ is
 * disallowed), with no login or key. Keller Williams NYC (kwnyc.com) runs on the same platform, so the reader here
 * serves both. A sync asks for the company's New York rentals marked for lease, 100 at a time, newest first, and
 * keeps the available monthly rentals in the five boroughs with a published address.
 */
import { isRecord } from '../../src/domain.ts';
import type { ListingData } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { CRAWLER_USER_AGENT, deduplicatePublicRentals, publicListingUrl } from './public-rentals.ts';

/** The platform's "for lease" status, the one serhant.com's rentals page filters on (the same id on every site). */
const FOR_LEASE_STATUS_ID = '5f528253-abb7-484e-95c3-330269ac1105';
const PAGE_SIZE = 100;
/** Status names the platform shows for a rental that can still be leased. */
const AVAILABLE = new Set(['for lease', 'for rent', 'active']);

const QUERY = `query Properties($companyId: String, $leaseProperty: Boolean, $addressState: [String!], $propertyTypeIds: [String!], $advancedFilters: JSON, $offset: Int, $limit: Int, $sort: String, $sortDir: SortDirectionEnum) {
  properties(companyId: $companyId, leaseProperty: $leaseProperty, addressState: $addressState, propertyTypeIds: $propertyTypeIds, advancedFilters: $advancedFilters, offset: $offset, limit: $limit, sort: $sort, sortDir: $sortDir) {
    id slug status listDate priceUponRequest leaseProperty leasePrice leasePeriod privateAddress bedroomCount bathCount addressLine1 addressLine2 addressState postalCode livingSpaceSize livingSpaceUnits latitude longitude types { name }
  }
  propertiesCount(companyId: $companyId, leaseProperty: $leaseProperty, addressState: $addressState, propertyTypeIds: $propertyTypeIds, advancedFilters: $advancedFilters) { count }
}`;

/** Words a unit can be on its own: penthouses, townhouse floors and the like. */
const UNIT_WORDS = /^(?:PH[\w-]*|TH|GARDEN|GROUND|BASEMENT|PARLOR|DUPLEX|TRIPLEX|LOWER|UPPER|TOP)$/i;

/**
 * A street address and its unit. Feeds give the unit in a second line ("Unit: 5K", "#4", "Apartment 10C"), after a
 * marker ("…Dr Unit: PH", "…Avenue, #2b") or, as REBNY listings do, as the last word ("63 W 107TH Street 33",
 * "125 BERGEN Street APT1B", "16 W 122ND Street GARDEN"). A second line that is not a unit ("3rd and 4th floors",
 * "Brooklyn") is left out.
 */
export function streetAndUnit(line1: string, line2?: unknown) {
  let street = line1.replace(/\s+/g, ' ').trim();
  const second = typeof line2 === 'string' ? line2.trim().replace(/^(?:apt|apartment|unit|suite)?[.:#\s]*/i, '') : '';
  let unit = /^[\w-]{1,10}$/.test(second) && (/\d/.test(second) || UNIT_WORDS.test(second)) ? second : '';
  const marked = street.match(/^(.+?)[,\s]+(?:(?:apt|apartment|unit|suite)\b[.:]?\s*|#\s*)([\w-]{1,10})$/i);
  const trailing = street.match(/^(\d[\w-]*\s+\S.*?)\s+(?:APT)?([\w-]{1,10})$/i);
  if (marked) {
    street = marked[1];
    unit ||= marked[2];
  } else if (trailing && (/\d/.test(trailing[2]) || UNIT_WORDS.test(trailing[2]))) {
    street = trailing[1];
    unit ||= trailing[2];
  }
  return { street: street.replace(/,$/, ''), unit: unit.toUpperCase() };
}

type Site = {
  source: { id: string; name: string; kind: string };
  origin: string;
  companyId: string;
  maxPages: number;
  /** The platform's residential property types, when the site's own rentals page filters on them. */
  propertyTypeIds?: string[];
};

type Property = {
  id?: unknown;
  listDate?: unknown;
  slug?: unknown;
  status?: unknown;
  priceUponRequest?: unknown;
  leaseProperty?: unknown;
  leasePrice?: unknown;
  leasePeriod?: unknown;
  privateAddress?: unknown;
  bedroomCount?: unknown;
  bathCount?: unknown;
  addressLine1?: unknown;
  addressLine2?: unknown;
  addressState?: unknown;
  postalCode?: unknown;
  livingSpaceSize?: unknown;
  livingSpaceUnits?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  types?: unknown;
};

/** One property from the platform as a listing, or null when it is not an available NYC apartment for rent. */
export function luxuryPresenceListing(site: Pick<Site, 'source' | 'origin'>, property: unknown, checkedAt: string): ListingData | null {
  if (!isRecord(property)) return null;
  const row = property as Property;
  const url = publicListingUrl(typeof row.slug === 'string' ? `/properties/${row.slug}` : null, site.origin, /^\/properties\/[\w-]+$/);
  const zip = typeof row.postalCode === 'string' ? row.postalCode.trim() : '';
  const city = nycBorough(zip);
  const types = (Array.isArray(row.types) ? row.types : []).map((type) =>
    isRecord(type) && typeof type.name === 'string' ? type.name : '',
  );
  if (
    !url ||
    !city ||
    typeof row.id !== 'string' ||
    typeof row.status !== 'string' ||
    !AVAILABLE.has(row.status.trim().toLowerCase()) ||
    row.leaseProperty !== true ||
    row.leasePeriod !== 'MONTH' ||
    row.priceUponRequest === true ||
    row.privateAddress === true ||
    row.addressState !== 'NY' ||
    typeof row.addressLine1 !== 'string' ||
    types.some((type) => /commercial|land|parking|office|retail/i.test(type))
  )
    return null;
  const { street, unit } = streetAndUnit(row.addressLine1, row.addressLine2);
  const size = typeof row.livingSpaceSize === 'string' || typeof row.livingSpaceSize === 'number' ? Number(row.livingSpaceSize) : NaN;
  return normalizeListing(
    {
      id: row.id,
      url,
      address: street,
      unit,
      city,
      state: 'NY',
      region: 'nyc',
      zipCode: zip,
      bedrooms: row.bedroomCount,
      rent: row.leasePrice,
      bathrooms: typeof row.bathCount === 'number' && row.bathCount > 0 ? row.bathCount : undefined,
      // Some listings carry placeholder sizes such as 100 square feet for a two-bedroom.
      squareFeet: row.livingSpaceUnits === 'SQUARE_FEET' && size >= 200 ? size : undefined,
      latitude: row.latitude,
      longitude: row.longitude,
      status: 'Active',
      updatedAt: checkedAt,
      // The brokerage's own listing date.
      listedAt: row.listDate,
    },
    site.source,
  );
}

async function readProperties(fetcher: FetchTransport, site: Site, offset: number) {
  const response = await fetcher(`${site.origin}/api-gw/graphql`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': CRAWLER_USER_AGENT },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        companyId: site.companyId,
        leaseProperty: true,
        addressState: ['NY'],
        ...(site.propertyTypeIds ? { propertyTypeIds: site.propertyTypeIds } : {}),
        advancedFilters: { query: { statusIds: { in: [FOR_LEASE_STATUS_ID] } } },
        offset,
        limit: PAGE_SIZE,
        sort: 'createdAt',
        sortDir: 'DESC',
      },
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.headers.get('cf-mitigated') === 'challenge')
    throw Object.assign(new Error(site.source.name + ' answered with a browser verification challenge (bot protection).'), {
      code: 'bot_challenge',
    });
  if (!response.ok) throw new Error(site.source.name + ' returned HTTP ' + response.status + '.');
  const body: unknown = await response.json();
  const data = isRecord(body) && isRecord(body.data) ? body.data : {};
  const count = isRecord(data.propertiesCount) ? data.propertiesCount.count : null;
  if (!Array.isArray(data.properties) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    throw new Error(site.source.name + ' did not return a recognized rental list.');
  return { properties: data.properties as unknown[], count };
}

/** The company's New York rentals, newest first, up to the site's page limit, one request a second. */
export async function loadLuxuryPresenceRentals(site: Site, fetcher: FetchTransport, now: Date) {
  const checkedAt = now.toISOString();
  const first = await readProperties(fetcher, site, 0);
  const requestedPages = Math.min(site.maxPages, Math.max(1, Math.ceil(first.count / PAGE_SIZE)));
  const properties = [...first.properties];
  let pages = 1;
  try {
    for (; pages < requestedPages; pages++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      properties.push(...(await readProperties(fetcher, site, pages * PAGE_SIZE)).properties);
    }
  } catch {
    // A later page that fails leaves a partial sync of the pages read.
  }
  const listings = deduplicatePublicRentals(
    properties.map((property) => luxuryPresenceListing(site, property, checkedAt)).filter((listing) => listing !== null),
  );
  if (!listings.length) throw new Error(site.source.name + ' returned no supported apartment listings.');
  return {
    listings,
    pages,
    ...(pages < requestedPages ? { partial: true, requestedPages, failedPages: requestedPages - pages } : {}),
  };
}

/** A Luxury Presence brokerage site as a live source. */
export function luxuryPresenceSource(site: Site, coverage: string) {
  return {
    ...site.source,
    id: `${site.source.id}-live`,
    marketplace: site.source.id,
    coverage,
    regions: ['nyc'],
    minPages: 1,
    maxPages: site.maxPages,
    rowsPerPage: PAGE_SIZE,
    listingUrl: (url: unknown) => publicListingUrl(url, site.origin, /^\/properties\/[\w-]+$/),
    load: (fetcher: FetchTransport, now: Date) => loadLuxuryPresenceRentals(site, fetcher, now),
  };
}

const SOURCE = { id: 'serhant', name: 'SERHANT.', kind: 'feed' };

// About 120 New York residential rentals in November 2026, so two pages; the cap leaves room to grow.
export const SERHANT_LIVE = luxuryPresenceSource(
  {
    source: SOURCE,
    origin: 'https://serhant.com',
    companyId: 'b26ab618-2b1e-4a17-8868-498b96b52dc0',
    maxPages: 5,
    // The residential types serhant.com/rent asks for; without them the feed also lists shops and offices.
    propertyTypeIds: [
      'c68279bc-2904-4ab8-9e84-42ecf6af008c',
      '9a70fec3-5946-4d04-9acb-74d98781f636',
      '9ac67b4b-bf76-4e0d-999e-701908f8f9ab',
      'dea9daeb-4eb9-4bd8-8380-1a5c9384e817',
      'daf8aaa2-8b6f-4f2d-a324-754e0316d2b6',
      'c5a58e1c-ca87-4546-b7f8-9330fb90badd',
    ],
  },
  'every New York rental on serhant.com, from the site’s own listings feed; the five boroughs’ monthly apartment rentals are kept',
);
