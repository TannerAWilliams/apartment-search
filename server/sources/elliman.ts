/**
 * Douglas Elliman rentals (elliman.com/rentals/<place>). Its robots.txt allows the rental search pages (only filter
 * and sort parameters are disallowed). A search page carries its first 18 listings in the page's React Server
 * Components data; later pages and other orders come from a separate API host (core.api.elliman.com), which is not
 * read. So a sync reads the first page of each borough and of 30 busy neighborhoods, one page a second. In the
 * site's default order (Elliman's own listings first, most expensive first) that favors the high end of the market.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { assignedJson, CRAWLER_USER_AGENT, loadPublicPages, publicListingUrl } from './public-rentals.ts';
import { streetAndUnit } from './serhant.ts';

const SOURCE = { id: 'elliman', name: 'Douglas Elliman', kind: 'feed' };
const ORIGIN = 'https://www.elliman.com';
/** The five boroughs, then neighborhoods, as named in the site's rental sitemap. */
const PLACES = [
  'new-york-ny',
  'brooklyn-ny',
  'queens-ny',
  'the-bronx-ny',
  'staten-island-ny',
  ...[
    'upper-east-side',
    'upper-west-side',
    'chelsea',
    'greenwich-village',
    'east-village',
    'soho',
    'tribeca',
    'financial-district',
    'battery-park-city',
    'murray-hill',
    'gramercy',
    'the-flatiron-district',
    'lower-east-side',
    'central-harlem',
    'hell-s-kitchen',
    'kips-bay',
    'midtown-east',
    'washington-heights',
  ].map((name) => `${name}-new-york-ny`),
  ...['williamsburg', 'greenpoint', 'park-slope', 'brooklyn-heights', 'dumbo', 'bedford-stuyvesant', 'crown-heights', 'fort-greene'].map(
    (name) => `${name}-brooklyn-ny`,
  ),
  ...['long-island-city', 'astoria', 'forest-hills'].map((name) => `${name}-queens-ny`),
  'riverdale-the-bronx-ny',
];
const PAGES = PLACES.map((place) => ({ url: `${ORIGIN}/rentals/${place}` }));
const LISTING_PATH = /^\/listing\/[a-z0-9-]+\/(\d+)$/;
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, LISTING_PATH);
/** Home types that are not homes to rent. */
const NOT_HOMES = /commercial|land|lot|parking|office|retail|industrial/i;

export const ELLIMAN_LIVE = {
  ...SOURCE,
  id: 'elliman-live',
  marketplace: SOURCE.id,
  coverage: `first page (18 listings) of the rental search for each NYC borough and ${PLACES.length - 5} neighborhoods`,
  regions: ['nyc'],
  minPages: PAGES.length,
  maxPages: PAGES.length,
  rowsPerPage: 18,
  listingUrl,
  load: (fetcher: FetchTransport, now: Date) =>
    loadPublicPages(SOURCE, PAGES, parseEllimanSearch, fetcher, now, {
      concurrency: 1,
      intervalMs: 1000,
      userAgent: CRAWLER_USER_AGENT,
      timeoutMs: 20_000,
    }),
};

type Address = {
  isRestricted?: unknown;
  postalCode?: unknown;
  unitNumber?: unknown;
  streetName?: unknown;
  streetNumber?: unknown;
  stateOrProvince?: unknown;
  samlsFullAddress?: unknown;
};
type Listing = {
  coreListingId?: unknown;
  isPrivate?: unknown;
  listingType?: unknown;
  listingStatus?: unknown;
  homeType?: unknown;
  listPrice?: unknown;
  rentalPrices?: unknown;
  bedroomsTotal?: unknown;
  bathroomsFull?: unknown;
  bathroomsHalf?: unknown;
  livingAreaSquareFeet?: unknown;
  latLng?: { lat?: unknown; lng?: unknown } | null;
  address?: Address | null;
};

/** The page's React Server Components data, joined back into one string. */
function flightData(html: string) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)].map(([, text]) => JSON.parse(text) as string).join('');
}

