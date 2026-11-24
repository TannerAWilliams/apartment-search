/**
 * Apartment Guide's NYC search (apartmentguide.com, part of Rent.; rent.com shows the same buildings). Its robots.txt
 * allows the city search pages read here. Each result is a building with floor plans and their asking rents, not
 * numbered units, so a building gives one listing per bedroom count, at the lowest rent it shows as available;
 * single rentals (under /rent/) give their own listing.
 */
import { isRecord } from '../../src/domain.ts';
import { normalizeListing } from '../../src/listings.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { nycBorough } from './firstmover.ts';
import { CRAWLER_USER_AGENT, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'apartmentguide', name: 'Apartment Guide', kind: 'feed' };
const ORIGIN = 'https://www.apartmentguide.com';
const SEARCH = ORIGIN + '/apartments/New-York/New-York/';
// About 84 pages of 50 buildings in November 2026. The site limits how much it is read: after about 35 pages in
// a row it answers with a bot challenge. So a resync reads 30 pages (about 1,500 buildings), one at a time with a
// pause, and stops at the first challenge or rate limit.
const PAGE_COUNT = 30;
const PAGES = Array.from({ length: PAGE_COUNT }, (_, index) => ({ url: SEARCH + (index ? `page-${index + 1}/` : '') }));
// Buildings are under /a/, and single rentals (often with a unit number in the address) under /rent/.
const listingUrl = (url: unknown) => publicListingUrl(url, ORIGIN, /^\/(?:a|rent)\/[A-Za-z0-9-]+-[A-Z]*\d+\/?$/);
/** Floor plans free now or within this many days are kept, as for Apartment List. */
const AVAILABLE_WITHIN_DAYS = 60;

export const APARTMENTGUIDE_LIVE = {
  ...SOURCE,
  id: 'apartmentguide-live',
  marketplace: SOURCE.id,
  coverage: `NYC search, ${PAGE_COUNT} pages; one listing per building and bedroom count, at its lowest available rent`,
  regions: ['nyc'],
  minPages: PAGE_COUNT,
  maxPages: PAGE_COUNT,
  rowsPerPage: 300,
  listingUrl,
  load: (fetcher: FetchTransport, now: Date) =>
    loadPublicPages(SOURCE, PAGES, parseApartmentGuidePage, fetcher, now, {
      concurrency: 1,
      intervalMs: 1500,
      userAgent: CRAWLER_USER_AGENT,
      // Pages are about 1 MB, more than the usual 9 seconds allow on a slow connection.
      timeoutMs: 20_000,
    }),
};

type FloorPlan = {
  bedCount?: unknown;
  bathCount?: unknown;
  availabilityStatusCode?: unknown;
  availableDate?: unknown;
  priceRange?: { min?: unknown };
  sqFtRange?: { min?: unknown };
  units?: { rent?: unknown }[];
};
type Building = {
  id?: unknown;
  address?: unknown;
  urlPathname?: unknown;
  offMarket?: unknown;
  location?: { lat?: unknown; lng?: unknown; stateAbbr?: unknown; zip?: unknown };
  floorPlans?: unknown;
};

/**
 * A street address and the unit glued onto it, as Apartment Guide's single rentals write them: "524 Timpson Pl
 * unit #8a studio", "1363 E 40th Street ##2", "220 E 116th Street #2Nd Floor", "2971 Shell Rd unit #616".
 */
export function splitStreetUnit(raw: string) {
  const marker = raw.match(/\s+(?:(?:unit|apt\.?|apartment)\b|#)/i);
  if (marker?.index === undefined) return { street: raw.trim(), unit: '' };
  const unit = raw
    .slice(marker.index + marker[0].length)
    .replace(/#/g, ' ')
    .replace(/\bstudio\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return { street: raw.slice(0, marker.index).trim(), unit };
}

const dollars = (text: unknown) => (typeof text === 'string' && /^\$[\d,]+$/.test(text) ? Number(text.slice(1).replaceAll(',', '')) : NaN);

/** The lowest rent of a floor plan available now or within 60 days, or NaN when it shows none. */
function planRent(plan: FloorPlan, checkedAt: string) {
  const status = typeof plan.availabilityStatusCode === 'string' ? plan.availabilityStatusCode : '';
  const opensOn = typeof plan.availableDate === 'string' ? Date.parse(plan.availableDate) : NaN;
  const soon = status === 'UNAVAILABLE_WITH_FUTURE_MOVE_DATE' && opensOn - Date.parse(checkedAt) <= AVAILABLE_WITHIN_DAYS * 86_400_000;
  if (!status.startsWith('AVAILABLE') && !soon) return NaN;
  const rents = (Array.isArray(plan.units) ? plan.units : []).map((unit) => dollars(isRecord(unit) ? unit.rent : null));
  if (typeof plan.priceRange?.min === 'number') rents.push(plan.priceRange.min);
  const known = rents.filter((rent) => Number.isFinite(rent) && rent > 0);
  return known.length ? Math.min(...known) : NaN;
}

export function parseApartmentGuidePage(html: string, _page: unknown, checkedAt: string) {
  const script = html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script\s*>/i);
  const data = script ? (JSON.parse(script[1]) as { props?: { pageProps?: { pageData?: { location?: unknown } } } }) : null;
  const location = data?.props?.pageProps?.pageData?.location;
  const buildings = isRecord(location) && isRecord(location.listingSearch) ? location.listingSearch.listings : null;
  if (!Array.isArray(buildings)) throw new Error('Apartment Guide did not return a recognized rental page.');
  return (buildings.filter(isRecord) as Building[]).flatMap((building) => {
    const url = listingUrl(building.urlPathname);
    const zip = typeof building.location?.zip === 'string' ? building.location.zip : '';
    const city = nycBorough(zip);
    if (!url || building.offMarket === true || building.location?.stateAbbr !== 'NY' || !city || typeof building.address !== 'string')
      return [];
    // The cheapest available floor plan for each bedroom count.
    const cheapest = new Map<number, { rent: number; plan: FloorPlan }>();
    for (const plan of (Array.isArray(building.floorPlans) ? building.floorPlans : []).filter(isRecord) as FloorPlan[]) {
      const rent = planRent(plan, checkedAt);
      const beds = plan.bedCount;
      if (!Number.isFinite(rent) || typeof beds !== 'number' || !Number.isInteger(beds) || beds < 0 || beds > 4) continue;
      if (rent < (cheapest.get(beds)?.rent ?? Infinity)) cheapest.set(beds, { rent, plan });
    }
    const { street, unit } = splitStreetUnit(building.address);
    return [...cheapest].flatMap(([beds, { rent, plan }]) => {
      const listing = normalizeListing(
        {
          id: `${building.id}-${beds}`,
          url,
          address: street,
          unit,
          city,
          state: 'NY',
          region: 'nyc',
          zipCode: zip,
          bedrooms: beds,
          rent,
          bathrooms: typeof plan.bathCount === 'number' ? plan.bathCount : undefined,
          // Some plans report placeholder sizes such as 10 square feet.
          squareFeet: typeof plan.sqFtRange?.min === 'number' && plan.sqFtRange.min >= 100 ? plan.sqFtRange.min : undefined,
          latitude: building.location?.lat,
          longitude: building.location?.lng,
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
      return listing ? [listing] : [];
    });
  });
}
