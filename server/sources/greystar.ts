/**
 * Greystar: every available apartment in the New York City (five boroughs) buildings it manages, from the
 * manager's own site. The New York City metro page lists each building with its address and whether it
 * shows prices online (buildings that only say to contact them are skipped); each building's
 * page carries its available units (unit number, floor plan, base rent) in the page data, and its floor
 * plans' bedroom counts and the building's coordinates as schema.org data. robots.txt disallows /api/,
 * which is not used. Rents are base rents; Greystar also shows a total with required monthly fees.
 */
import { isRecord } from '../../src/domain.ts';
import type { FetchTransport } from '../../src/fetch-type.ts';
import { normalizeListing } from '../../src/listings.ts';
import { nycBorough } from './firstmover.ts';
import { fetchPublicHtml, jsonLd, loadPublicPages, publicListingUrl } from './public-rentals.ts';

const SOURCE = { id: 'greystar', name: 'Greystar', kind: 'feed' };
const ORIGIN = 'https://www.greystar.com';
const METRO_PAGE = `${ORIGIN}/homes-to-rent/us/ny/new-york-city`;
const PROPERTY_PATH = /^\/[a-z0-9-]+\/p_\d{1,9}$/;
export const greystarListingUrl = (value: unknown) => publicListingUrl(value, ORIGIN, PROPERTY_PATH);

const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, '|')
    .replace(/&amp;/g, '&')
    .replace(/\s*\|[\s|]*/g, '|');

/** The building pages on the metro page whose card address is in the five boroughs. */
export function parseGreystarMetro(html: string): { url: string }[] {
  const links = [...html.matchAll(/href="(\/[a-z0-9-]+\/p_\d{1,9})"/g)];
  if (!links.length) throw new Error('Greystar did not return a recognized metro page.');
  const pages = new Set<string>();
  for (const link of links) {
    // The card's name and address follow its link, then its price, or a note that it gives none online:
    // "…|1 Flatbush|558 Fulton St, Suite 301, Brooklyn, NY 11217|12 month lease from|$3,550|…".
    const card = text(html.slice(link.index, link.index + 8000)).match(/\|[^|]+\|[^|]+, NY (\d{5})\|([^|]+)\|/);
    if (card && nycBorough(card[1]) && !/contact the community/i.test(card[2])) pages.add(ORIGIN + link[1]);
  }
  return [...pages].map((url) => ({ url }));
}

/** The text of a Next.js page's embedded data (its flight chunks). */
function flightText(html: string) {
  return [...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)]
    .map((match) => {
      const chunk: unknown = JSON.parse(match[1]);
      return Array.isArray(chunk) && typeof chunk[1] === 'string' ? chunk[1] : '';
    })
    .join('');
}

/** The JSON array starting at `start`, read up to its closing bracket, minding brackets inside strings. */
function arrayAt(text: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[') depth++;
    else if (char === ']' && --depth === 0) return JSON.parse(text.slice(start, index + 1));
  }
  return null;
}

/** A building page's available units, one listing each. */
export function parseGreystarProperty(html: string, page: { url: string }, checkedAt: string) {
  const building = jsonLd(html).find((thing) => isRecord(thing) && thing['@type'] === 'LodgingBusiness' && isRecord(thing.address));
  const flight = flightText(html);
  const marker = flight.indexOf('"propertyUnits":[');
  const units = marker < 0 ? null : arrayAt(flight, marker + '"propertyUnits":'.length);
  if (!building?.address || !Array.isArray(units)) throw new Error('Greystar did not return a recognized building page.');
  const { streetAddress, postalCode } = building.address;
  const city = typeof postalCode === 'string' ? nycBorough(postalCode) : null;
  if (!city || typeof streetAddress !== 'string') return [];
  // The leasing office's suite is not part of the building's address.
  const address = streetAddress.replace(/,\s*(?:suite|ste\.?|unit)\b.*$/i, '').trim();
  const plans = new Map<string, Record<string, unknown>>();
  const places = (building as { containsPlace?: unknown }).containsPlace;
  for (const plan of Array.isArray(places) ? places : []) if (isRecord(plan)) plans.set(String(plan.identifier), plan);
  const point = building as { latitude?: unknown; longitude?: unknown };
  return units
    .map((unit) => {
      if (!isRecord(unit) || typeof unit.unitId !== 'string' || typeof unit.unitNumber !== 'string') return null;
      const plan = plans.get(String(unit.floorPlanId));
      return normalizeListing(
        {
          id: unit.unitId,
          url: greystarListingUrl(page.url),
          address,
          unit: unit.unitNumber,
          city,
          state: 'NY',
          region: 'nyc',
          zipCode: postalCode,
          latitude: point.latitude,
          longitude: point.longitude,
          bedrooms: plan?.numberOfBedrooms,
          bathrooms: plan?.numberOfBathroomsTotal,
          squareFeet: unit.area,
          rent: unit.minPrice,
          company: 'Greystar',
          status: 'Active',
          updatedAt: checkedAt,
        },
        SOURCE,
      );
    })
    .filter((listing) => listing !== null);
}

export async function loadGreystar(fetcher: FetchTransport, now: Date) {
  const buildings = parseGreystarMetro(await fetchPublicHtml(fetcher, METRO_PAGE, 'Greystar', 15_000));
  if (!buildings.length) throw new Error('Greystar listed no New York City buildings.');
  // One building page at a time, a second apart.
  const result = await loadPublicPages(SOURCE, buildings, parseGreystarProperty, fetcher, now, {
    concurrency: 1,
    intervalMs: 1000,
    timeoutMs: 15_000,
  });
  return { ...result, pages: result.pages + 1, ...(result.partial ? { requestedPages: result.requestedPages! + 1 } : {}) };
}

export const GREYSTAR_LIVE = {
  ...SOURCE,
  id: 'greystar-live',
  marketplace: SOURCE.id,
  coverage: 'every available apartment in the New York City buildings Greystar manages, from its own site',
  regions: ['nyc'],
  minPages: 2,
  maxPages: 40,
  rowsPerPage: 150,
  listingUrl: greystarListingUrl,
  load: loadGreystar,
};