/** The street, unit and ZIP code, from the structured fields when present or else the one-line address. */
function placeOf(address: Address) {
  if (typeof address.streetNumber === 'string' && typeof address.streetName === 'string' && typeof address.postalCode === 'string') {
    const { street, unit } = streetAndUnit(`${address.streetNumber} ${address.streetName}`, address.unitNumber);
    return { street, unit, zip: address.postalCode.trim() };
  }
  // "20 E 76TH ST PH1, New York, NY 10021"; some name a neighborhood ("…, Bay Rdg, Brooklyn, NY 11228") or the
  // unit ("…, #4, Brooklyn, NY 11211") after the street.
  const parts = (typeof address.samlsFullAddress === 'string' ? address.samlsFullAddress : '').split(',').map((part) => part.trim());
  const zip = parts.length >= 3 ? parts.at(-1)?.match(/^NY (\d{5})(?:-\d{4})?$/)?.[1] : undefined;
  if (!zip) return null;
  const unit = parts.length > 3 && /^(?:#|apt\b|unit\b)/i.test(parts[1]) ? parts[1] : undefined;
  return { ...streetAndUnit(unit ? `${parts[0]} ${unit}` : parts[0]), zip };
}

export function parseEllimanSearch(html: string, _page: unknown, checkedAt: string) {
  const data = flightData(html);
  // The page holds the search more than once; the copy with the listings is the one rendered.
  const results = [...data.matchAll(/"initialListingsData":/g)].map(
    ({ index }) => assignedJson(data.slice(index), /"initialListingsData":/) as { listings?: unknown } | null,
  );
  const found = results.flatMap((result) => (Array.isArray(result?.listings) ? [result.listings as unknown[]] : []));
  if (!found.length) throw new Error('Douglas Elliman did not return a recognized rental search page.');
  const rows = found.flat();
  const links = new Map<string, string>();
  for (const [, path] of html.matchAll(/href="(\/listing\/[^"?#]+)"/g)) {
    const url = listingUrl(path);
    const id = url && new URL(url).pathname.match(LISTING_PATH)?.[1];
    if (url && id) links.set(id, url);
  }
  return (rows.filter(isRecord) as Listing[]).flatMap((row) => {
    const id = typeof row.coreListingId === 'number' ? String(row.coreListingId) : '';
    const url = links.get(id);
    const address = isRecord(row.address) ? (row.address as Address) : null;
    const place = address && address.isRestricted !== true && address.stateOrProvince === 'NY' ? placeOf(address) : null;
    const city = place ? nycBorough(place.zip) : null;
    if (
      !url ||
      !place ||
      !city ||
      row.isPrivate === true ||
      row.listingType !== 'Rental' ||
      row.listingStatus !== 'Active' ||
      (typeof row.homeType === 'string' && NOT_HOMES.test(row.homeType)) ||
      // Shops listed under a home type say so in the address ("100A 7TH Ave RETAIL").
      /\b(?:retail|store|commercial|office)\b/i.test(place.street)
    )
      return [];
    // A monthly rate when the listing gives its rates, or else its asking price, which is monthly for rentals.
    const rates = (Array.isArray(row.rentalPrices) ? row.rentalPrices : []).filter(isRecord);
    const rent = rates.length ? rates.find((rate) => rate.name === 'Monthly')?.value : row.listPrice;
    const half = typeof row.bathroomsHalf === 'number' ? row.bathroomsHalf : 0;
    const listing = normalizeListing(
      {
        id,
        url,
        address: place.street,
        unit: place.unit,
        city,
        state: 'NY',
        region: 'nyc',
        zipCode: place.zip,
        bedrooms: row.bedroomsTotal,
        rent,
        bathrooms: typeof row.bathroomsFull === 'number' ? row.bathroomsFull + half / 2 : undefined,
        squareFeet: row.livingAreaSquareFeet,
        latitude: row.latLng?.lat,
        longitude: row.latLng?.lng,
        status: 'Active',
        updatedAt: checkedAt,
      },
      SOURCE,
    );
    return listing ? [listing] : [];
  });
}
